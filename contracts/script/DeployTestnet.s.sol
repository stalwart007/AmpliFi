// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AmplifiGatedVault} from "../src/AmplifiGatedVault.sol";
import {RiskController} from "../src/RiskController.sol";
import {AllowlistGate} from "../src/access/AllowlistGate.sol";
import {AmplifiTimelock} from "../src/governance/AmplifiTimelock.sol";
import {MultisigGuardian} from "../src/governance/MultisigGuardian.sol";
import {PanopticVenueAdapter} from "../src/venues/PanopticVenueAdapter.sol";
import {OracleHardenedVenue} from "../src/OracleHardenedVenue.sol";
import {MockPanopticPool} from "../src/mocks/MockPanopticPool.sol";
import {MockOptionsVenue} from "../src/mocks/MockOptionsVenue.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IOptionsVenue} from "../src/interfaces/IOptionsVenue.sol";
import {IAllowlistGate} from "../src/interfaces/IAllowlistGate.sol";
import {IPanopticPool} from "../src/interfaces/IPanopticPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  DeployTestnet
 * @notice Deploys the full PERMISSIONED AmpliFi stack to a TESTNET (Base
 *         Sepolia): allowlist gate, risk controller, a mock Panoptic pool +
 *         the PanopticVenueAdapter, and the gated ERC-4626 vault — with roles
 *         and the operator allowlist wired up.
 *
 *         THIS IS FOR TESTNET ONLY. Mainnet is intentionally not targeted here:
 *         it requires (1) an independent audit, (2) the REAL Panoptic
 *         PanopticPool + CollateralTracker bound behind `IPanopticPool` instead
 *         of `MockPanopticPool`, (3) the real USDC, and (4) GOVERNOR handed to
 *         the timelock + multisig. See the README.
 *
 *         Usage (Base Sepolia):
 *           forge script script/DeployTestnet.s.sol:DeployTestnet \
 *             --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PK
 */
contract DeployTestnet is Script {
    function run() external {
        address governor = vm.envOr("GOVERNOR", msg.sender);
        address keeper = vm.envOr("KEEPER", msg.sender);
        address treasury = vm.envOr("TREASURY", msg.sender);
        uint256 tokenId = vm.envOr("PANOPTIC_TOKENID", uint256(0xA3F1));
        uint256 leverageX = vm.envOr("LEVERAGE_X", uint256(6));

        vm.startBroadcast();

        // 1. Core dependencies.
        MockUSDC usdc = new MockUSDC(); // testnet stablecoin (real USDC on mainnet)
        RiskController risk = new RiskController(governor, 4000); // wind down at -60%
        AllowlistGate gate = new AllowlistGate(governor);
        MockPanopticPool pool = new MockPanopticPool(address(usdc)); // testnet Panoptic stand-in

        // 2. The gated vault needs a venue at construction; bootstrap with a mock
        //    and repoint to the Panoptic adapter once it exists.
        MockOptionsVenue bootVenue = new MockOptionsVenue(address(usdc), leverageX);
        AmplifiGatedVault vault = new AmplifiGatedVault(
            IERC20(address(usdc)),
            "Amplifi Index",
            "AFI",
            governor,
            keeper,
            IOptionsVenue(address(bootVenue)),
            risk,
            treasury,
            8000, // premiumBps: 80% of each deposit routed as premium
            1000, // perfFeeBps: 10% high-water-mark fee
            1_000_000e6, // deposit cap (guarded launch)
            IAllowlistGate(address(gate))
        );

        // 3. The Panoptic venue adapter: owned by the vault, configured by keeper.
        PanopticVenueAdapter adapter = new PanopticVenueAdapter(pool, address(vault), keeper);
        // (keeper == broadcaster on testnet) configure the position template.
        adapter.setPositionTemplate(tokenId);
        adapter.setLeverage(leverageX);

        // 4. Wire roles and choose the active venue. Default is the Panoptic
        //    adapter; set USE_ORACLE_VENUE=true to instead bind the
        //    OracleHardenedVenue (staleness + deviation guards + guardian exit),
        //    demonstrating the oracle-hardened mark path end-to-end.
        if (vm.envOr("USE_ORACLE_VENUE", false)) {
            MockPriceOracle oracle = new MockPriceOracle(2000e8, 8); // testnet feed
            OracleHardenedVenue ohv = new OracleHardenedVenue(
                address(usdc),
                IPriceOracle(address(oracle)),
                governor,
                address(vault),
                governor, // guardian (emergency pause/exit)
                leverageX,
                1 hours, // maxStaleness
                500 // maxDeviationBps (5%)
            );
            vault.allowVenue(address(ohv), true);
            vault.setVenue(IOptionsVenue(address(ohv)));
            oracle;
            ohv;
        } else {
            vault.allowVenue(address(adapter), true);
            vault.setVenue(IOptionsVenue(address(adapter))); // GOVERNOR-only
        }
        risk.grantRole(risk.VAULT_ROLE(), address(vault));

        // 5. Allowlist the operators so they can deposit through the gate.
        gate.setAllowed(governor, true, 0);
        if (keeper != governor) gate.setAllowed(keeper, true, 0);

        // 6. Decentralise governance BY DEFAULT: deploy a multisig guardian +
        //    timelock and hand the vault's & RiskController's GOVERNOR/admin roles
        //    to the timelock, then drop the deployer's privileges. Set
        //    DECENTRALIZE=false to keep EOA governance for local iteration.
        //    (Done last, after all GOVERNOR-gated setup above, so the deployer
        //    still has the rights it needs while wiring.)
        if (vm.envOr("DECENTRALIZE", true)) {
            uint256 minDelay = vm.envOr("TIMELOCK_DELAY", uint256(2 days));

            address[] memory owners = new address[](1);
            owners[0] = governor; // mainnet: pass a real m-of-n owner set
            MultisigGuardian guardian = new MultisigGuardian(owners, 1);

            address[] memory proposers = new address[](1);
            proposers[0] = address(guardian);
            address[] memory executors = new address[](1);
            executors[0] = address(guardian);
            AmplifiTimelock timelock = new AmplifiTimelock(minDelay, proposers, executors, address(0));

            // Vault: timelock becomes GOVERNOR + admin; deployer steps down.
            vault.grantRole(vault.GOVERNOR_ROLE(), address(timelock));
            vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(timelock));
            vault.revokeRole(vault.GOVERNOR_ROLE(), governor);

            // RiskController: same handoff.
            risk.grantRole(risk.GOVERNOR_ROLE(), address(timelock));
            risk.grantRole(risk.DEFAULT_ADMIN_ROLE(), address(timelock));
            risk.revokeRole(risk.GOVERNOR_ROLE(), governor);

            // Finally renounce the deployer's admin on both (must be last).
            vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), governor);
            risk.renounceRole(risk.DEFAULT_ADMIN_ROLE(), governor);

            guardian;
            timelock;
        }

        vm.stopBroadcast();

        // Addresses are emitted in the --broadcast logs.
        usdc;
        risk;
        gate;
        pool;
        vault;
        adapter;
    }
}
