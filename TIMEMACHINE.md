# The TimeMachine Engine (TM Core)

AmpliFi is built around one economic idea: a deposit is **not** the position — it
is the *premium budget* that finances a multiple of itself in exposure, while the
maximum loss stays bounded by that premium. The "TimeMachine" is the set of rules
that turns a static deposit into a self-compounding, capped-downside exposure
machine.

This document maps each TM concept to the exact code that implements it, so the
idea and the implementation never drift apart. Every figure the dashboard shows
and every action the keeper takes is computed by the **same** deterministic state
machine in `packages/strategy-core` over the pricing/risk primitives in
`packages/quant-core`.

---

## The nine concepts → implementation

| # | Concept | Where it lives |
|---|---------|----------------|
| 1 | **Capital Compression** | `strategy-core/src/machine.ts` → `deploy()` / `buildBook()` — the deposit becomes the premium budget; option deltas manufacture exposure worth several × the budget. The realized leverage *emerges* from the deltas, it is not asserted. |
| 2 | **Exposure Engine** | `strategy-core/src/basket.ts` → `riskParityWeights` / `ercWeights` / `basketWeights` build a covariance-aware basket; `buildBook` strikes a long call per leg. Greeks aggregated in `quant-core/src/portfolio/greeks.ts`. |
| 3 | **Profit Engine** | `machine.ts` → `step()` epoch branch + `harvest()` — at each `epochDays` checkpoint, realised profit is measured against `epochStartNav`, a `reserveSkim` fraction is moved to the safe reserve, and the rest compounds the base. |
| 4 | **Automatic Rebalancing** | `machine.ts` → `reStrike()` + delta-band logic in `step()` — re-hedges when `|Δ-fraction − deltaTarget|` exceeds `deltaBand`, and re-strikes the basket to ATM on the `rebalanceEveryDays` cadence. |
| 5 | **Recursive Growth** | `machine.ts` → `addCapital()` and the epoch compounding — as the capital base grows, the book is rebuilt on the larger mark, so exposure rescales with the base. NAV-continuity is preserved (mint/burn at live NAV). |
| 6 | **Whole-Basket Liquidation** | `machine.ts` → `windDown()` — triggered only when portfolio `navPerShare` falls through `floor · hwm`. There is **no per-asset liquidation**; the whole book is settled at once. On-chain mirror: `RiskController.pokeNav` + `AmplifiVault.pokeNav`. |
| 7 | **Buffer Layers** | `StrategyState.reserve` (skimmed each epoch, never at risk) + the book mark (at-risk) + the distance to the floor. Surfaced in the dashboard `BufferLayers` panel. |
| 8 | **Epoch Reset** | `machine.ts` → epoch branch re-seeds `epochStartNav` / `epochStartDay` and advances `hwm`; `forceRebalance()` exposes a manual reset. On-chain: `RiskController.resetEpoch` (timelock-gated). |
| 9 | **Rules-Only Risk** | The entire machine is pure and deterministic — same inputs → same outputs. The simulator, the keeper (`services/keeper`), and the backtester (`apps/research`) all drive it, so a UI figure and a keeper decision reconcile exactly. |

---

## #10 — financing the amplified exposure

The open question in the original concept: if a \$1,000 deposit controls \$9,000
of exposure, **who finances the other \$8,000?**

AmpliFi's answer is **long perpetual options**. Each basket leg is a long call:

- The **option seller** provides the leverage — they are short the call and post
  the collateral behind the delta.
- The vault pays **premium up front** (the deposit) plus **theta** over time
  (decay, charged as the legs age in `step()`).
- The **downside is capped at the premium**: a long option can expire worthless
  but can never owe more than was paid. This is the on-chain invariant
  `totalAssets() = idle + venue.markToMarket()` where a long-option book's mark is
  always ≥ 0 (`AmplifiVault.sol`).

So the leverage is *rented*, not *borrowed*: there is no liability that can exceed
the premium, which is precisely why the downside stays capped while the upside is
amplified. The price of that asymmetry is theta — paid continuously and modelled
explicitly in the engine.

---

## TimeMachine × Panoptic

The concrete venue that supplies those long perpetual options is
**[Panoptic](https://github.com/panoptic-labs/panoptic-v1-core)** (v1.0.x) — an
oracle-free, perpetual options protocol on Uniswap V3. Panoptic is an unusually
clean fit for the TimeMachine, because the two ideas compose:

| TimeMachine needs… | Panoptic provides… |
|--------------------|--------------------|
| long options that amplify exposure | minting a long Panoptic option moves concentrated liquidity to manufacture multiplied delta exposure per unit of collateral |
| **no expiry to roll** (perpetual) | Panoptic options never expire — they are financed by **streamia** (streaming premium) paid continuously, exactly the "theta" the engine models |
| **capped downside** = premium | a long position's worst case is the committed collateral; it can never owe more — the on-chain expression of capped downside |
| **oracle-hardened marks** | Panoptic is oracle-free (prices come from the Uniswap V3 pool state), removing the single-oracle manipulation surface |
| portfolio-level wind-down | positions are burned as a set on a floor breach, never one leg at a time |

The binding lives in **`venues/PanopticVenueAdapter.sol`**, which implements the
vault's `IOptionsVenue` seam against a narrow **`IPanopticPool`** interface
(deposit collateral → mint a long position template sized by premium → read
`accountValue` for the honest mark → burn to settle). The keeper computes the
Panoptic `TokenId` (the long-leg structure) for the ERC basket off-chain and sets
it as the position template; each deposit scales it. So the off-chain TimeMachine
engine (`strategy-core`) and the on-chain Panoptic position describe the *same*
long-option book — the simulator, the keeper, and the venue stay reconciled.

A production deployment binds the real `PanopticPool` + `CollateralTracker`
behind `IPanopticPool`; `MockPanopticPool` implements the same seam for tests.

---

## Protocol surface (on-chain)

AmpliFi is structured as a protocol, not a single contract:

- **`AmplifiVault.sol`** — ERC-4626 vault and the **AFI share token**. Deposits
  **mint** AFI at live NAV and route premium to the venue; withdrawals **burn**
  AFI and unwind a pro-rata slice. NAV is honest (`idle + venue mark`), never
  fabricated.
- **`AmplifiGatedVault.sol`** — the permissioned production vault: a deposit is
  admitted only when **both** the funder and the receiver pass the allowlist.
  Burning is never gated, so de-listing can never trap funds.
- **`access/AllowlistGate.sol`** — the permissioning boundary. Three independent
  admission paths converge on `isAllowed`: (1) direct gatekeeper entry, (2) a
  Merkle-committed allowlist a wallet self-proves into (the list stays off-chain),
  and (3) single-use, time-boxed **EIP-712 access passes** a gatekeeper signs
  off-chain. A global `requireGate` switch flips the protocol between
  permissioned and permissionless without redeploying consumers.
- **`venues/PanopticVenueAdapter.sol`** — binds the vault's `IOptionsVenue` seam
  to Panoptic v1-core: routes premium into Panoptic collateral, mints the long
  perpetual position, marks off `accountValue`, and burns to settle. The concrete
  financing engine behind capital compression.
- **`RiskController.sol`** — high-water mark, floor breach, and the
  portfolio-level wind-down decision.
- **`OracleHardenedVenue.sol`** — for non-Panoptic venues: marks the book only off
  a validated cached price (staleness + deviation guards) with a guardian exit.
- **`governance/AmplifiTimelock.sol` + `MultisigGuardian.sol`** — every policy
  change is queued behind a timelock whose proposer is an m-of-n multisig.
- **`periphery/WithdrawalQueue.sol`** — FIFO escrow so a large redemption never
  forces a whole-book liquidation.

All compile clean against OpenZeppelin 5.1 (`node contracts/compile.mjs`), with a
Foundry suite under `contracts/test`.

---

## The terminal

`apps/terminal` is a panel-OS dashboard that drives the real engine in the
browser (strategy-core + quant-core + portfolio-opt, no mocked data). Flow:

**Landing → access gate (connect wallet + allowlist) → terminal.**

The centre is dominated by an **interactive performance chart** (crosshair +
tooltip, switchable between NAV / exposure / return / drawdown), the
Capital→Exposure compression view, and a **Live Markets** grid of TradingView
charts for every underlying the exposure engine is currently trading. The left
control deck holds the wallet (deposit-address, deposit→mint with an AFI preview,
redeem→burn capped at balance), the 22-token exposure-universe selector, and the
engine parameters. The right side groups, in tabs, the basket donut / correlation
heatmap / optimiser, the Monte-Carlo VaR histogram / risk dials / buffers, and the
console / ledger / feed. A wound-down book exposes a **Redeploy** action that
re-strikes a fresh book on the recovered cash. The command console accepts `add`,
`redeem`, `rebalance`, `harvest`, `shock`, `run`, `pause`, `reset`, and
`redeploy`. The wallet gate mirrors the on-chain `AllowlistGate`; the contract
remains the real boundary.

> **Status.** Research prototype. The contracts are written to production
> standards and compile clean, but are **not yet independently audited** and the
> live options-venue integration is pending. Do not custody real funds until both
> are complete (see `PRODUCTION_READINESS.md`).
