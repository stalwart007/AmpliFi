// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockYieldVault, MockUniV2Router} from "../src/mocks/MockIntegrations.sol";
import {ERC4626YieldSource} from "../src/integrations/ERC4626YieldSource.sol";
import {YieldRouter} from "../src/integrations/YieldRouter.sol";
import {SushiSwapAdapter} from "../src/integrations/SushiSwapAdapter.sol";
import {RebalanceRouter} from "../src/integrations/RebalanceRouter.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IUniswapV2Router} from "../src/integrations/Interfaces.sol";

/// @notice Exercises the integration adapter layer end-to-end with mocks.
contract IntegrationsTest is Test {
    MockUSDC usdc;
    MockYieldVault vault4626;
    ERC4626YieldSource ys;
    YieldRouter router;

    function setUp() public {
        usdc = new MockUSDC();
        vault4626 = new MockYieldVault(usdc);
        router = new YieldRouter(address(usdc), address(this));
        ys = new ERC4626YieldSource(IERC4626(address(vault4626)), address(router));
        router.setSource(ys);
    }

    function testYieldDeployAndRecall() public {
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(router), 1_000e6);

        router.deploy(1_000e6);
        assertApproxEqAbs(router.deployedValue(), 1_000e6, 1, "deployed value off");

        router.recall(400e6, address(this));
        assertApproxEqAbs(router.deployedValue(), 600e6, 2, "recall value off");
        assertEq(usdc.balanceOf(address(this)), 400e6, "recall not received");
    }

    function testYieldSourceAssetMatchEnforced() public {
        MockUSDC other = new MockUSDC();
        MockYieldVault otherVault = new MockYieldVault(other);
        ERC4626YieldSource badYs = new ERC4626YieldSource(IERC4626(address(otherVault)), address(router));
        vm.expectRevert();
        router.setSource(badYs); // asset() != router asset
    }

    function testSwapRebalance() public {
        MockUSDC tokenA = new MockUSDC();
        MockUSDC tokenB = new MockUSDC();
        MockUniV2Router mockRouter = new MockUniV2Router();
        SushiSwapAdapter sushi = new SushiSwapAdapter(IUniswapV2Router(address(mockRouter)));
        RebalanceRouter rebal = new RebalanceRouter(sushi, address(this));

        tokenB.mint(address(mockRouter), 1_000e6); // router holds output liquidity
        tokenA.mint(address(this), 100e6);
        tokenA.approve(address(rebal), 100e6);

        RebalanceRouter.Leg[] memory legs = new RebalanceRouter.Leg[](1);
        legs[0] = RebalanceRouter.Leg({ tokenIn: address(tokenA), tokenOut: address(tokenB), amountIn: 100e6, minOut: 90e6, data: "" });
        rebal.rebalance(legs, address(this));

        assertEq(tokenB.balanceOf(address(this)), 100e6, "swap output not received");
        assertEq(tokenA.balanceOf(address(this)), 0, "input not spent");
    }
}
