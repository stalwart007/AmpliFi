// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title  AmplifiTimelock
 * @notice The address that should hold the vault's GOVERNOR_ROLE and the
 *         RiskController's GOVERNOR_ROLE. Every privileged action (setVenue,
 *         setPremiumBps, resetEpoch, fee changes …) must be queued and can only
 *         execute after `minDelay` seconds — giving depositors a window to exit
 *         before any policy change takes effect.
 *
 *         Remediates SECURITY_REVIEW findings #2 (setVenue), #8 (resetEpoch) and
 *         #11 (centralised roles): the PROPOSER role is held by a multisig
 *         guardian, EXECUTOR may be open or the same multisig, and there is no
 *         standing admin (the timelock administers itself).
 *
 * @dev    Thin wrapper over OpenZeppelin's audited TimelockController so we
 *         inherit its battle-tested queue/execute/cancel semantics verbatim.
 */
contract AmplifiTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
