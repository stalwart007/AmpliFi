# @amplifi/contracts

The AmpliFi on-chain protocol: a hardened ERC-4626 vault that manufactures
leveraged, capped-downside exposure through an external options venue.

> **Status: production-grade Solidity, audit-pending.** Compiles clean against
> OpenZeppelin 5.1 (`solc 0.8.24`); behavioural + fuzz tests in `test/`.
> Independent audit and a live-venue adapter are required before mainnet custody
> of real funds.

## Contracts

| Contract | Role |
|----------|------|
| `AmplifiVault` | ERC-4626 vault (AFI shares). NAV = idle reserve + venue mark; routes premium to the venue; HWM performance fee; access control, reentrancy guard, pausable, deposit caps. |
| `RiskController` | Portfolio-level drawdown floor and wind-down (not per-asset liquidation). |
| `interfaces/IOptionsVenue` | Integration seam to a real options venue. The vault never fabricates returns; it reads `markToMarket()` and routes premium through this interface. |
| `mocks/MockOptionsVenue` | Test/testnet implementation of `IOptionsVenue`. |
| `mocks/MockUSDC` | 6-decimal mock stablecoin with a faucet (test/testnet). |

### Integration adapters (`src/integrations/`)

Reference (unaudited) adapters behind narrow seams, **decoupled from the vault's
custody core** — binding any of them is a governance + audit decision:

| Seam | Adapters | Covers |
|------|----------|--------|
| `IYieldSource` | `AaveV3YieldSource`, `ERC4626YieldSource` | Aave v3, Ethena (sUSDe), any ERC-4626 vault (Morpho/Yearn); idle-reserve yield via `YieldRouter` |
| `ISwapRouter` | `SushiSwapAdapter`, `ZeroExSwapAdapter` | Sushi + 0x routing; `RebalanceRouter` executes keeper-computed rebalances |
| `IRestakingModule` | `EigenLayerRestakeAdapter` | EigenLayer restaking exposure (LSTs) |
| `IBridgeAdapter` | `BridgeAdapter` | cross-chain (CCTP / LayerZero-shaped seam) |
| `IYieldTokenizer` | `PendleYieldTokenizer` | Pendle PT/YT yield tokenization (seam) |

Hyperliquid is an off-chain L1 perp venue — integrated keeper-side, not as a
Solidity adapter.

**Deploy + bind** (best on a mainnet fork, where every protocol exists at its
real address):

```bash
anvil --fork-url $MAINNET_RPC           # real contracts, fake money
# in another shell — set the real protocol addresses, then:
forge script script/DeployTestnet.s.sol:DeployTestnet --rpc-url http://127.0.0.1:8545 --broadcast --private-key $ANVIL_PK
forge script script/DeployIntegrations.s.sol:DeployIntegrations --rpc-url http://127.0.0.1:8545 --broadcast --private-key $ANVIL_PK
```

`DeployIntegrations` deploys only the adapters whose env addresses are set
(`ASSET`, `AAVE_POOL`/`AAVE_ATOKEN`, `YIELD_VAULT`, `SUSHI_ROUTER`/`ZEROX_PROXY`,
`EIGEN_MANAGER`/`EIGEN_STRATEGY`/`LST`). Verify all addresses against each
protocol's official docs.

## Design: the vault never invents returns

NAV is computed as:

```
totalAssets() = IERC20(asset).balanceOf(vault)  +  venue.markToMarket()
                └─ idle reserve ─┘                 └─ external book value ─┘
```

For a long-option book the venue's mark is always ≥ 0, so NAV/share can never go
negative — the on-chain expression of the capped-downside guarantee. The seam
between *audited vault accounting* and *external market integration* is exactly
`IOptionsVenue`.

## Build & test

```bash
npm install
npm run compile     # solc 0.8.24 + OpenZeppelin 5.1 — validity check
```

With [Foundry](https://book.getfoundry.sh/) installed:

```bash
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
forge test -vvv     # behavioural + fuzz suite
forge script script/DeployDemo.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

## Security posture

Role-separated control (GOVERNOR sets policy, KEEPER pokes NAV/harvests, ADMIN
manages roles); reentrancy-guarded asset moves; emergency pause; deposit halt
latched on wind-down (redemptions stay open); performance fee hard-capped at 20%.
Independent audit + live-venue integration are required before mainnet.

## License

`UNLICENSED` — all rights reserved. See the repository root `LICENSE`.
