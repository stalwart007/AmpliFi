// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleHardenedVenue} from "../src/OracleHardenedVenue.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";

contract OracleHardenedVenueTest is Test {
    MockUSDC usdc;
    MockPriceOracle oracle;
    OracleHardenedVenue venue;

    address gov = address(0xA11CE);
    address vault = address(0x7A017);
    address guardian = address(0x6471);

    uint256 constant UNIT = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        oracle = new MockPriceOracle(2000e8, 8); // $2000, 8dp
        venue = new OracleHardenedVenue(
            address(usdc),
            IPriceOracle(address(oracle)),
            gov,
            vault,
            guardian,
            7, // leverage
            1 hours, // max staleness
            500 // 5% max deviation per sync
        );
        usdc.mint(address(venue), 1_000_000 * UNIT); // venue holds settlement liquidity
    }

    function _open(uint256 prem) internal {
        vm.prank(vault);
        venue.openExposure(prem, 0);
    }

    function testOpenAndMark() public {
        _open(1000 * UNIT);
        assertApproxEqAbs(venue.markToMarket(), 1000 * UNIT, 1, "fresh book ~ premium");
        assertEq(venue.notional(), 7000 * UNIT);
    }

    function testPriceGainRaisesMark() public {
        _open(1000 * UNIT);
        oracle.setPrice(2100e8); // +5% (within deviation bound)
        venue.syncPrice();
        // value = premium + notional·(Δprice/entry) = 1000 + 7000·0.05 = 1350
        assertApproxEqAbs(venue.markToMarket(), 1350 * UNIT, 2 * UNIT);
    }

    function testCappedDownside() public {
        _open(1000 * UNIT);
        // walk the price down in ≤5% steps until the book floors at 0
        for (uint256 i = 0; i < 10; i++) {
            uint256 p = oracle.price();
            oracle.setPrice((p * 95) / 100);
            venue.syncPrice();
        }
        assertEq(venue.markToMarket(), 0, "book floored at 0 (capped downside)");
    }

    function testRejectsStalePrice() public {
        // move time forward and leave the oracle stale
        vm.warp(block.timestamp + 2 hours);
        oracle.setPriceAt(2000e8, block.timestamp - 90 minutes);
        vm.expectRevert();
        venue.syncPrice();
    }

    function testRejectsLargeDeviation() public {
        oracle.setPrice(2000e8 * 2); // +100% in one update → must be rejected
        vm.expectRevert();
        venue.syncPrice();
    }

    function testOnlyVaultOpens() public {
        vm.expectRevert();
        venue.openExposure(100 * UNIT, 0); // caller is not the vault
    }

    function testGuardianEmergencyWithdraw() public {
        _open(1000 * UNIT);
        uint256 venueBal = usdc.balanceOf(address(venue));
        vm.prank(guardian);
        uint256 pulled = venue.emergencyWithdraw(vault);
        assertEq(pulled, venueBal);
        assertEq(usdc.balanceOf(address(venue)), 0);
        assertTrue(venue.paused());
        // exposure cannot be opened while paused
        vm.prank(vault);
        vm.expectRevert();
        venue.openExposure(100 * UNIT, 0);
    }

    function testNonGuardianCannotEmergency() public {
        vm.prank(vault);
        vm.expectRevert();
        venue.emergencyWithdraw(vault);
    }
}
