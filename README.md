# AmpliFi

A leveraged, capped-downside synthetic crypto index built from a basket of long
perpetual options. A small deposit takes on the behaviour of a large, diversified
basket: convex upside, downside capped at the premium paid, and a portfolio-level
wind-down instead of per-asset liquidation.

This repository is a **monorepo** built around a single source of quantitative
truth — a deterministic, dependency-free quant core that every other layer
consumes — so the numbers a user sees, the risk a keeper enforces, and the
parameters that govern the contracts are computed by the _same_ tested code.

[![ci](https://img.shields.io/badge/ci-typecheck%20%2B%20verify-blue)](./.github/workflows/ci.yml)
[![status](https://img.shields.io/badge/status-testnet--grade%20·%20audit%20pending-orange)](./PRODUCTION_READINESS.md)
[![types](https://img.shields.io/badge/TypeScript-strict-blue)](#)

> **Maturity, stated plainly:** this is a **testnet-grade research protocol**, not
> a production system. The contracts are **unaudited**, NAV is currently sourced
> from a **mock options venue** (the real Panoptic binding is a reference adapter,
> not yet wired to live pools), and the services are **reference implementations**.
> Do not custody real funds. See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

## Component status (read this first)

Every component states plainly how far it has been taken. Run `npm test` for the
live, self-reported check counts per package (the suite is the source of truth;
this table deliberately avoids hard-coding numbers that drift).

| Component                    | What it is                                                            | Status                                                                                |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/quant-core`        | BSM · binomial/American · barrier · Heston · exotics · IV · SVI · VaR | TS library — deterministic, strict types, tested via `npm test`                        |
| `packages/strategy-core`     | ERC basket, hedge, epoch, costs, jump stress, analytics               | TS library — deterministic property tests                                              |
| `packages/svc-kit`           | Shared HTTP server + input validation + structured logging            | TS library — tested                                                                    |
| `packages/market-data`       | Feed adapters (synthetic + replay), CSV, vol/covariance est.          | TS library — tested                                                                    |
| `packages/protocol-bindings` | Typed ABIs + provider-abstracted `VaultClient`                        | TS library — in-memory provider; viem provider is a reference stub                     |
| `packages/portfolio-opt`     | Mean-variance · max-Sharpe · risk-budgeting/ERC · Black–Litterman     | TS library — optimality-checked                                                        |
| `apps/research`              | Backtest + scenario harness, parameter sweeps, perf reports           | Working CLI app                                                                        |
| `services/pricing-api`       | HTTP: greeks / IV / SVI surface / Monte-Carlo VaR                     | Reference service — **no auth/rate-limit/TLS yet**                                     |
| `services/risk-engine`       | Scheduled VaR/ES + risk-limit breach detection + alerts               | Reference service — **no auth/rate-limit/TLS yet**                                     |
| `services/keeper`            | Off-chain agent driving the strategy                                  | Reference service — drives the **in-memory engine**; live chain client pending         |
| `contracts/`                 | Gated vault · RiskController · AllowlistGate · Panoptic adapter · gov  | 🟠 **Unaudited.** Compiles vs OZ 5.1, Foundry suite passes; NAV from a **mock venue**  |
| `apps/terminal`              | React dashboard driving the real TS engine in-browser                 | Working app — in-browser simulation (no live transactions yet)                         |

The quant/strategy **TS libraries are the most mature part** and are tested and
deterministic. The **on-chain protocol is written to production standards**
(role-based access control, reentrancy guards, pausability, deposit caps, a
portfolio-level `RiskController`, a hardened `setVenue` + slippage floor, and a
clean `IOptionsVenue` seam so the vault never fabricates returns) **but it is not
production-ready**: it is unaudited and its returns engine is a mock.

Before this could custody real funds on mainnet, all of the following must be
true: an **independent security audit** (remediated), a **live audited
options-venue adapter** bound in place of the mock (the real Panoptic
`PanopticPool`/`CollateralTracker`), governance behind the timelock + multisig,
and a monitored keeper. No amount of in-house testing substitutes for the audit.
Until then, testnet only. See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

## Repository layout

```
amplifi/
├── packages/
│   ├── quant-core/        ✅ pricing · IV · SVI surface · Monte-Carlo VaR (pure TS)
│   ├── strategy-core/     ✅ ERC basket · hedging · epochs · costs · jumps · analytics
│   ├── svc-kit/           ✅ shared HTTP server · validation · logging
│   ├── market-data/       ✅ feed adapters · replay · vol/covariance estimation
│   └── protocol-bindings/ ✅ typed ABIs · provider-abstracted VaultClient
├── services/
│   ├── pricing-api/       ✅ HTTP: greeks · IV · surface · VaR
│   ├── risk-engine/       ✅ scheduled VaR/ES · limit breaches · alerts
│   └── keeper/            ✅ off-chain agent driving the strategy on-chain
├── contracts/             🟡 ERC-4626 vault · RiskController · venue seam (Solidity)
├── apps/
│   ├── terminal/          ✅ live React dashboard on the real engine (Vite)
│   └── research/          ✅ backtest + scenario harness (CLI)
├── ARCHITECTURE.md        full target architecture + roadmap
├── PRODUCTION_READINESS.md pre-mainnet checklist
├── SECURITY_REVIEW.md     internal self-review (audit-scoping)
└── .github/workflows/     CI: typecheck · lint · verify · Foundry
```

## Quick start

Requires Node ≥ 20 and npm ≥ 9 (workspaces).

```bash
npm install            # installs all workspaces and links @amplifi/* packages

npm run typecheck      # strict tsc across every package
npm test               # runs both numerical/property verification harnesses
```

Run a single package:

```bash
npm test -w @amplifi/quant-core
npm test -w @amplifi/strategy-core
```

## Run the terminal (frontend)

A live dashboard that drives the **real** `strategy-core` + `quant-core` engines
in the browser — deploy a vault, step it through a (optionally jump-stressed)
market, and watch NAV, drawdown, basket weights, Monte-Carlo VaR/ES, leverage,
Sharpe, and the event log update in real time.

```bash
npm install
npm run dev -w @amplifi/terminal     # http://localhost:5173
# or a production build:
npm run build -w @amplifi/terminal
```

Toggle **ERC weights** vs inverse-vol, turn on **jump stress**, and adjust drift,
deposit, transaction cost, and speed from the control bar. Because it runs the
same engine as the keeper, what the terminal shows is what the strategy does.

## Run the services (backend)

Three runnable Node services, all over the shared `quant-core` / `strategy-core`:

```bash
npm run start -w @amplifi/pricing-api    # :8801 — POST /price /iv /surface /var
npm run start -w @amplifi/risk-engine    # :8802 — POST /evaluate (VaR + breaches)
npm run start -w @amplifi/keeper         # runs the off-chain agent against the in-memory vault
```

Example — live option greeks from the pricing API:

```bash
curl -s localhost:8801/price -H 'content-type: application/json' \
  -d '{"s":64000,"k":64000,"t":0.082,"vol":0.55,"r":0.05,"b":0,"type":"call"}'
```

The **keeper** is the off-chain agent: it advances the strategy state machine,
reports the book value to the vault (here an in-memory mirror of `AmplifiVault`),
and pokes the `RiskController` so the chain winds down on a floor breach — keeping
the on-chain NAV exactly in sync with the strategy. Swap the in-memory chain for a
viem-backed client to drive the real contracts; the keeper logic is unchanged.

## What the libraries give you

```ts
import { priceGreeks, impliedVol, VolSurface, monteCarloVar } from "@amplifi/quant-core";
import { createState, deploy, step, CorrelatedGbm, flatCorrelationMarket } from "@amplifi/strategy-core";

// Price an ATM perpetual-style call and read its full greek vector
const g = priceGreeks({ s: 64000, k: 64000, t: 30 / 365, vol: 0.55, r: 0.05, b: 0, type: "call" });

// Stand up a strategy, deploy premium, and step it through a market path
const assets = [{ sym: "BTC", spot: 64000, vol: 0.55, active: true }];
const cfg = flatCorrelationMarket(assets, 0.4, 0.2, 1, 42n);
const gbm = new CorrelatedGbm({ BTC: 64000 }, cfg);
let s = deploy(createState(assets), 1000).state;
for (let d = 0; d < 60 && !s.closed; d++) s = step(s, undefined, gbm.next()).state;
```

## Design principles

- **One pricing truth.** No module re-implements Black–Scholes; all greeks, IV,
  and VaR flow from `quant-core`. The UI and the keeper can never disagree.
- **Capped downside, by construction.** Every leg is a long option, so the worst
  case is the premium paid. This is asserted in the libraries' tests and is the
  intended invariant of the on-chain `RiskController`.
- **Determinism.** Given a seed, the PRNG → risk numbers are reproducible
  bit-for-bit across machines.
- **Honest status.** Every module header and this README state plainly what is
  running, simulated, or reference.

## Testing & verification

The libraries are verified by property-based numerical harnesses that assert
implementation-independent facts (not just "it runs"):

- **quant-core (38 checks):** high-precision Φ (West, ~1e-14) incl. deep tails,
  put–call parity ≈ 0, every greek vs. central finite differences, implied-vol
  round-trips, Cholesky reconstruction, Higham repair of indefinite matrices, SVI
  arbitrage flags, Monte-Carlo tail sanity (VaR ≥ 0, ES ≥ VaR, loss ≤ premium),
  and a measured **2.16× variance reduction** from antithetic sampling.
- **strategy-core (36 checks):** inverse-vol and **Equal-Risk-Contribution**
  weighting (verified equal risk contributions), premium = equity, manufactured
  leverage > 1, NAV ≥ 0 on every path, single-leg-collapse survivability,
  whole-book wind-down at the floor, NAV-neutral re-strikes, **transaction-cost**
  accounting, **jump-diffusion** fatter tails, reserve monotonicity, performance
  analytics, and seed determinism.
- **services (47 checks):** svc-kit validation + live HTTP round-trips (17),
  pricing-api end-to-end over real sockets (7), risk-engine monitor/scheduler/HTTP
  (12), and keeper bootstrap → NAV-sync → wind-down propagation → determinism (11).
- **data, bindings & research (37 checks):** market-data feeds/replay/estimators
  (14), protocol-bindings ABI + `VaultClient` over the in-memory provider (13),
  and the backtest harness — report shape, determinism, cost-sweep monotonicity (10).

Advanced pricing models add 18 more quant-core checks: binomial → Black–Scholes
convergence and American early-exercise premium; barrier options via in/out
parity **and** a Monte-Carlo cross-check; a **Heston stochastic-vol** pricer
(Little-Trap characteristic function) validated against both the Black–Scholes
limit and a Monte-Carlo Heston simulation; and **exotics** — geometric Asian
(Kemna–Vorst, MC-checked), cash/asset-or-nothing digitals (exact decomposition),
and variance-swap replication (flat smile ⇒ fair vol = σ).

A **portfolio-opt** package adds 15 optimality-verified checks: the global
minimum-variance portfolio (beats 200 random perturbations), the tangency
portfolio (Sharpe ≥ equal-weight), efficient-frontier target-return points,
risk-budgeting/ERC (risk contributions match the budget exactly), and
Black–Litterman (no-views identity + a view tilts the right asset) — all built on
quant-core's new SPD Cholesky solver.

Run `npm test` for the current totals (the suite self-reports per package) plus
the Solidity compile, and `forge test` in `contracts/` for the on-chain suite.
The check counts above are illustrative of coverage areas, not a maintained tally.

CI runs `npm run typecheck`, `npm run lint`, and `npm test` (incl. the solc
contract compile) on every push, plus a Foundry job for the on-chain tests.

## On-chain protocol (`contracts/`)

A hardened ERC-4626 vault stack written to production standards — but **unaudited,
and currently marking NAV off a mock venue on testnet**. It compiles against
OpenZeppelin 5.1 and the Foundry suite passes:

- **`AmplifiVault`** — ERC-4626 shares (AFI). NAV = `idle reserve + venue mark`;
  the vault never invents returns. Role-based access (GOVERNOR / KEEPER / ADMIN),
  `ReentrancyGuard`, `Pausable`, deposit caps, and a high-water-mark performance
  fee. A configurable fraction of each deposit is routed to the venue as premium.
- **`RiskController`** — portfolio-level drawdown floor and wind-down (not
  per-asset liquidation); halts deposits and settles the book on a floor breach.
- **`IOptionsVenue`** — the integration seam to a real options venue (Panoptic /
  Aperture / perp-options AMM). `MockOptionsVenue` implements it for tests and
  testnet; a production deployment binds an audited live adapter here.

```bash
cd contracts
npm install
npm run compile        # solc 0.8.24 against OpenZeppelin 5.1 (this repo's check)
forge test             # full behavioural + fuzz suite (requires Foundry)
```


## License

`UNLICENSED` — all rights reserved. This source grants no reuse rights and is
intended to remain private. Do not redistribute.
