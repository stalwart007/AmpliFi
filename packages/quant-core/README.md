# @amplifi/quant-core

Deterministic, dependency-free quantitative core: options pricing with a full
greek surface, implied-vol inversion, an SVI implied-vol surface, and
full-revaluation Monte-Carlo VaR/ES. Pure TypeScript — runs unchanged in a
browser worker, a Node service, or a fuzz harness.

> **Status: production-quality library.** 38 implementation-independent
> numerical checks pass; strict `tsc`; zero runtime dependencies. Φ uses West's
> ~1e-14 approximation (accurate deep in the tails); Monte-Carlo VaR ships
> antithetic variance reduction (measured ~2.16× tighter estimates).

## Install (within the monorepo)

```ts
import { priceGreeks, impliedVol, VolSurface, monteCarloVar } from "@amplifi/quant-core";
```

## Modules

| Import   | Provides                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `stats`  | `erf`, `normCdf`, `normPdf`, `normInv` (Acklam), `Pcg32` PRNG, `GaussianStream`, sample stats, `quantile` |
| `linalg` | row-major `Mat`, `cholesky`, `jacobiEigenSym`, `nearestCorrelation` (Higham), `safeCovCholesky`           |
| `bs`     | `priceGreeks`, `price`, `parityResidual` — generalised Black–Scholes with carry `b`                       |
| `iv`     | `impliedVol` — safeguarded Newton + bisection with no-arbitrage bounds                                    |
| `svi`    | `sviTotalVariance`, `sviVol`, `VolSurface`, `calibrateSlice`, arbitrage checks                            |
| `book`   | `aggregate`, `deltaDrift` — portfolio-level greek aggregation                                             |
| `risk`   | `monteCarloVar`, `estimateCovariance` — correlated GBM, VaR/ES                                            |

## Examples

**Price + greeks (carry form covers spot, perps/forwards, FX):**

```ts
import { priceGreeks } from "@amplifi/quant-core";

// b = 0 → Black-76 on a perpetual/forward
const g = priceGreeks({ s: 64000, k: 64000, t: 30 / 365, vol: 0.55, r: 0.05, b: 0, type: "call" });
// g.price, g.delta, g.gamma, g.vega, g.theta, g.rho, g.vanna, g.volga
```

**Implied vol (recovers σ to 1e-8, with no-arbitrage guard):**

```ts
import { price, impliedVol } from "@amplifi/quant-core";
const mkt = price({ s: 64000, k: 66000, t: 0.3, vol: 0.7, r: 0.05, b: 0, type: "call" });
const { vol, converged } = impliedVol({ s: 64000, k: 66000, t: 0.3, r: 0.05, b: 0, type: "call", target: mkt });
```

**SVI surface with arbitrage audit:**

```ts
import { VolSurface } from "@amplifi/quant-core";
const surf = new VolSurface([
  { expiry: 7 / 365, params: { a: 0.02, b: 0.1, rho: -0.3, m: 0, zeta: 0.12 } },
  { expiry: 30 / 365, params: { a: 0.04, b: 0.1, rho: -0.3, m: 0, zeta: 0.15 } },
]);
surf.vol(/* logMoneyness */ 0.05, /* T */ 14 / 365);
surf.audit(); // per-slice static + density arbitrage report
surf.calendarOk(); // total variance monotone in T?
```

**Full-revaluation Monte-Carlo VaR (re-prices the whole book per path):**

```ts
import { monteCarloVar, linalg } from "@amplifi/quant-core";
const cov = linalg.fromRows([
  [0.3, 0.18, 0.22],
  [0.18, 0.44, 0.27],
  [0.22, 0.27, 0.85],
]);
const res = monteCarloVar(legs, ["BTC", "ETH", "SOL"], spot0, vols, cov, {
  paths: 40000,
  horizonYears: 5 / 365,
  seed: 0xc0ffeen,
  levels: [0.95, 0.99],
});
res.tail["0.9900"].var; // 99% VaR as a positive loss
res.tail["0.9900"].es; // 99% expected shortfall
```

## Why full-revaluation VaR

The book is long convex options. A delta-normal / Taylor VaR systematically
misprices both the convex upside and the capped downside that define the
strategy, so the engine re-prices the entire book on every simulated path. The
cost buys correct tails.

## Test

```bash
npm test            # tsx test/verify.ts — 28 checks
npm run typecheck   # strict tsc, no emit
```

## License

`UNLICENSED` — all rights reserved. See the repository root `LICENSE`.
