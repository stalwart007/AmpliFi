// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * @title  IPriceOracle
 * @notice Chainlink-style price feed surface. The hardened venue reads prices
 *         only through this interface and applies its own staleness + deviation
 *         guards, so a single manipulated read cannot move the vault's NAV.
 */
interface IPriceOracle {
    /// @return price     latest price (scaled by `decimals()`)
    /// @return updatedAt unix timestamp of the latest update
    function latestAnswer() external view returns (uint256 price, uint256 updatedAt);

    function decimals() external view returns (uint8);
}
