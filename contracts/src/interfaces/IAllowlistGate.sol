// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * @title  IAllowlistGate
 * @notice Minimal permissioning surface the vault consults before admitting a
 *         depositor. Implemented by {AllowlistGate}. Kept as a narrow interface
 *         so the vault never depends on the gate's internals and the gate can be
 *         upgraded behind governance without touching the vault.
 */
interface IAllowlistGate {
    /// @return true if `account` is currently permitted to interact.
    function isAllowed(address account) external view returns (bool);
}
