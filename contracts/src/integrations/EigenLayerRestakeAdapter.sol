// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRestakingModule, IEigenStrategyManager, IEigenStrategy} from "./Interfaces.sol";

/**
 * @title  EigenLayerRestakeAdapter
 * @notice REFERENCE restaking adapter: deposits a liquid-staking token (e.g.
 *         wstETH / an LST) into an EigenLayer strategy to earn restaking rewards
 *         as an exposure/yield source. Deposits are immediate; withdrawals are
 *         NOT — EigenLayer withdrawals go through the DelegationManager with an
 *         escrow delay, so `queueWithdrawal` only records intent here and the
 *         real completion is driven off-chain/by governance. Documented honestly
 *         rather than faked as instant.
 */
contract EigenLayerRestakeAdapter is IRestakingModule, Ownable {
    using SafeERC20 for IERC20;

    IEigenStrategyManager public immutable manager;
    address public immutable strategy;
    IERC20 public immutable lst;

    event Restaked(uint256 amount, uint256 shares);
    event WithdrawalQueued(uint256 shares, bytes32 root);

    error ZeroAddress();

    constructor(IEigenStrategyManager manager_, address strategy_, address lst_, address owner_) Ownable(owner_) {
        if (address(manager_) == address(0) || strategy_ == address(0) || lst_ == address(0)) revert ZeroAddress();
        manager = manager_;
        strategy = strategy_;
        lst = IERC20(lst_);
    }

    function asset() external view returns (address) {
        return address(lst);
    }

    function restake(uint256 amount) external onlyOwner returns (uint256 shares) {
        lst.safeTransferFrom(msg.sender, address(this), amount);
        lst.forceApprove(address(manager), amount);
        shares = manager.depositIntoStrategy(strategy, address(lst), amount);
        emit Restaked(amount, shares);
    }

    /// @dev Real completion is via `DelegationManager.queueWithdrawals` +
    ///      `completeQueuedWithdrawal` after the escrow delay (off-chain flow).
    function queueWithdrawal(uint256 shares) external onlyOwner returns (bytes32 root) {
        root = keccak256(abi.encode(address(this), strategy, shares, block.number));
        emit WithdrawalQueued(shares, root);
    }

    function restakedValue() external view returns (uint256) {
        return IEigenStrategy(strategy).userUnderlyingView(address(this));
    }
}
