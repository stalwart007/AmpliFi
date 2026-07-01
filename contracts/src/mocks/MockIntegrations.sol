// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Router} from "../integrations/Interfaces.sol";

/// @notice TEST-ONLY ERC-4626 vault (stands in for Ethena sUSDe / Morpho / Yearn).
contract MockYieldVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Yield Vault", "mvY") ERC4626(asset_) {}
}

/// @notice TEST-ONLY Uniswap-V2-style router that swaps 1:1 (pre-fund with the
///         output token). Stands in for the SushiSwap router.
contract MockUniV2Router is IUniswapV2Router {
    using SafeERC20 for IERC20;

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn; // 1:1 mock rate
        require(out >= amountOutMin, "mock: min out");
        IERC20(path[path.length - 1]).safeTransfer(to, out);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}
