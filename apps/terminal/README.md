# @amplifi/terminal

A live trading-terminal dashboard for AmpliFi, built with Vite + React +
TypeScript. It drives the **real** `@amplifi/strategy-core` state machine and
`@amplifi/quant-core` risk engine directly in the browser — no mock data.

> **Status: working app.** Production Vite build is clean (47 modules); the
> engine integration path is runtime smoke-tested. Simulation only.

## Run

```bash
# from the repo root
npm install
npm run dev -w @amplifi/terminal      # http://localhost:5173
npm run build -w @amplifi/terminal    # production bundle
npm run typecheck -w @amplifi/terminal
```

## What it shows

- **NAV / share** line chart with the genesis-par baseline.
- **Drawdown** area chart.
- **Basket weights** — switch live between inverse-vol (1/σ) and
  Equal-Risk-Contribution weighting.
- **Risk panel** — Monte-Carlo full-revaluation VaR 95/99 and ES, recomputed as
  the book evolves, with the capped-downside reminder.
- **KPI strip** — NAV, return, realized leverage, reserve, Sharpe, max drawdown,
  cumulative transaction costs, 1-day VaR.
- **Event log** — deploys, delta hedges, rebalances, epoch checkpoints, and
  wind-downs streamed from the engine.

## Controls

Deposit, transaction cost (bps), market drift, step speed, **ERC weights**
toggle, and **jump stress** toggle (Merton jump-diffusion overlay for gap-risk
stress testing). Changing any control re-deploys a fresh vault deterministically.

## Why it matters

The terminal imports the same engine the off-chain keeper runs. There is no
separate "UI math" — every number on screen is produced by the verified shared
core, so the dashboard is a faithful projection of strategy behaviour.

## License

`UNLICENSED` — all rights reserved. See the repository root `LICENSE`.
