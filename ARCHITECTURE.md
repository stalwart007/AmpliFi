# AmpliFi — Expanded System Architecture

> Status: **active build-out.** This document is the target architecture for the
> expanded AmpliFi. It supersedes the original three-folder prototype (`app/`,
> `onchain/`, `contracts/`) by absorbing each of those into a layered monorepo
> with a shared, verified quantitative core. The original honesty principle from
> the prototype README still holds: every module states plainly whether it is
> _running_, _simulated_, or _reference design_.

## 1. Design goals

The prototype proved the idea (a leveraged, capped-downside synthetic crypto
index built from long perpetual options) but kept three disconnected
implementations of "the vault": a browser simulation, a testnet demo with
faked returns, and a compiling-but-unwired reference contract set. The
expansion has four explicit fronts, pursued together:

1. **Make the strategy real** — turn the `contracts/` blueprint into a wired,
   testable options/exposure engine with a deterministic off-chain keeper.
2. **Deepen the simulation** — replace the browser's ad-hoc math with the shared
   `quant-core` (real Black–Scholes greeks, SVI surface, Monte-Carlo VaR), and
   add market microstructure, signal models, and scenario tooling.
3. **Add backend + data** — real services: market-data ingestion, a pricing /
   risk API, the alpha service, persistence, and streaming to the front-end.
4. **Breadth of new domains** — governance, fee/treasury accounting, a keeper
   network, observability, and a backtesting/research harness.

The unifying principle: **one source of quantitative truth.** Pricing and risk
math lives in exactly one place (`packages/quant-core`), is pure and
deterministic, is covered by a numerical verification harness, and is consumed
identically by the simulator, the services, the keeper, and the research tools.
Divergence between "what the UI shows" and "what the strategy does" was the
prototype's core confusion; a shared core removes it by construction.

## 2. Monorepo layout (target)

```
amplifi/
├── packages/                      # shared, framework-agnostic libraries
│   ├── quant-core/                # BUILT — pricing, surface, risk (pure TS)
│   ├── strategy-core/             # exposure/rebalance/wind-down state machine
│   ├── market-data/               # feed adapters + normalisation + cache
│   ├── protocol-bindings/         # typed ABIs + viem clients (codegen)
│   └── shared-types/              # cross-cutting domain types + zod schemas
│
├── services/                      # deployable runtime processes
│   ├── pricing-api/               # HTTP/WS: greeks, IV, surface, marks
│   ├── risk-engine/               # scheduled VaR/ES, limit checks, alerts
│   ├── alpha-service/             # (hardened from prototype server/) signals
│   ├── keeper/                    # off-chain agent: rolls, hedges, epochs
│   └── gateway/                   # BFF/aggregation + auth for the front-end
│
├── apps/
│   ├── terminal/                  # (from prototype app/) trading dashboard
│   └── research/                  # notebooks/CLI over quant-core + backtests
│
├── onchain/                       # (from prototype) Foundry: vault + mocks
├── contracts/                     # (from prototype) reference strategy suite
│
├── infra/                         # docker-compose, migrations, CI, IaC
└── ARCHITECTURE.md                # this file
```

## 3. The quant core (built)

`packages/quant-core` is the foundation everything else stands on. It is pure
TypeScript with **zero runtime dependencies**, so it runs unchanged in a browser
worker, a Node service, the keeper, or a fuzz harness.

| Layer     | Module                 | What it provides                                                                                                              |
| --------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| numeric   | `numeric/stats`        | erf/Φ/φ, Acklam inverse-CDF, PCG-32 PRNG, Box–Muller, sample stats & quantiles                                                |
| numeric   | `numeric/linalg`       | row-major matrices, Cholesky, Jacobi eigensolver, Higham nearest-correlation, safe covariance factorisation                   |
| pricing   | `pricing/blackscholes` | generalised BSM (carry `b`) with full greeks incl. vanna/volga; put–call parity residual                                      |
| pricing   | `pricing/impliedvol`   | safeguarded Newton+bisection IV inversion with no-arbitrage bounds                                                            |
| surface   | `surface/svi`          | raw-SVI total-variance slices, static + density arbitrage checks, term-structure `VolSurface`, coordinate-descent calibration |
| portfolio | `portfolio/greeks`     | book-level greek aggregation, dollar greeks, delta-drift vs. target                                                           |
| risk      | `risk/montecarlo`      | correlated one-step GBM via Cholesky, **full-revaluation** VaR/ES, covariance estimation from price history                   |

**Verification.** `test/verify.ts` asserts implementation-independent
properties: Φ against published values, put–call parity ≈ 0, every greek
against central finite differences, implied-vol round-trips, `LLᵀ`
reconstruction, Higham repair of an indefinite matrix, SVI arbitrage flags, and
Monte-Carlo tail sanity (VaR ≥ 0, ES ≥ VaR, capped downside ≤ premium paid).
**Current status: 28/28 checks pass, strict `tsc` clean.**

Why full-revaluation VaR rather than delta-normal: the book is long convex
options, so a Taylor/delta-normal approximation systematically misprices both
the convex upside and the capped downside that _is_ the product. The engine
re-prices the whole book on every path; that cost buys correct tails.

## 4. Data & control flow (target)

```
        market venues (CEX/DEX, oracles)
                  │  raw ticks, books, funding
                  ▼
        packages/market-data  ── normalise ─▶ services/pricing-api
                  │                                   │ greeks, IV, SVI marks
                  │                                   ▼
                  │                         services/risk-engine ──▶ alerts/limits
                  │                                   │ VaR/ES, exposure
                  ▼                                   ▼
        services/alpha-service ─ signals ─▶ packages/strategy-core (state machine)
                                                      │ target weights, rolls, hedges
                          ┌───────────────────────────┴───────────────┐
                          ▼                                            ▼
                  services/keeper ──tx──▶ onchain/ + contracts/   apps/terminal (UI)
                          │  deposits, rolls, epoch, wind-down          ▲
                          └───────── protocol-bindings (viem) ──────────┘
```

All quantitative arrows (greeks, IV, VaR, target weights) resolve through
`quant-core`. The keeper is the only writer to chain; the UI is a reader plus a
user-action funnel through the gateway.

## 5. Build order (roadmap)

1. **quant-core** — done & verified (this commit).
2. **shared-types + market-data** — domain schemas (zod) and a feed adapter with
   a replayable historical cache so everything downstream is testable offline.
3. **strategy-core** — the exposure/rebalance/wind-down state machine, ported
   from the sim engine but driven by `quant-core` greeks and a delta-band hedger.
   Property-tested against invariants (NAV monotone under no-shock, downside
   capped at premium, epoch wind-down at the floor).
4. **pricing-api + risk-engine** — wrap quant-core behind HTTP/WS; risk-engine
   runs scheduled VaR and enforces limits.
5. **protocol-bindings + keeper** — typed viem clients; keeper executes the
   strategy-core decisions against `onchain/`, then against `contracts/`.
6. **terminal + research** — repoint the front-end at the services; add a
   backtesting/scenario app over quant-core.
7. **infra** — docker-compose, migrations, CI gating on `quant-core` verify +
   typecheck + contract tests.

## 6. Invariants (enforced across layers)

- **Capped downside.** Any path's loss ≤ total premium paid. Checked in
  quant-core's MC harness; mirrored as a `RiskController` assertion on-chain.
- **One pricing truth.** No module reimplements Black–Scholes; all greeks/IV/VaR
  flow from quant-core.
- **Determinism.** Given a seed, the PRNG → risk numbers are reproducible across
  machines, so a UI figure and a keeper decision can be reconciled exactly.
- **Honest status.** Every module header declares running / simulated /
  reference, exactly as the prototype README did.

---


