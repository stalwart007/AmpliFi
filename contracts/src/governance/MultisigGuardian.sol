// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  MultisigGuardian
 * @notice A minimal m-of-n multisig that acts as the PROPOSER (and optionally
 *         EXECUTOR) on the AmplifiTimelock, and as the emergency guardian that
 *         can pause the vault. Owners submit a call, confirm it, and once the
 *         threshold is reached any owner can execute it.
 *
 *         Remediates SECURITY_REVIEW finding #11: no single key controls
 *         governance — privileged actions require `threshold` independent
 *         approvals and then flow through the timelock's delay.
 *
 * @dev    Deliberately small and self-contained (Gnosis-Safe-lite). For mainnet,
 *         a full Safe is recommended; this is the reference wiring.
 */
contract MultisigGuardian is ReentrancyGuard {
    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    error NotOwner();
    error InvalidThreshold();
    error DuplicateOwner();
    error ZeroOwner();
    error NoTx();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error CallFailed();

    event Submit(uint256 indexed id, address indexed proposer, address target, uint256 value);
    event Confirm(uint256 indexed id, address indexed owner);
    event Revoke(uint256 indexed id, address indexed owner);
    event Execute(uint256 indexed id);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(address[] memory _owners, uint256 _threshold) {
        if (_owners.length == 0) revert ZeroOwner();
        if (_threshold == 0 || _threshold > _owners.length) revert InvalidThreshold();
        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            if (o == address(0)) revert ZeroOwner();
            if (isOwner[o]) revert DuplicateOwner();
            isOwner[o] = true;
            owners.push(o);
        }
        threshold = _threshold;
    }

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /// @notice Submit a new call; the proposer's confirmation is recorded too.
    function submit(address target, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = transactions.length;
        transactions.push(Transaction({target: target, value: value, data: data, executed: false, confirmations: 0}));
        emit Submit(id, msg.sender, target, value);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner {
        _confirm(id);
    }

    function _confirm(uint256 id) internal {
        if (id >= transactions.length) revert NoTx();
        if (transactions[id].executed) revert AlreadyExecuted();
        if (confirmedBy[id][msg.sender]) revert AlreadyConfirmed();
        confirmedBy[id][msg.sender] = true;
        transactions[id].confirmations += 1;
        emit Confirm(id, msg.sender);
    }

    function revoke(uint256 id) external onlyOwner {
        if (id >= transactions.length) revert NoTx();
        if (transactions[id].executed) revert AlreadyExecuted();
        if (!confirmedBy[id][msg.sender]) revert NotConfirmed();
        confirmedBy[id][msg.sender] = false;
        transactions[id].confirmations -= 1;
        emit Revoke(id, msg.sender);
    }

    /// @notice Execute once `threshold` confirmations are in.
    function execute(uint256 id) external onlyOwner nonReentrant {
        if (id >= transactions.length) revert NoTx();
        Transaction storage t = transactions[id];
        if (t.executed) revert AlreadyExecuted();
        if (t.confirmations < threshold) revert NotEnoughConfirmations();
        t.executed = true;
        (bool ok, ) = t.target.call{value: t.value}(t.data);
        if (!ok) revert CallFailed();
        emit Execute(id);
    }

    receive() external payable {}
}
