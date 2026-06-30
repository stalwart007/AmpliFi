// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MultisigGuardian} from "../src/governance/MultisigGuardian.sol";
import {AmplifiTimelock} from "../src/governance/AmplifiTimelock.sol";

/// @notice Behavioural tests for the multisig + timelock. Run with `forge test`.
contract Counter {
    uint256 public x;
    function bump(uint256 by) external {
        x += by;
    }
}

contract GovernanceTest is Test {
    MultisigGuardian ms;
    Counter c;
    address a = address(0xA1);
    address b = address(0xB2);
    address d = address(0xC3);

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = a;
        owners[1] = b;
        owners[2] = d;
        ms = new MultisigGuardian(owners, 2); // 2-of-3
        c = new Counter();
    }

    function testRejectsBadThreshold() public {
        address[] memory owners = new address[](1);
        owners[0] = a;
        vm.expectRevert();
        new MultisigGuardian(owners, 2); // threshold > owners
    }

    function testTwoOfThreeExecutes() public {
        bytes memory data = abi.encodeWithSelector(Counter.bump.selector, 5);
        vm.prank(a);
        uint256 id = ms.submit(address(c), 0, data); // a confirms on submit
        // one confirmation so far → cannot execute
        vm.prank(a);
        vm.expectRevert();
        ms.execute(id);
        // second confirmation
        vm.prank(b);
        ms.confirm(id);
        vm.prank(b);
        ms.execute(id);
        assertEq(c.x(), 5);
    }

    function testNonOwnerCannotSubmit() public {
        vm.prank(address(0xdead));
        vm.expectRevert();
        ms.submit(address(c), 0, "");
    }

    function testRevokeLowersConfirmations() public {
        vm.prank(a);
        uint256 id = ms.submit(address(c), 0, abi.encodeWithSelector(Counter.bump.selector, 1));
        vm.prank(a);
        ms.revoke(id);
        vm.prank(b);
        ms.confirm(id);
        // only 1 confirmation now → execute reverts
        vm.prank(b);
        vm.expectRevert();
        ms.execute(id);
    }

    function testTimelockDelaysExecution() public {
        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open executor
        AmplifiTimelock tl = new AmplifiTimelock(2 days, proposers, executors, address(0));

        bytes memory data = abi.encodeWithSelector(Counter.bump.selector, 7);
        bytes32 salt = bytes32(uint256(1));
        // schedule via the timelock (must be called by a proposer = the multisig)
        bytes memory sched = abi.encodeWithSignature(
            "schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
            address(c),
            uint256(0),
            data,
            bytes32(0),
            salt,
            uint256(2 days)
        );
        vm.prank(a);
        uint256 sid = ms.submit(address(tl), 0, sched);
        vm.prank(b);
        ms.confirm(sid);
        vm.prank(b);
        ms.execute(sid);

        // executing before the delay reverts
        vm.expectRevert();
        tl.execute(address(c), 0, data, bytes32(0), salt);

        // after the delay it succeeds
        vm.warp(block.timestamp + 2 days + 1);
        tl.execute(address(c), 0, data, bytes32(0), salt);
        assertEq(c.x(), 7);
    }
}
