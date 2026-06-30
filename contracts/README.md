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
