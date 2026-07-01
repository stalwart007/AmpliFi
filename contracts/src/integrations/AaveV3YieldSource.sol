// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldSource, IAaveV3Pool} from "./Interfaces.sol";

/**
 * @title  AaveV3YieldSource
 * @notice REFERENCE adapter: parks idle reserve in Aave v3 to earn supply yield.
 *         Value tracks the rebasing aToken balance 1:1 with the underlying +
 *         accrued interest. Owner (the YieldRouter / governance) drives it.
 *
 *         Unaudited reference wiring — bind a real Aave pool + aToken only after
 *         audit; do not route custody funds here on mainnet unreviewed.
 */
contract AaveV3YieldSource is IYieldSource, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAaveV3Pool public immutable pool;
    IERC20 public immutable underlying;
    IERC20 public immutable aToken;

    error ZeroAddress();

    constructor(IAaveV3Pool pool_, address underlying_, address aToken_, address owner_) Ownable(owner_) {
        if (address(pool_) == address(0) || underlying_ == address(0) || aToken_ == address(0)) revert ZeroAddress();
        pool = pool_;
        underlying = IERC20(underlying_);
        aToken = IERC20(aToken_);
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function totalAssets() external view returns (uint256) {
        return aToken.balanceOf(address(this)); // aTokens rebase to underlying value
    }

    function deposit(uint256 assets) external onlyOwner nonReentrant returns (uint256) {
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        underlying.forceApprove(address(pool), assets);
        pool.supply(address(underlying), assets, address(this), 0);
        return assets;
    }

    function withdraw(uint256 assets, address to) external onlyOwner nonReentrant returns (uint256) {
        return pool.withdraw(address(underlying), assets, to);
    }
}
