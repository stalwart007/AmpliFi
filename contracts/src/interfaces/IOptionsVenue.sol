// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * @title  IOptionsVenue
 * @notice The integration seam between the AmplifiVault and the venue that
 *         actually trades the long-option book (e.g. Panoptic / Aperture, a
 *         perp-options AMM, or a CEX bridge). This interface is the line that
 *         separates AUDITED VAULT ACCOUNTING from EXTERNAL MARKET INTEGRATION.
 *
 *         The vault never invents returns. It asks the venue two questions —
 *         "what is the book worth right now?" (`markToMarket`) and "settle my
 *         book to cash" (`settle`) — and it routes premium to the venue to open
 *         or roll exposure. A production deployment binds a real venue adapter
 *         here; the bundled `MockOptionsVenue` implements the same interface for
 *         tests and testnet.
 *
 * @dev    Every value is denominated in the vault's underlying asset (e.g.
 *         6-decimals USDC). Implementations MUST be non-custodial of vault
 *         shares and MUST revert rather than silently truncate.
 */
interface IOptionsVenue {
    /// @notice Underlying settlement asset this venue prices/settles in.
    function asset() external view returns (address);

    /**
     * @notice Current mark-to-market value of the vault's open option book,
     *         in `asset()` units. For a long-only book this is always ≥ 0,
     *         which is what enforces the protocol's capped-downside guarantee.
     */
    function markToMarket() external view returns (uint256 value);

    /**
     * @notice Deploy `premium` of `asset()` (already transferred to the venue)
     *         as new long-option exposure across the target basket.
     * @param  premium     amount of asset committed as option premium
     * @param  minExposure slippage guard: revert if manufactured notional delta
     *                      exposure is below this (caller-computed off-chain)
     * @return notional    dollar-delta notional the premium manufactured
     */
    function openExposure(uint256 premium, uint256 minExposure) external returns (uint256 notional);

    /**
     * @notice Liquidate the entire option book back to `asset()` and return the
     *         proceeds to the vault. Used on redemption shortfalls and on a
     *         RiskController wind-down.
     * @return proceeds amount of asset returned to the vault
     */
    function settle() external returns (uint256 proceeds);

    /// @notice Net delta of the book as a signed 1e18-fixed fraction of notional.
    function netDelta() external view returns (int256 deltaWad);

    event ExposureOpened(uint256 premium, uint256 notional);
    event Settled(uint256 proceeds);
}
