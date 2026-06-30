// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AmplifiVault} from "../src/AmplifiVault.sol";
import {RiskController} from "../src/RiskController.sol";
import {MockOptionsVenue} from "../src/mocks/MockOptionsVenue.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IOptionsVenue} from "../src/interfaces/IOptionsVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Testnet deployment wiring (Sepolia). Deploys the mock USDC + mock
 *         venue and the full vault stack. For mainnet, swap `MockOptionsVenue`
 *         for the audited live-venue adapter and pass the real USDC address.
 *
 *         Usage:
 *           forge script script/DeployDemo.s.sol --rpc-url $SEPOLIA_RPC \
 *             --broadcast --private-key $PK
 */
contract DeployDemo is Script {
    function run() external {
        address governor = vm.envOr("GOVERNOR", msg.sender);
        address keeper = vm.envOr("KEEPER", msg.sender);
        address treasury = vm.envOr("TREASURY", msg.sender);

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        MockOptionsVenue venue = new MockOptionsVenue(address(usdc), 7);
        RiskController risk = new RiskController(governor, 4000);

        AmplifiVault vault = new AmplifiVault(
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
            1_000_000e6
        );

        // Grant the vault permission to drive the risk controller.
        risk.grantRole(risk.VAULT_ROLE(), address(vault));

        vm.stopBroadcast();

        // solhint-disable-next-line no-console
        // (addresses are emitted by --broadcast logs)
        vault;
    }
}
