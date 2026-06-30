// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AllowlistGate} from "../src/access/AllowlistGate.sol";

/// @notice Behavioural tests for the permissioning gate. Run with `forge test`.
contract AllowlistGateTest is Test {
    AllowlistGate gate;
    address admin = address(0xA11CE);
    uint256 gkKey = 0xBEEF; // gatekeeper signing key
    address gk;
    address user = address(0xD00D);

    function setUp() public {
        gk = vm.addr(gkKey);
        gate = new AllowlistGate(admin);
        // Cache the role getter BEFORE pranking — evaluating it as a call
        // argument would otherwise consume the prank (vm.prank affects only the
        // next external call).
        bytes32 role = gate.GATEKEEPER_ROLE();
        vm.prank(admin);
        gate.grantRole(role, gk);
    }

    function testDefaultDenied() public view {
        assertFalse(gate.isAllowed(user));
    }

    function testDirectAllowAndRevoke() public {
        vm.prank(gk);
        gate.setAllowed(user, true, 0);
        assertTrue(gate.isAllowed(user));
        vm.prank(gk);
        gate.setAllowed(user, false, 0);
        assertFalse(gate.isAllowed(user));
    }

    function testExpiryFailsClosed() public {
        vm.prank(gk);
        gate.setAllowed(user, true, block.timestamp + 1 days);
        assertTrue(gate.isAllowed(user));
        vm.warp(block.timestamp + 2 days);
        assertFalse(gate.isAllowed(user));
    }

    function testNonGatekeeperCannotAllow() public {
        vm.prank(address(0xdead));
        vm.expectRevert();
        gate.setAllowed(user, true, 0);
    }

    function testSignedPassRedemption() public {
        uint256 expiry = block.timestamp + 10 days;
        uint256 nonce = 1;
        bytes32 digest = gate.passDigest(user, expiry, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gkKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(user);
        gate.redeemPass(expiry, nonce, sig);
        assertTrue(gate.isAllowed(user));

        // replay with the same nonce fails
        vm.prank(user);
        vm.expectRevert();
        gate.redeemPass(expiry, nonce, sig);
    }

    function testPassFromNonGatekeeperRejected() public {
        uint256 expiry = block.timestamp + 10 days;
        bytes32 digest = gate.passDigest(user, expiry, 7);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xC0FFEE, digest); // not a gatekeeper
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.prank(user);
        vm.expectRevert();
        gate.redeemPass(expiry, 7, sig);
    }

    function testGlobalSwitchOpensGate() public {
        assertFalse(gate.isAllowed(user));
        vm.prank(admin);
        gate.setRequireGate(false);
        assertTrue(gate.isAllowed(user)); // permissionless mode
    }

    function testPausedDeniesEvenAllowed() public {
        vm.prank(gk);
        gate.setAllowed(user, true, 0);
        vm.prank(admin);
        gate.pause();
        assertFalse(gate.isAllowed(user));
    }
}
