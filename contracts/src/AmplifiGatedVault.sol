// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AmplifiVault} from "./AmplifiVault.sol";
import {IOptionsVenue} from "./interfaces/IOptionsVenue.sol";
import {IAllowlistGate} from "./interfaces/IAllowlistGate.sol";
import {RiskController} from "./RiskController.sol";

/**
 * @title  AmplifiGatedVault
 * @notice The permissioned production vault: an {AmplifiVault} that admits a
 *         deposit only when BOTH the caller and the share receiver pass the
 *         {IAllowlistGate}. This is the on-chain enforcement of "only approved
 *         operator wallets can enter the protocol" — the UI gate mirrors it but
 *         the contract is the boundary that actually holds.
 *
 * @dev    Minting (deposit/mint) is gated; burning (withdraw/redeem) is NOT, so
 *         a wallet that loses allowlist status can always exit — funds are never
 *         trapped by de-listing. The gate is swappable by GOVERNOR so the
 *         permissioning policy can evolve without migrating vault state.
 *
 *         The override deliberately omits `nonReentrant`: the base
 *         `_deposit` already carries the guard, and re-declaring it would
 *         re-enter the same lock and revert. We only prepend the gate check.
 */
contract AmplifiGatedVault is AmplifiVault {
    IAllowlistGate public gate;

    error NotAllowlisted(address account);

    event GateUpdated(address gate);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address governor,
        address keeper,
        IOptionsVenue venue_,
        RiskController riskController_,
        address treasury_,
        uint256 premiumBps_,
        uint256 perfFeeBps_,
        uint256 depositCap_,
        IAllowlistGate gate_
    )
        AmplifiVault(
            asset_,
            name_,
            symbol_,
            governor,
            keeper,
            venue_,
            riskController_,
            treasury_,
            premiumBps_,
            perfFeeBps_,
            depositCap_
        )
    {
        if (address(gate_) == address(0)) revert ZeroAddress();
        gate = gate_;
    }

    /// @notice GOVERNOR swaps the permissioning policy (e.g. open the gate).
    function setGate(IAllowlistGate g) external onlyRole(GOVERNOR_ROLE) {
        if (address(g) == address(0)) revert ZeroAddress();
        gate = g;
        emit GateUpdated(address(g));
    }

    /// @dev Gate both the funder and the receiver, then defer to base behaviour.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (!gate.isAllowed(receiver)) revert NotAllowlisted(receiver);
        if (!gate.isAllowed(caller)) revert NotAllowlisted(caller);
        super._deposit(caller, receiver, assets, shares);
    }
}
