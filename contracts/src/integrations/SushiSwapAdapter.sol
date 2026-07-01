// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISwapRouter, IUniswapV2Router} from "./Interfaces.sol";

/**
 * @title  SushiSwapAdapter
 * @notice REFERENCE swap adapter over a SushiSwap (Uniswap V2-style) router.
 *         Pulls `tokenIn` from the caller, swaps a direct [tokenIn, tokenOut]
 *         path, and delivers `tokenOut` to `to` with a min-out slippage guard.
 *         Multi-hop paths can be threaded via a router that accepts `data`.
 */
contract SushiSwapAdapter is ISwapRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUniswapV2Router public immutable router;

    constructor(IUniswapV2Router router_) {
        router = router_;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        bytes calldata /* data */
    ) external nonReentrant returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, minAmountOut, path, to, block.timestamp);
        amountOut = amounts[amounts.length - 1];
    }
}
