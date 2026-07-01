// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AaveV3YieldSource} from "../src/integrations/AaveV3YieldSource.sol";
import {ERC4626YieldSource} from "../src/integrations/ERC4626YieldSource.sol";
import {SushiSwapAdapter} from "../src/integrations/SushiSwapAdapter.sol";
import {ZeroExSwapAdapter} from "../src/integrations/ZeroExSwapAdapter.sol";
import {EigenLayerRestakeAdapter} from "../src/integrations/EigenLayerRestakeAdapter.sol";
import {YieldRouter} from "../src/integrations/YieldRouter.sol";
import {RebalanceRouter} from "../src/integrations/RebalanceRouter.sol";
import {ISwapRouter, IUniswapV2Router, IAaveV3Pool, IEigenStrategyManager} from "../src/integrations/Interfaces.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title  DeployIntegrations
 * @notice Deploys and wires the integration adapter layer against REAL protocol
 *         addresses supplied by env. Each adapter is only deployed if its
 *         address(es) are set, so you bind exactly the protocols available on
 *         your target network. Best run against a MAINNET FORK
 *         (`anvil --fork-url $MAINNET_RPC`) where every protocol exists at its
 *         real address — real contract logic, fake money.
 *
 *         Env:
 *           ASSET           the reserve/underlying token (must match the yield vault's asset)
 *           AAVE_POOL, AAVE_ATOKEN     → AaveV3YieldSource
 *           YIELD_VAULT               → ERC4626YieldSource (Ethena sUSDe / Morpho / Yearn)
 *           SUSHI_ROUTER  or  ZEROX_PROXY  → swap adapter + RebalanceRouter
 *           EIGEN_MANAGER, EIGEN_STRATEGY, LST → EigenLayerRestakeAdapter
 *
 *         Usage:
 *           forge script script/DeployIntegrations.s.sol:DeployIntegrations \
 *             --rpc-url $RPC --broadcast --private-key $PK
 */
contract DeployIntegrations is Script {
    function run() external {
        address owner = vm.envOr("GOVERNOR", msg.sender);
        address asset = vm.envAddress("ASSET");

        vm.startBroadcast();

        // ── swap + rebalance ──────────────────────────────────────────────
        address sushiRouter = vm.envOr("SUSHI_ROUTER", address(0));
        address zeroExProxy = vm.envOr("ZEROX_PROXY", address(0));
        ISwapRouter swapAdapter;
        if (sushiRouter != address(0)) {
            swapAdapter = new SushiSwapAdapter(IUniswapV2Router(sushiRouter));
        } else if (zeroExProxy != address(0)) {
            swapAdapter = new ZeroExSwapAdapter(zeroExProxy);
        }
        if (address(swapAdapter) != address(0)) {
            RebalanceRouter rebal = new RebalanceRouter(swapAdapter, owner);
            rebal;
        }

        // ── idle-reserve yield ────────────────────────────────────────────
        YieldRouter yieldRouter = new YieldRouter(asset, owner);
        address aavePool = vm.envOr("AAVE_POOL", address(0));
        address aToken = vm.envOr("AAVE_ATOKEN", address(0));
        address yieldVault = vm.envOr("YIELD_VAULT", address(0));
        if (aavePool != address(0) && aToken != address(0)) {
            AaveV3YieldSource ys = new AaveV3YieldSource(IAaveV3Pool(aavePool), asset, aToken, address(yieldRouter));
            yieldRouter.setSource(ys);
        } else if (yieldVault != address(0)) {
            ERC4626YieldSource ys = new ERC4626YieldSource(IERC4626(yieldVault), address(yieldRouter));
            yieldRouter.setSource(ys); // requires ASSET == vault.asset()
        }

        // ── restaking exposure ────────────────────────────────────────────
        address eigenManager = vm.envOr("EIGEN_MANAGER", address(0));
        if (eigenManager != address(0)) {
            EigenLayerRestakeAdapter re = new EigenLayerRestakeAdapter(
                IEigenStrategyManager(eigenManager),
                vm.envAddress("EIGEN_STRATEGY"),
                vm.envAddress("LST"),
                owner
            );
            re;
        }

        vm.stopBroadcast();
        yieldRouter;
    }
}
