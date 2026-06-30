// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IOptionsVenue} from "../interfaces/IOptionsVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  MockOptionsVenue
 * @notice TEST / TESTNET ONLY. A stand-in for a real options venue (Panoptic,
 *         Aperture, a perp-options AMM, …) that implements `IOptionsVenue` so
 *         the vault's accounting can be exercised end-to-end without a live
 *         market. Unlike the old demo's owner-typed `accrue()`, this is a *mock
 *         of an external dependency* used only in tests — the production vault
 *         binds a real venue adapter behind the same interface and never
 *         fabricates returns itself.
 *
 * @dev    `setMarkBps` lets a test scale the book's value to simulate P&L. The
 *         venue must be pre-funded with `asset` to honour `settle()`.
 */
contract MockOptionsVenue is IOptionsVenue, Ownable {
    using SafeERC20 for IERC20;

    address public immutable assetToken;
    uint256 public leverageX; // notional multiple the premium manufactures
    uint256 public bookValue; // current mark in asset units
    int256 public deltaWad; // signed net delta fraction (1e18)

    constructor(address asset_, uint256 leverageX_) Ownable(msg.sender) {
        assetToken = asset_;
        leverageX = leverageX_;
        deltaWad = 0.53e18;
    }

    function asset() external view returns (address) {
        return assetToken;
    }

    function markToMarket() external view returns (uint256) {
        return bookValue;
    }

    function netDelta() external view returns (int256) {
        return deltaWad;
    }

    function openExposure(uint256 premium, uint256 minExposure) external returns (uint256 notional) {
        // Premium has already been transferred to this venue by the vault.
        bookValue += premium; // freshly-struck long book is worth its premium
        notional = premium * leverageX;
        require(notional >= minExposure, "venue: slippage");
        emit ExposureOpened(premium, notional);
    }

    function settle() external returns (uint256 proceeds) {
        proceeds = bookValue;
        bookValue = 0;
        if (proceeds > 0) IERC20(assetToken).safeTransfer(msg.sender, proceeds);
        emit Settled(proceeds);
    }

    // --- test controls -------------------------------------------------------

    /// @notice Scale the book value to simulate market P&L (test only).
    function setMarkBps(uint256 bps) external onlyOwner {
        bookValue = (bookValue * bps) / 10_000;
    }

    function setMarkAbsolute(uint256 v) external onlyOwner {
        bookValue = v;
    }

    function setDeltaWad(int256 d) external onlyOwner {
        deltaWad = d;
    }
}
