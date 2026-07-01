// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISwapRouter} from "./Interfaces.sol";

/**
 * @title  RebalanceRouter
 * @notice On-chain rebalancing engine: executes a batch of swaps (computed
 *         off-chain by the keeper from strategy-core's target weights) through a
 *         pluggable {ISwapRouter} (0x / Sushi). Each leg carries its own
 *         `minOut`, so slippage is bounded per swap. The keeper decides amounts;
 *         this contract only routes the swaps and forwards output to `to`.
 */
contract RebalanceRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ISwapRouter public router;

    struct Leg {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        bytes data;
    }

    event RouterUpdated(address router);
    event Rebalanced(uint256 legs, address to);

    error ZeroAddress();

    constructor(ISwapRouter router_, address owner_) Ownable(owner_) {
        if (address(router_) == address(0)) revert ZeroAddress();
        router = router_;
    }

    function setRouter(ISwapRouter router_) external onlyOwner {
        if (address(router_) == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterUpdated(address(router_));
    }

    /// @notice Execute the rebalance legs, pulling each `tokenIn` from the caller
    ///         and sending the swapped `tokenOut` to `to`.
    function rebalance(Leg[] calldata legs, address to) external onlyOwner nonReentrant {
        for (uint256 i; i < legs.length; ++i) {
            Leg calldata leg = legs[i];
            IERC20(leg.tokenIn).safeTransferFrom(msg.sender, address(this), leg.amountIn);
            IERC20(leg.tokenIn).forceApprove(address(router), leg.amountIn);
            router.swap(leg.tokenIn, leg.tokenOut, leg.amountIn, leg.minOut, to, leg.data);
        }
        emit Rebalanced(legs.length, to);
    }
}
