/* =============================================================================
 * @amplifi/strategy-core / types
 * -----------------------------------------------------------------------------
 * Domain model for the AmpliFi strategy: a leveraged, capped-downside synthetic
 * index built from a basket of LONG options.
 *
 * The economic model in one paragraph: the vault's equity IS the premium budget.
 * Because every leg is a long option, the worst case is losing the premium —
 * the equity — and nothing more (capped downside). That premium is spread across
 * the basket by RISK-PARITY weights, and each dollar of premium buys delta
 * exposure worth several dollars of spot, so the *realized leverage* emerges
 * from the option deltas rather than being asserted. The strategy keeps that
 * exposure centred (delta-band hedging), compounds gains (rebalance/epoch), and
 * winds the book down if the whole portfolio draws past a floor.
 *
 * Everything here is plain data; the behaviour lives in machine.ts and is pure
 * and deterministic so a UI figure and a keeper decision reconcile exactly.
 * ===========================================================================*/

/** A tradable underlying in the exposure universe. */
export interface BasketAsset {
  sym: string;
  spot: number; // current mark
  vol: number; // annualised implied vol used for pricing this leg
  active: boolean; // is this leg currently in the basket?
}

/** A single long-option position the vault holds. */
export interface Position {
  sym: string;
  qty: number; // contracts (always > 0 — long only)
  strike: number; // K
  expiry: number; // time-to-expiry in YEARS, decremented each step (theta)
  vol: number; // vol the leg is priced at
  entrySpot: number; // spot when the leg was struck (for diagnostics)
  premiumPaid: number; // cash spent to open this leg (its share of the budget)
}

/** Strategy configuration — the knobs a keeper / governance controls. */
export interface StrategyParams {
  r: number; // risk-free / funding rate (continuous)
  b: number; // cost of carry; 0 for perp/forward-style options
  expiryYears: number; // tenor each leg is (re)struck to
  deltaBand: number; // re-hedge when |Δ-fraction − target| exceeds this
  deltaTarget: number; // target net delta as a fraction of notional (ATM ≈ 0.5)
  rebalanceEveryDays: number; // scheduled risk-parity + ATM re-strike cadence
  epochDays: number; // epoch length — profit checkpoint cadence
  reserveSkim: number; // fraction of epoch profit moved to the safety reserve
  floor: number; // wind-down threshold as a fraction of the high-water NAV/share
  stepDays: number; // simulation/keeper step size in days (dt = stepDays/365)
  costBps: number; // round-trip transaction cost (spread+fee) in bps, charged on turnover
  /**
   * Optional correlation matrix over `assets` (in array order) enabling
   * covariance-aware Equal-Risk-Contribution weighting. When omitted, the basket
   * falls back to inverse-volatility risk parity.
   */
  corr?: number[][];
}

export const DEFAULT_PARAMS: StrategyParams = {
  r: 0.05,
  b: 0.0,
  expiryYears: 30 / 365,
  deltaBand: 0.22,
  deltaTarget: 0.53,
  rebalanceEveryDays: 7,
  epochDays: 30,
  reserveSkim: 0.2,
  floor: 0.4, // wind down at −60% of the high-water mark
  stepDays: 1,
  costBps: 0, // default frictionless; production keepers set a realistic spread
};

/** The full mutable state of one strategy instance. */
export interface StrategyState {
  day: number;
  deployed: boolean;
  closed: boolean; // true once the book has wound down (terminal)
  epoch: number;

  equity: number; // premium budget at the current deployment (max loss)
  reserve: number; // realized safety reserve (never at risk)
  shares: number; // AFI shares outstanding (1 share == 1 unit of initial equity)

  navPerShare: number; // (mark + reserve) / shares
  hwm: number; // high-water mark of navPerShare

  assets: BasketAsset[];
  weights: Record<string, number>; // risk-parity weights, sum to 1 over active legs
  positions: Position[];

  epochStartNav: number; // navPerShare at the start of the current epoch
  epochStartDay: number;
  lastRebalDay: number;
  costsPaid: number; // cumulative transaction costs paid out of the book
}

/** Structured events emitted by each step — the audit trail a keeper/UI consumes. */
export type StrategyEvent =
  | { kind: "deploy"; day: number; equity: number; legs: number; realizedLeverage: number }
  | { kind: "mark"; day: number; navPerShare: number; mark: number }
  | { kind: "hedge"; day: number; driftBefore: number; reason: "band" | "scheduled" }
  | { kind: "epoch"; day: number; epoch: number; profit: number; skimmed: number; reserve: number }
  | { kind: "windDown"; day: number; navPerShare: number; recovered: number }
  | { kind: "cost"; day: number; amount: number; reason: "deploy" | "restrike" | "harvest" }
  | { kind: "note"; day: number; msg: string };

export interface StepResult {
  state: StrategyState;
  events: StrategyEvent[];
}
