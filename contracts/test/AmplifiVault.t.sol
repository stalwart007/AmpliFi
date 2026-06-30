// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AmplifiVault} from "../src/AmplifiVault.sol";
import {RiskController} from "../src/RiskController.sol";
import {MockOptionsVenue} from "../src/mocks/MockOptionsVenue.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IOptionsVenue} from "../src/interfaces/IOptionsVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title AmplifiVault behavioural tests
 * @notice Mirrors the strategy-core TypeScript property tests on-chain. Run with
 *         `forge test` in the contracts/ directory (Foundry required).
 *
 *         Note: this environment compiles the contracts with solc to verify
 *         validity; these behavioural tests are executed in a Foundry CI job.
 */
contract AmplifiVaultTest is Test {
    MockUSDC usdc;
    MockOptionsVenue venue;
    RiskController risk;
    AmplifiVault vault;

    address governor = address(0xA11CE);
    address keeper = address(0xB0B);
    address treasury = address(0x7EE);
    address alice = address(0xA1);
    address bob = address(0xB2);

    uint256 constant UNIT = 1e6; // USDC 6dp
    uint256 constant FLOOR_BPS = 4000; // wind down at -60%

    function setUp() public {
        usdc = new MockUSDC();
        venue = new MockOptionsVenue(address(usdc), 7); // ~7x leverage
        venue.transferOwnership(address(this)); // test controls the mock

        risk = new RiskController(governor, FLOOR_BPS);
        vault = new AmplifiVault(
            IERC20(address(usdc)),
            "Amplifi Index",
            "AFI",
            governor,
            keeper,
            IOptionsVenue(address(venue)),
            risk,
            treasury,
            8000, // 80% of each deposit becomes premium
            1000, // 10% perf fee
            1_000_000 * UNIT // deposit cap
        );

        // Wire the vault as the only address allowed to poke the risk controller.
        // Cache the role getter first — evaluating it as a call argument would
        // consume the vm.prank (which only affects the next external call).
        bytes32 vaultRole = risk.VAULT_ROLE();
        vm.prank(governor);
        risk.grantRole(vaultRole, address(vault));

        // Fund users and pre-fund the venue so settle() can pay out.
        usdc.mint(alice, 100_000 * UNIT);
        usdc.mint(bob, 100_000 * UNIT);
        usdc.mint(address(venue), 1_000_000 * UNIT);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        vm.startPrank(who);
        usdc.approve(address(vault), amt);
        shares = vault.deposit(amt, who);
        vm.stopPrank();
    }

    function testDepositMintsSharesAndRoutesPremium() public {
        uint256 shares = _deposit(alice, 10_000 * UNIT);
        assertGt(shares, 0, "no shares");
        // 80% routed to venue as premium, 20% stays idle.
        assertApproxEqAbs(venue.markToMarket(), 8_000 * UNIT, 1, "premium not routed");
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 2_000 * UNIT, 1, "idle wrong");
        // NAV ~ par at genesis.
        assertApproxEqRel(vault.navPerShareWad(), 1e18, 1e15, "nav not ~par");
    }

    function testTotalAssetsIsReservePlusBook() public {
        _deposit(alice, 10_000 * UNIT);
        assertEq(vault.totalAssets(), usdc.balanceOf(address(vault)) + venue.markToMarket());
    }

    function testCappedDownside_bookToZero() public {
        _deposit(alice, 10_000 * UNIT);
        uint256 navBefore = vault.navPerShareWad();
        assertApproxEqRel(navBefore, 1e18, 1e15);

        // Entire option book expires worthless. NAV must stay >= 0 and reflect
        // only the surviving idle reserve — never negative, never a revert.
        venue.setMarkAbsolute(0);
        uint256 nav = vault.navPerShareWad();
        assertGt(nav, 0, "nav went to zero/negative");
        assertLt(nav, navBefore, "loss not reflected");

        // Alice redeems; she can never get back more than her deposit, and the
        // vault never reverts into insolvency.
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares, alice, alice);
        assertLe(assetsOut, 10_000 * UNIT, "recovered more than deposited");
    }

    function testWindDownAtFloor() public {
        _deposit(alice, 10_000 * UNIT);

        // Book doubles -> new high-water mark.
        venue.setMarkBps(20_000); // 2x the book
        vm.prank(keeper);
        vault.pokeNav();

        // Then collapses 80% -> NAV draws > 60% off the peak -> wind down.
        venue.setMarkBps(2000); // -80%
        vm.prank(keeper);
        bool wd = vault.pokeNav();

        assertTrue(wd, "should have wound down");
        assertTrue(vault.depositsHalted(), "deposits not halted");
        assertEq(venue.markToMarket(), 0, "book not settled to reserve");

        // Deposits are blocked...
        assertEq(vault.maxDeposit(bob), 0, "deposits should be halted");
        vm.startPrank(bob);
        usdc.approve(address(vault), 1_000 * UNIT);
        vm.expectRevert();
        vault.deposit(1_000 * UNIT, bob);
        vm.stopPrank();

        // ...but redemptions still work (holders exit pro-rata).
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertGt(out, 0, "alice could not redeem after wind-down");
    }

    function testSingleLegCollapseIsSurvivable() public {
        // The vault holds an aggregate book; a partial loss (one leg) is just a
        // smaller mark, not a wind-down, as long as the floor isn't breached.
        _deposit(alice, 10_000 * UNIT);
        venue.setMarkBps(8000); // -20% (one leg-ish), still above the -60% floor
        vm.prank(keeper);
        bool wd = vault.pokeNav();
        assertFalse(wd, "minor drawdown should not wind down");
        assertFalse(vault.depositsHalted());
    }

    function testPerformanceFeeOnNewHighs() public {
        _deposit(alice, 10_000 * UNIT);
        uint256 treasShares0 = vault.balanceOf(treasury);

        venue.setMarkBps(15_000); // +50% book gain
        vm.prank(keeper);
        vault.pokeNav();

        assertGt(vault.balanceOf(treasury), treasShares0, "no perf fee minted");
    }

    function testAccessControl() public {
        // Only keeper can poke.
        vm.expectRevert();
        vault.pokeNav();

        // Only governor can set policy.
        vm.expectRevert();
        vault.setPremiumBps(5000);

        vm.prank(governor);
        vault.setPremiumBps(5000);
        assertEq(vault.premiumBps(), 5000);
    }

    function testDepositCapEnforced() public {
        vm.prank(governor);
        vault.setDepositCap(5_000 * UNIT);
        vm.startPrank(alice);
        usdc.approve(address(vault), 10_000 * UNIT);
        vm.expectRevert();
        vault.deposit(6_000 * UNIT, alice);
        vm.stopPrank();
    }

    /// @dev Fuzz: NAV/share is never negative and the vault never reverts on read.
    function testFuzz_navNonNegative(uint256 markBps) public {
        markBps = bound(markBps, 0, 50_000);
        _deposit(alice, 10_000 * UNIT);
        venue.setMarkBps(markBps);
        assertGe(vault.navPerShareWad(), 0);
        assertGe(vault.totalAssets(), 0);
    }
}
