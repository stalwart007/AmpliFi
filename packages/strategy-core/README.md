# @amplifi/strategy-core

The AmpliFi strategy as a pure, deterministic state machine: risk-parity basket
construction, long-option exposure manufacture, delta-band hedging, epoch
compounding, and drawdown wind-down — all driven by `@amplifi/quant-core`.

> **Status: production-quality library.** 34 property tests pass; strict `tsc`;
> deterministic given a seed. Supports covariance-aware Equal-Risk-Contribution
> weighting, a turnover transaction-cost model, dollar-weighted delta hedging, and
> a performance-analytics module (Sharpe / Sortino / max-drawdown / Calmar).
> This is the single implementation of the strategy's
> behaviour — the simulator UI, the off-chain keeper, and the backtester all
> drive _this_ machine, so what a user sees and what a keeper does cannot diverge.

## Economic model

The vault's equity **is** the premium budget. Every leg is a long option, so the
worst case is losing the premium and nothing more — that is the capped-downside
guarantee. The premium is spread across the basket by risk-parity weights, and
each dollar of premium buys several dollars of spot delta, so **realized leverage
emerges from the option deltas** (measured ~7× in tests) rather than being
asserted.

```
mark    = present value of the long-option book   (≥ 0 always)
reserve = realized cash skimmed out of the book   (never at risk)
navPS   = (mark + reserve) / shares
maxLoss = mark                                     (capped downside)
```

## API

```ts
import {
  createState,
  deploy,
  step,
  run, // state machine
  riskParityWeights,
  buildBook,
  markBook, // basket
  CorrelatedGbm,
  flatCorrelationMarket, // market generator
  DEFAULT_PARAMS,
} from "@amplifi/strategy-core";
```

### Lifecycle

```ts
const assets = [
  { sym: "BTC", spot: 64000, vol: 0.55, active: true },
  { sym: "ETH", spot: 3400, vol: 0.66, active: true },
  { sym: "SOL", spot: 150, vol: 0.92, active: true },
];

let { state } = deploy(createState(assets), 1000); // strike the initial book

const cfg = flatCorrelationMarket(assets, 0.4, 0.2, 1, 42n);
const gbm = new CorrelatedGbm({ BTC: 64000, ETH: 3400, SOL: 150 }, cfg);

for (let d = 0; d < 90 && !state.closed; d++) {
  const r = step(state, DEFAULT_PARAMS, gbm.next());
  state = r.state; // immutable step: returns a new state
  // r.events: deploy | mark | hedge | epoch | windDown | note
}
```

Each `step()` decays theta, marks to market, checks the drawdown floor,
re-hedges if delta drifts out of band, runs the scheduled risk-parity re-strike,
and checkpoints the epoch (skimming a slice of profit into the safe reserve).

## Invariants (enforced by `test/verify.ts`)

- risk-parity weights sum to 1 and rank inversely to vol
- deploy spends exactly the premium budget; leverage manufactured > 1
- **capped downside:** book mark ≥ 0 and NAV ≥ 0 on every step of every path
- a single leg collapsing 99% does **not** wind the vault down (portfolio risk)
- a whole-book crash **does** wind down at the floor, then freezes
- re-strikes are NAV-neutral; reserve is monotone non-decreasing
- identical seed ⇒ identical terminal state (bit-for-bit)

## Test

```bash
npm test            # tsx test/verify.ts — 21 property checks
npm run typecheck   # strict tsc, no emit
```

## License

`UNLICENSED` — all rights reserved. See the repository root `LICENSE`.
