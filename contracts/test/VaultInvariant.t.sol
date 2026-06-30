// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AmplifiVault} from "../src/AmplifiVault.sol";
import {RiskController} from "../src/RiskController.sol";
import {MockOptionsVenue} from "../src/mocks/MockOptionsVenue.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IOptionsVenue} from "../src/interfaces/IOptionsVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  VaultHandler
 * @notice Drives the vault with bounded, randomised deposit / redeem / mark-move
 *         actions for invariant testing. The mock venue's mark is scaled to
 *         simulate market P&L (including deep losses), exercising the
 *         capped-downside accounting under adversarial sequences.
 */
contract VaultHandler is Test {
    AmplifiVault public vault;
    MockOptionsVenue public venue;
    MockUSDC public usdc;
    address[] internal actors;
    uint256 public ghostDeposited; // total ever deposited (monotonic)

    constructor(AmplifiVault v, MockOptionsVenue ve, MockUSDC u, address[] memory a) {
        vault = v;
        venue = ve;
        usdc = u;
        actors = a;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function deposit(uint256 amt, uint256 actorSeed) external {
        address who = _actor(actorSeed);
        amt = bound(amt, 1e6, 50_000e6);
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), amt);
        try vault.deposit(amt, who) {
            ghostDeposited += amt;
        } catch {}
        vm.stopPrank();
    }

    function redeem(uint256 shareSeed, uint256 actorSeed) external {
        address who = _actor(actorSeed);
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        uint256 sh = bound(shareSeed, 1, bal);
        vm.startPrank(who);
        try vault.redeem(sh, who, who) {} catch {}
        vm.stopPrank();
    }

    function moveMark(uint256 bps) external {
        venue.setMarkBps(bound(bps, 1000, 20000)); // -90% .. +100%
    }
}

/**
 * @title  VaultInvariantTest
 * @notice Foundry invariant suite. Asserts the protocol's core accounting
 *         properties hold under any randomised sequence of deposits, redemptions
 *         and mark moves:
 *           1. NAV identity — totalAssets == idle + venue mark (never fabricated).
 *           2. Share price stays positive while shares exist.
 *           3. No phantom shares — outstanding shares never claim more than the
 *              vault actually holds (capped-downside / no over-issuance).
 */
contract VaultInvariantTest is Test {
    MockUSDC usdc;
    MockOptionsVenue venue;
    RiskController risk;
    AmplifiVault vault;
    VaultHandler handler;

    address governor = address(0xA11CE);
    address keeper = address(0xB0B);
    address treasury = address(0x7EE);

    function setUp() public {
        usdc = new MockUSDC();
        venue = new MockOptionsVenue(address(usdc), 7);
        risk = new RiskController(governor, 4000);
        vault = new AmplifiVault(
            IERC20(address(usdc)),
            "Amplifi Index",
            "AFI",
            governor,
            keeper,
            IOptionsVenue(address(venue)),
            risk,
            treasury,
            8000,
            1000,
            type(uint256).max
        );

        bytes32 vaultRole = risk.VAULT_ROLE();
        vm.prank(governor);
        risk.grantRole(vaultRole, address(vault));

        // Pre-fund the venue so settle() can always pay out.
        usdc.mint(address(venue), 100_000_000e6);

        address[] memory actors = new address[](3);
        actors[0] = address(0xA1);
        actors[1] = address(0xA2);
        actors[2] = address(0xA3);
        handler = new VaultHandler(vault, venue, usdc, actors);
        venue.transferOwnership(address(handler)); // handler controls the mark

        targetContract(address(handler));
    }

    function invariant_navIdentity() public view {
        assertEq(vault.totalAssets(), usdc.balanceOf(address(vault)) + venue.markToMarket(), "NAV identity broken");
    }

    function invariant_sharePricePositive() public view {
        if (vault.totalSupply() > 0) {
            assertGt(vault.navPerShareWad(), 0, "share price went to zero with shares outstanding");
        }
    }

    function invariant_noPhantomShares() public view {
        // Outstanding shares must never be redeemable for more than the vault holds.
        assertLe(vault.convertToAssets(vault.totalSupply()), vault.totalAssets() + 1, "shares over-issued vs assets");
    }
}
