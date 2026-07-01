// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SignedPriceOracle} from "../src/oracle/SignedPriceOracle.sol";

contract SignedPriceOracleTest is Test {
    SignedPriceOracle oracle;
    address admin = address(0xA11CE);
    uint256 signerKey = 0x5161E;
    address signerAddr;

    function setUp() public {
        signerAddr = vm.addr(signerKey);
        oracle = new SignedPriceOracle(admin, signerAddr, 8, 1 hours, 1000); // 10% max move
    }

    function _sign(uint256 price, uint256 ts, uint256 nonce, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = oracle.hashUpdate(price, ts, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function testValidUpdateAccepted() public {
        uint256 ts = block.timestamp;
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
        (uint256 p, uint256 at) = oracle.latestAnswer();
        assertEq(p, 2000e8);
        assertEq(at, ts);
        assertEq(oracle.nonce(), 1);
    }

    function testWrongSignerRejected() public {
        uint256 ts = block.timestamp;
        vm.expectRevert();
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, 0xBAD)); // not the signer
    }

    function testReplayRejected() public {
        uint256 ts = block.timestamp;
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
        vm.expectRevert(); // nonce 1 already used → expects nonce 2
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
    }

    function testStaleRejected() public {
        vm.warp(10 days);
        uint256 ts = block.timestamp - 2 hours; // older than 1h maxStaleness
        vm.expectRevert();
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
    }

    function testFutureRejected() public {
        uint256 ts = block.timestamp + 1;
        vm.expectRevert();
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
    }

    function testDeviationBounded() public {
        uint256 ts = block.timestamp;
        oracle.submitPrice(2000e8, ts, 1, _sign(2000e8, ts, 1, signerKey));
        // +50% jump exceeds the 10% bound
        vm.expectRevert();
        oracle.submitPrice(3000e8, ts, 2, _sign(3000e8, ts, 2, signerKey));
        // +5% is fine
        oracle.submitPrice(2100e8, ts, 2, _sign(2100e8, ts, 2, signerKey));
        (uint256 p, ) = oracle.latestAnswer();
        assertEq(p, 2100e8);
    }

    function testNoPriceReverts() public {
        vm.expectRevert();
        oracle.latestAnswer();
    }
}
