// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WithdrawalQueue, IRedeemableVault} from "../src/periphery/WithdrawalQueue.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal ERC-4626-like vault: 1 share == 1 asset, redeem pays from balance.
contract MiniVault is ERC20, IRedeemableVault {
    MockUSDC public immutable usdc;

    constructor(MockUSDC _usdc) ERC20("Mini AFI", "mAFI") {
        usdc = _usdc;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function mintShares(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function previewRedeem(uint256 shares) public pure returns (uint256) {
        return shares; // 1:1
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        _burn(owner, shares);
        assets = shares;
        usdc.transfer(receiver, assets);
    }
}

contract WithdrawalQueueTest is Test {
    MockUSDC usdc;
    MiniVault vault;
    WithdrawalQueue queue;
    address gov = address(0xA11CE);
    address keeper = address(0xB0B);
    address alice = address(0xA1);
    address bob = address(0xB2);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new MiniVault(usdc);
        queue = new WithdrawalQueue(IRedeemableVault(address(vault)), gov, keeper);

        vault.mintShares(alice, 1000e6);
        vault.mintShares(bob, 500e6);
        usdc.mint(address(vault), 2_000e6); // vault liquidity to honour redemptions
    }

    function _request(address who, uint256 shares) internal returns (uint256 id) {
        vm.startPrank(who);
        vault.approve(address(queue), shares);
        id = queue.requestWithdrawal(shares);
        vm.stopPrank();
    }

    function testRequestEscrowsShares() public {
        uint256 id = _request(alice, 1000e6);
        assertEq(vault.balanceOf(alice), 0, "shares not escrowed");
        assertEq(vault.balanceOf(address(queue)), 1000e6);
        assertEq(queue.totalPendingShares(), 1000e6);
        id; // silence
    }

    function testFifoProcessAndClaim() public {
        uint256 aId = _request(alice, 1000e6);
        uint256 bId = _request(bob, 500e6);

        vm.prank(keeper);
        uint256 n = queue.process(10);
        assertEq(n, 2, "both processed");
        assertEq(queue.totalPendingShares(), 0);

        // Alice claims her assets.
        uint256 beforeBal = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 got = queue.claim(aId);
        assertEq(got, 1000e6);
        assertEq(usdc.balanceOf(alice) - beforeBal, 1000e6);

        // Bob claims.
        vm.prank(bob);
        assertEq(queue.claim(bId), 500e6);
    }

    function testOnlyKeeperProcesses() public {
        _request(alice, 100e6);
        vm.expectRevert();
        queue.process(1); // not keeper
    }

    function testCannotClaimUnprocessed() public {
        uint256 id = _request(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert();
        queue.claim(id);
    }

    function testCannotDoubleClaim() public {
        uint256 id = _request(alice, 100e6);
        vm.prank(keeper);
        queue.process(1);
        vm.prank(alice);
        queue.claim(id);
        vm.prank(alice);
        vm.expectRevert();
        queue.claim(id);
    }

    function testNonOwnerCannotClaim() public {
        uint256 id = _request(alice, 100e6);
        vm.prank(keeper);
        queue.process(1);
        vm.prank(bob);
        vm.expectRevert();
        queue.claim(id);
    }
}
