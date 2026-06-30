// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  RiskController
 * @notice Portfolio-level safety for the AmplifiVault — NOT per-asset
 *         liquidation. Because the vault holds a LONG-option book, a single
 *         underlying going to zero only costs that leg's premium; the vault
 *         cannot be liquidated by one timeline collapsing. The controller only
 *         intervenes when the WHOLE book's NAV/share draws down past a floor,
 *         at which point it latches a wind-down: deposits pause and the vault
 *         settles its book to the reserve so holders redeem pro-rata.
 *
 * @dev    The floor is expressed in basis points of the high-water NAV/share.
 *         `floorBps = 4000` means wind down at −60% of the peak. The high-water
 *         mark only ratchets up; it is updated by the vault on every NAV poke.
 */
contract RiskController is AccessControl {
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    uint256 public constant BPS = 10_000;

    /// @notice Wind-down threshold in bps of the high-water NAV/share (≤ BPS).
    uint256 public floorBps;

    /// @notice Highest NAV/share ever observed, in 1e18 fixed point.
    uint256 public highWaterNavWad;

    /// @notice True once a wind-down has been latched (terminal for the epoch).
    bool public woundDown;

    error FloorOutOfRange(uint256 floorBps);
    error AlreadyWoundDown();

    event FloorUpdated(uint256 floorBps);
    event HighWaterUpdated(uint256 navWad);
    event WindDownTriggered(uint256 navWad, uint256 highWaterWad);
    event EpochReset(uint256 navWad);

    constructor(address governor, uint256 initialFloorBps) {
        if (initialFloorBps == 0 || initialFloorBps >= BPS) revert FloorOutOfRange(initialFloorBps);
        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
        floorBps = initialFloorBps;
        highWaterNavWad = 1e18; // seed at par
    }

    /// @notice Governor can tighten/loosen the floor (e.g. 3000–6000 bps).
    function setFloorBps(uint256 newFloorBps) external onlyRole(GOVERNOR_ROLE) {
        if (newFloorBps == 0 || newFloorBps >= BPS) revert FloorOutOfRange(newFloorBps);
        floorBps = newFloorBps;
        emit FloorUpdated(newFloorBps);
    }

    /**
     * @notice Called by the vault with the freshly-computed NAV/share. Ratchets
     *         the high-water mark and latches a wind-down if the floor is broken.
     * @return shouldWindDown true if this poke crossed the floor for the first time
     */
    function pokeNav(uint256 navWad) external onlyRole(VAULT_ROLE) returns (bool shouldWindDown) {
        if (woundDown) return true;

        if (navWad > highWaterNavWad) {
            highWaterNavWad = navWad;
            emit HighWaterUpdated(navWad);
        }

        uint256 floorNav = (highWaterNavWad * floorBps) / BPS;
        if (navWad < floorNav) {
            woundDown = true;
            emit WindDownTriggered(navWad, highWaterNavWad);
            return true;
        }
        return false;
    }

    /// @notice Governor opens a fresh epoch after a wind-down, re-seeding HWM.
    function resetEpoch(uint256 navWad) external onlyRole(GOVERNOR_ROLE) {
        woundDown = false;
        highWaterNavWad = navWad == 0 ? 1e18 : navWad;
        emit EpochReset(highWaterNavWad);
    }

    /// @notice View helper: the absolute NAV/share floor that triggers wind-down.
    function floorNavWad() external view returns (uint256) {
        return (highWaterNavWad * floorBps) / BPS;
    }
}
