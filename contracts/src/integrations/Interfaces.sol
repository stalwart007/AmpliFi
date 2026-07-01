// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/* =============================================================================
 * AmpliFi integration seams
 * -----------------------------------------------------------------------------
 * Narrow interfaces the protocol integrates external DeFi through, following the
 * same seam pattern as `IOptionsVenue`. Concrete reference adapters implement
 * these against real protocols (Aave, Ethena/ERC-4626, 0x, Sushi, EigenLayer,
 * bridges, Pendle). They are REFERENCE / UNAUDITED and are deliberately NOT wired
 * into the vault's custody core — binding any of them is a governance + audit
 * decision. Keeping them behind interfaces means the core never depends on a
 * specific counterparty.
 * ===========================================================================*/

/// @notice A yield-bearing home for idle reserve assets (Aave aToken, an
///         ERC-4626 vault such as Ethena sUSDe, a Morpho/Yearn vault, …).
interface IYieldSource {
    function asset() external view returns (address);
    /// @notice Current value of the deployed position, incl. accrued yield.
    function totalAssets() external view returns (uint256);
    /// @notice Pull `assets` from the caller and deploy them. Returns amount deployed.
    function deposit(uint256 assets) external returns (uint256 deployed);
    /// @notice Withdraw `assets` of value to `to`. Returns amount withdrawn.
    function withdraw(uint256 assets, address to) external returns (uint256 withdrawn);
}

/// @notice A swap executor abstracting a router/aggregator (0x, Sushi, …).
interface ISwapRouter {
    /// @param data optional route payload (e.g. a 0x quote's calldata).
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        bytes calldata data
    ) external returns (uint256 amountOut);
}

/// @notice Liquid-restaking exposure (EigenLayer and friends).
interface IRestakingModule {
    function asset() external view returns (address); // the LST deposited
    function restake(uint256 amount) external returns (uint256 shares);
    function queueWithdrawal(uint256 shares) external returns (bytes32 withdrawalRoot);
    function restakedValue() external view returns (uint256);
}

/// @notice Cross-chain transfer seam (LayerZero OFT / Circle CCTP shaped).
interface IBridgeAdapter {
    function quoteFee(uint32 dstChainId, uint256 amount) external view returns (uint256 nativeFee);
    function bridge(address token, uint256 amount, uint32 dstChainId, address recipient, bytes calldata options)
        external
        payable;
}

/// @notice Yield tokenization seam (Pendle: split a yield asset into PT + YT).
interface IYieldTokenizer {
    function tokenize(address syToken, uint256 amount, address to) external returns (uint256 ptOut, uint256 ytOut);
    function redeem(uint256 amount, address to) external returns (uint256 assetsOut);
}

/* ------------------------- minimal external interfaces --------------------- */

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IEigenStrategyManager {
    function depositIntoStrategy(address strategy, address token, uint256 amount) external returns (uint256 shares);
}

interface IEigenStrategy {
    function userUnderlyingView(address user) external view returns (uint256);
}
