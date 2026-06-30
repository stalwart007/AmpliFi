// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskController} from "../src/RiskController.sol";

/// @notice Fuzz + property tests for the portfolio-level risk controller.
contract RiskControllerTest is Test {
    RiskController risk;
    address gov = address(0xA11CE);

    function setUp() public {
        risk = new RiskController(gov, 4000); // wind down at -60%
        bytes32 role = risk.VAULT_ROLE();
        vm.prank(gov);
        risk.grantRole(role, address(this)); // the test acts as the vault
    }

    /// The high-water mark never decreases across pokes (it only ratchets up).
    function testFuzz_highWaterRatchets(uint256 a, uint256 b) public {
        a = bound(a, 1e18, 1e30);
        b = bound(b, 1e18, 1e30);
        risk.pokeNav(a);
        uint256 h1 = risk.highWaterNavWad();
        risk.pokeNav(b);
        assertGe(risk.highWaterNavWad(), h1, "high-water mark decreased");
    }

    /// Any poke strictly below the floor latches an irreversible wind-down.
    function testFuzz_windDownBelowFloor(uint256 peak, uint256 drop) public {
        peak = bound(peak, 1e18, 1e28);
        risk.pokeNav(peak);
        uint256 floor = risk.floorNavWad();
        drop = bound(drop, 0, floor == 0 ? 0 : floor - 1);
        bool wd = risk.pokeNav(drop);
        assertTrue(wd, "did not wind down below floor");
        assertTrue(risk.woundDown(), "wind-down not latched");
        // Once latched, further pokes keep returning true (terminal).
        assertTrue(risk.pokeNav(peak), "wind-down should be sticky");
    }

    /// Staying at/above the floor never triggers a wind-down.
    function testFuzz_aboveFloorSurvives(uint256 peak, uint256 keep) public {
        peak = bound(peak, 1e18, 1e28);
        risk.pokeNav(peak);
        uint256 floor = risk.floorNavWad();
        keep = bound(keep, floor, 1e30);
        assertFalse(risk.pokeNav(keep), "false wind-down at/above floor");
        assertFalse(risk.woundDown());
    }

    function testFuzz_floorRangeEnforced(uint256 f) public {
        vm.prank(gov);
        if (f == 0 || f >= 10_000) {
            vm.expectRevert();
            risk.setFloorBps(f);
        } else {
            risk.setFloorBps(f);
            assertEq(risk.floorBps(), f);
        }
    }

    function testFuzz_onlyVaultPokes(address caller) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert();
        risk.pokeNav(1e18);
    }
}
