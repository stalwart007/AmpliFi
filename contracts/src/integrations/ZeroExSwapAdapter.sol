// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISwapRouter} from "./Interfaces.sol";

/**
 * @title  ZeroExSwapAdapter
 * @notice REFERENCE swap adapter for 0x. The keeper fetches a firm quote from
 *         the 0x API off-chain and passes its `data` (calldata) here; the adapter
 *         approves the 0x Exchange Proxy for `tokenIn`, executes the quote, then
 *         forwards the received `tokenOut` to `to` — enforcing `minAmountOut`
 *         measured by the actual balance delta (defends against a bad quote).
 *
 * @dev    Only the pre-configured `exchangeProxy` is ever called; the `data` is
 *         the router calldata, not an arbitrary target, limiting the surface.
 */
contract ZeroExSwapAdapter is ISwapRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable exchangeProxy;

    error SwapFailed();
    error Slippage(uint256 got, uint256 min);
    error ZeroAddress();

    constructor(address exchangeProxy_) {
        if (exchangeProxy_ == address(0)) revert ZeroAddress();
        exchangeProxy = exchangeProxy_;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        bytes calldata data
    ) external nonReentrant returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(exchangeProxy, amountIn);

        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        (bool okCall, ) = exchangeProxy.call(data);
        if (!okCall) revert SwapFailed();

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);

        // Clear any residual allowance and forward the proceeds.
        IERC20(tokenIn).forceApprove(exchangeProxy, 0);
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}
