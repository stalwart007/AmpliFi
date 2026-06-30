// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * @title  IPanopticPool
 * @notice The subset of Panoptic v1-core (panoptic-labs/panoptic-v1-core@v1.0.x)
 *         that the AmpliFi venue adapter depends on, expressed as a narrow seam.
 *
 *         Panoptic is an oracle-free, perpetual options protocol built on
 *         Uniswap V3 concentrated liquidity: minting an option moves liquidity
 *         into/out of a range (a "TokenId" encodes the legs — strike, width,
 *         token type, and long/short), and the option earns/owes *streamia*
 *         (streaming premium) instead of expiring. That is exactly the financing
 *         primitive AmpliFi's TimeMachine needs: a LONG Panoptic option gives
 *         amplified, capped-downside exposure (max loss = premium/collateral
 *         committed) financed perpetually by the streamia paid to liquidity
 *         providers — no expiry to roll, no liability beyond the collateral.
 *
 * @dev    Real Panoptic splits responsibilities across `PanopticPool` and two
 *         `CollateralTracker` (ERC-4626) vaults; this interface collapses the
 *         lifecycle the adapter actually uses (deposit collateral, mint a long
 *         position, read its value incl. accrued streamia, burn to settle) into
 *         one seam. A production deployment binds a shim over the real contracts;
 *         `MockPanopticPool` implements the same seam for tests.
 */
interface IPanopticPool {
    /// @notice Collateral / settlement token (e.g. USDC) positions are valued in.
    function collateralToken() external view returns (address);

    /// @notice Deposit `assets` of collateral backing this account's options.
    function depositCollateral(uint256 assets) external returns (uint256 shares);

    /// @notice Withdraw `assets` of free (non-committed) collateral.
    function withdrawCollateral(uint256 assets) external returns (uint256 withdrawn);

    /**
     * @notice Mint a LONG option position. `tokenId` encodes the leg structure
     *         (the off-chain keeper computes it from the basket); `positionSize`
     *         scales the committed notional.
     */
    function mintLongOption(uint256 tokenId, uint128 positionSize) external;

    /// @notice Burn a previously-minted position, realising P&L incl. streamia.
    function burnLongOption(uint256 tokenId) external returns (uint256 proceeds);

    /**
     * @notice Mark-to-market value of all of `account`'s open positions plus its
     *         free collateral, in collateral-token units. For a long-only book
     *         this is always ≥ 0 — the on-chain capped-downside guarantee.
     */
    function accountValue(address account) external view returns (uint256 valueInAsset);

    /// @notice Net delta of `account`'s book as a signed 1e18 fraction of notional.
    function accountDeltaWad(address account) external view returns (int256 deltaWad);
}
