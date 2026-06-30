// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PanopticVenueAdapter} from "../src/venues/PanopticVenueAdapter.sol";
import {MockPanopticPool} from "../src/mocks/MockPanopticPool.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice End-to-end behaviour of the Panoptic venue adapter. `forge test`.
contract PanopticVenueAdapterTest is Test {
    MockUSDC usdc;
    MockPanopticPool pool;
    PanopticVenueAdapter venue;
    address vault = address(0x7A017);
    address keeper = address(0x33EE);

    function setUp() public {
        usdc = new MockUSDC();
        pool = new MockPanopticPool(address(usdc));
        // The vault is the adapter owner (open/settle); the keeper configures it.
        venue = new PanopticVenueAdapter(pool, vault, keeper);
        vm.prank(keeper);
        venue.setPositionTemplate(uint256(0xBEEF)); // keeper-supplied TokenId
    }

    function testOnlyKeeperConfigures() public {
        vm.prank(vault); // owner is not the keeper
        vm.expectRevert();
        venue.setLeverage(8);
    }

    function _fundVenue(uint256 amt) internal {
        usdc.mint(address(venue), amt); // vault routes premium to the venue
    }

    function testOnlyOwnerOpens() public {
        _fundVenue(1_000e6);
        vm.expectRevert();
        venue.openExposure(1_000e6, 0); // not the vault
    }

    function testOpenManufacturesNotionalAndMark() public {
        _fundVenue(1_000e6);
        vm.prank(vault);
        uint256 notional = venue.openExposure(1_000e6, 5_000e6);
        assertEq(notional, 6_000e6); // 6× leverage default
        assertEq(venue.markToMarket(), 1_000e6); // fresh long worth its premium
    }

    function testSlippageGuard() public {
        _fundVenue(1_000e6);
        vm.prank(vault);
        vm.expectRevert();
        venue.openExposure(1_000e6, 7_000e6); // demands more than 6×
    }

    function testCappedDownsideAndSettle() public {
        _fundVenue(1_000e6);
        vm.prank(vault);
        venue.openExposure(1_000e6, 0);

        // Simulate a 40% drawdown on the option book.
        pool.setMarkBps(6_000);
        assertEq(venue.markToMarket(), 600e6); // never negative — capped downside

        // Settle returns the realised cash to the vault.
        vm.prank(vault);
        uint256 proceeds = venue.settle();
        assertEq(proceeds, 600e6);
        assertEq(usdc.balanceOf(vault), 600e6);
        assertEq(venue.markToMarket(), 0);
    }

    function testProfitFlowsThroughMark() public {
        _fundVenue(1_000e6);
        vm.prank(vault);
        venue.openExposure(1_000e6, 0);
        pool.setMarkBps(13_000); // +30%
        assertEq(venue.markToMarket(), 1_300e6);
    }
}
