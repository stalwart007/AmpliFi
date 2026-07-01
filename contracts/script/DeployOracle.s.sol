// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SignedPriceOracle} from "../src/oracle/SignedPriceOracle.sol";

/**
 * @title  DeployOracle
 * @notice Deploys the private SignedPriceOracle. The off-chain signer
 *         (ORACLE_SIGNER) holds the proprietary model and publishes signed
 *         prices; this contract verifies them transparently on-chain.
 *
 *         Env:
 *           ORACLE_SIGNER            signer address (the keeper's oracle key)
 *           ORACLE_DECIMALS          price decimals (default 8)
 *           ORACLE_MAX_STALENESS     seconds (default 3600)
 *           ORACLE_MAX_DEVIATION_BPS max per-update move (default 1000 = 10%)
 *
 *           forge script script/DeployOracle.s.sol:DeployOracle \
 *             --rpc-url $RPC --broadcast --private-key $PK
 */
contract DeployOracle is Script {
    function run() external {
        address owner = vm.envOr("GOVERNOR", msg.sender);
        address signer = vm.envAddress("ORACLE_SIGNER");
        uint8 decimals = uint8(vm.envOr("ORACLE_DECIMALS", uint256(8)));
        uint256 staleness = vm.envOr("ORACLE_MAX_STALENESS", uint256(3600));
        uint256 deviation = vm.envOr("ORACLE_MAX_DEVIATION_BPS", uint256(1000));

        vm.startBroadcast();
        SignedPriceOracle oracle = new SignedPriceOracle(owner, signer, decimals, staleness, deviation);
        vm.stopBroadcast();

        oracle; // address emitted in the broadcast logs
    }
}
