// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {IAllowlistGate} from "../interfaces/IAllowlistGate.sol";

/**
 * @title  AllowlistGate
 * @notice The protocol's permissioning boundary: AmpliFi is operator-gated, so
 *         only approved wallets may deposit. The gate offers three independent
 *         admission paths, all converging on {isAllowed}:
 *
 *           1. Direct entry   — a GATEKEEPER flips `_direct[account]` on/off.
 *           2. Merkle entry   — a large allowlist is committed off-chain as a
 *                               Merkle root; a wallet self-enrols by submitting a
 *                               proof, so the full list never touches the chain
 *                               (privacy + gas). `claimWithProof`.
 *           3. Signed pass    — a GATEKEEPER signs an off-chain EIP-712
 *                               `AccessPass(account, expiry, nonce)`; the wallet
 *                               redeems it on-chain. Passes expire and are
 *                               single-use (replay-protected by nonce), so access
 *                               can be granted privately and time-boxed without
 *                               an on-chain transaction from the gatekeeper.
 *
 *         An optional global `requireGate` lets governance switch the protocol
 *         between permissioned and permissionless without redeploying consumers.
 *         Entries may carry an expiry; expired entries fail closed.
 *
 * @dev    AUDIT STATUS: written to production standards and compiles clean, but
 *         not independently audited. See PRODUCTION_READINESS.md. The gate is the
 *         real boundary — any UI allowlist is convenience only.
 */
contract AllowlistGate is IAllowlistGate, AccessControl, Pausable, EIP712 {
    bytes32 public constant GATEKEEPER_ROLE = keccak256("GATEKEEPER_ROLE");

    bytes32 private constant _PASS_TYPEHASH = keccak256("AccessPass(address account,uint256 expiry,uint256 nonce)");

    /// account => unix expiry (type(uint256).max = no expiry, 0 = not allowed).
    mapping(address => uint256) private _expiry;
    /// account => whether it was ever directly/merkle/pass enrolled.
    mapping(address => bool) private _enrolled;
    /// per-account consumed pass nonces (replay protection).
    mapping(address => mapping(uint256 => bool)) public passUsed;

    bytes32 public merkleRoot; // optional committed allowlist root
    bool public requireGate = true; // global permissioned switch
    uint256 public defaultPassTtl = 30 days;

    error NotGatekeeper();
    error AlreadyEnrolled();
    error BadProof();
    error PassExpired();
    error PassAlreadyUsed();
    error BadSigner();
    error ZeroAddress();

    event DirectSet(address indexed account, bool allowed, uint256 expiry);
    event MerkleRootUpdated(bytes32 root);
    event Claimed(address indexed account, uint256 expiry);
    event PassRedeemed(address indexed account, uint256 expiry, uint256 nonce);
    event GateModeUpdated(bool requireGate);

    constructor(address admin) EIP712("AmpliFiAllowlist", "1") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GATEKEEPER_ROLE, admin);
    }

    // ----------------------------------------------------------------- views

    /// @inheritdoc IAllowlistGate
    function isAllowed(address account) external view returns (bool) {
        if (!requireGate) return true;
        if (paused()) return false;
        uint256 e = _expiry[account];
        return e != 0 && block.timestamp <= e;
    }

    function expiryOf(address account) external view returns (uint256) {
        return _expiry[account];
    }

    function isEnrolled(address account) external view returns (bool) {
        return _enrolled[account];
    }

    // -------------------------------------------------------- 1. direct entry

    /// @notice Gatekeeper grants/revokes a single wallet, with optional expiry.
    function setAllowed(address account, bool allowed, uint256 expiry) external onlyRole(GATEKEEPER_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _expiry[account] = allowed ? (expiry == 0 ? type(uint256).max : expiry) : 0;
        _enrolled[account] = allowed || _enrolled[account];
        emit DirectSet(account, allowed, _expiry[account]);
    }

    /// @notice Batch variant for guarded-launch onboarding.
    function setAllowedBatch(address[] calldata accounts, bool allowed) external onlyRole(GATEKEEPER_ROLE) {
        uint256 e = allowed ? type(uint256).max : 0;
        for (uint256 i; i < accounts.length; ++i) {
            address a = accounts[i];
            if (a == address(0)) revert ZeroAddress();
            _expiry[a] = e;
            if (allowed) _enrolled[a] = true;
            emit DirectSet(a, allowed, e);
        }
    }

    // -------------------------------------------------------- 2. merkle entry

    function setMerkleRoot(bytes32 root) external onlyRole(GATEKEEPER_ROLE) {
        merkleRoot = root;
        emit MerkleRootUpdated(root);
    }

    /**
     * @notice Self-enrol by proving membership in the committed allowlist. The
     *         leaf is `keccak256(bytes.concat(keccak256(abi.encode(account, expiry))))`
     *         (double-hash, OZ-standard) so the full list stays off-chain.
     */
    function claimWithProof(uint256 expiry, bytes32[] calldata proof) external {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, expiry))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert BadProof();
        if (expiry != 0 && block.timestamp > expiry) revert PassExpired();
        _expiry[msg.sender] = expiry == 0 ? type(uint256).max : expiry;
        _enrolled[msg.sender] = true;
        emit Claimed(msg.sender, _expiry[msg.sender]);
    }

    // ---------------------------------------------------------- 3. signed pass

    /**
     * @notice Redeem an EIP-712 access pass signed by a gatekeeper. The pass is
     *         single-use (nonce) and time-boxed (expiry), letting governance hand
     *         out access privately off-chain.
     */
    function redeemPass(uint256 expiry, uint256 nonce, bytes calldata signature) external {
        if (block.timestamp > expiry) revert PassExpired();
        if (passUsed[msg.sender][nonce]) revert PassAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(_PASS_TYPEHASH, msg.sender, expiry, nonce));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (!hasRole(GATEKEEPER_ROLE, signer)) revert BadSigner();

        passUsed[msg.sender][nonce] = true;
        _expiry[msg.sender] = expiry;
        _enrolled[msg.sender] = true;
        emit PassRedeemed(msg.sender, expiry, nonce);
    }

    /// @notice Helper exposing the typed-data digest a gatekeeper must sign.
    function passDigest(address account, uint256 expiry, uint256 nonce) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(_PASS_TYPEHASH, account, expiry, nonce)));
    }

    // ----------------------------------------------------------- admin / mode

    function setRequireGate(bool v) external onlyRole(DEFAULT_ADMIN_ROLE) {
        requireGate = v;
        emit GateModeUpdated(v);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
