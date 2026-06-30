/* =============================================================================
 * @amplifi/strategy-core / machine
 * -----------------------------------------------------------------------------
 * The strategy as a pure, deterministic state machine. One `step()` advances
 * the book by one keeper tick: decay theta, mark to market, check the drawdown
 * floor, re-hedge if delta has drifted out of band, run the scheduled
 * risk-parity re-strike, and checkpoint the epoch. Same inputs → same outputs,
 * so a UI projection and a keeper's on-chain action reconcile exactly.
 *
 * Accounting model (all values are honest about what is at risk):
 *   mark      = present value of the long-option book  (≥ 0 always)
 *   reserve   = realized cash skimmed out of the book  (never at risk)
 *   navPS     = (mark + reserve) / shares
 *   maxLoss   = mark  — you can lose the whole book, never more (capped downside)
 *
 * A "re-strike" (hedge or scheduled) sells the current book and rebuys an ATM
 * book using the *current mark* as the new premium budget. It is instantaneously
 * NAV-neutral: it moves money between legs, it does not create or destroy value.
 * ===========================================================================*/

import { priceGreeks } from "@amplifi/quant-core";
import {
  BasketAsset,
  Position,
  StrategyParams,
  StrategyState,
  StrategyEvent,
  StepResult,
  DEFAULT_PARAMS,
} from "./types";
import { basketWeights, buildBook } from "./basket";

export interface MarketUpdate {
  spots?: Record<string, number>;
  vols?: Record<string, number>;
}

interface BookStats {
  mark: number;
  dollarDelta: number;
  dollarNotional: number; // Σ qty·S — spot-equivalent notional, for dollar-weighted delta
  deltaUnits: number; // Σ qty·Δ  (call delta in [0,1])
  qtySum: number;
}

function bookStats(positions: Position[], assets: BasketAsset[], p: StrategyParams): BookStats {
  const spotOf: Record<string, number> = {};
  for (const a of assets) spotOf[a.sym] = a.spot;
  let mark = 0,
    dollarDelta = 0,
    dollarNotional = 0,
    deltaUnits = 0,
    qtySum = 0;
  for (const pos of positions) {
    const s = spotOf[pos.sym];
    if (s === undefined) continue;
    const g = priceGreeks({ s, k: pos.strike, t: pos.expiry, vol: pos.vol, r: p.r, b: p.b, type: "call" });
    mark += pos.qty * g.price;
    dollarDelta += pos.qty * g.delta * s;
    dollarNotional += pos.qty * s;
    deltaUnits += pos.qty * g.delta;
    qtySum += pos.qty;
  }
  return { mark, dollarDelta, dollarNotional, deltaUnits, qtySum };
}

/** Charge a turnover transaction cost out of the book, tracking the total. */
function chargeCost(s: StrategyState, params: StrategyParams, turnover: number): number {
  const cost = (params.costBps / 10_000) * turnover;
  if (cost <= 0) return 0;
  const { mark } = bookStats(s.positions, s.assets, params);
  if (mark <= 0) return 0;
  const scale = Math.max((mark - cost) / mark, 0);
  for (const p of s.positions) p.qty *= scale;
  s.costsPaid += Math.min(cost, mark);
  return Math.min(cost, mark);
}

/** Deep-ish clone so `step` is referentially pure (no caller-visible mutation). */
function cloneState(s: StrategyState): StrategyState {
  return {
    ...s,
    assets: s.assets.map((a) => ({ ...a })),
    weights: { ...s.weights },
    positions: s.positions.map((p) => ({ ...p })),
  };
}

/** A fresh, undeployed strategy over the given basket universe. */
export function createState(assets: BasketAsset[]): StrategyState {
  return {
    day: 0,
    deployed: false,
    closed: false,
    epoch: 1,
    equity: 0,
    reserve: 0,
    shares: 0,
    navPerShare: 1,
    hwm: 1,
    assets: assets.map((a) => ({ ...a })),
    weights: {},
    positions: [],
    epochStartNav: 1,
    epochStartDay: 0,
    lastRebalDay: 0,
    costsPaid: 0,
  };
}

/** Deploy `deposit` of premium: strike the initial risk-parity ATM book. */
export function deploy(state: StrategyState, deposit: number, params: StrategyParams = DEFAULT_PARAMS): StepResult {
  const s = cloneState(state);
  if (s.deployed) return { state: s, events: [{ kind: "note", day: s.day, msg: "already deployed" }] };

  s.weights = basketWeights(s.assets, params);
  const { positions, realizedLeverage, premiumSpent } = buildBook(s.assets, s.weights, deposit, params);
  s.positions = positions;
  s.equity = premiumSpent;
  s.shares = deposit; // 1 share == 1 unit of initial premium
  s.deployed = true;

  const events: StrategyEvent[] = [
    { kind: "deploy", day: s.day, equity: s.equity, legs: positions.length, realizedLeverage },
  ];
  // Entry transaction cost on the deployed notional.
  const cost = chargeCost(s, params, deposit);
  if (cost > 0) events.push({ kind: "cost", day: s.day, amount: cost, reason: "deploy" });

  const { mark } = bookStats(s.positions, s.assets, params);
  s.navPerShare = (mark + s.reserve) / s.shares;
  s.hwm = Math.max(s.hwm, s.navPerShare);
  s.epochStartNav = s.navPerShare;
  s.epochStartDay = s.day;
  s.lastRebalDay = s.day;

  return { state: s, events };
}

/**
 * Sell the book and rebuy an ATM (risk-parity / ERC) book using `mark` as the
 * budget. NAV-neutral before costs; returns the turnover transaction cost so the
 * caller can record it. At costBps = 0 this is exactly NAV-neutral.
 */
function reStrike(s: StrategyState, params: StrategyParams): number {
  const { mark } = bookStats(s.positions, s.assets, params);
  s.weights = basketWeights(s.assets, params); // vols/correlation may have moved → refresh
  const { positions, premiumSpent } = buildBook(s.assets, s.weights, mark, params);
  s.positions = positions;
  s.equity = premiumSpent; // new premium budget == prior mark (NAV-neutral pre-cost)
  return chargeCost(s, params, mark); // round-trip cost on the rolled notional
}

/** Move `amount` of value out of the at-risk book into the safe reserve. */
function harvest(s: StrategyState, params: StrategyParams, amount: number): { take: number; cost: number } {
  const { mark } = bookStats(s.positions, s.assets, params);
  if (amount <= 0 || mark <= 0) return { take: 0, cost: 0 };
  const take = Math.min(amount, mark);
  const scale = (mark - take) / mark;
  for (const p of s.positions) p.qty *= scale; // shrink every leg proportionally
  const cost = (params.costBps / 10_000) * take; // unwinding the skimmed slice has a cost
  s.reserve += take - cost; // net cash reaching the safe reserve
  s.costsPaid += cost;
  s.equity *= scale;
  return { take, cost };
}

/** Wind the whole book down into the reserve and freeze the strategy (terminal). */
function windDown(s: StrategyState, params: StrategyParams): number {
  const { mark } = bookStats(s.positions, s.assets, params);
  s.reserve += mark;
  s.positions = [];
  s.equity = 0;
  s.closed = true;
  s.navPerShare = (0 + s.reserve) / s.shares;
  return mark;
}

/**
 * Advance the strategy by one step. `update` carries the new market state
 * (spots and optionally vols) that the keeper/feed observed; omit it to apply
 * pure theta decay with frozen prices.
 */
export function step(state: StrategyState, params: StrategyParams = DEFAULT_PARAMS, update?: MarketUpdate): StepResult {
  const s = cloneState(state);
  const events: StrategyEvent[] = [];
  s.day += params.stepDays;

  // 1. Absorb the new market state.
  if (update?.spots) for (const a of s.assets) if (update.spots[a.sym] !== undefined) a.spot = update.spots[a.sym];
  if (update?.vols) for (const a of s.assets) if (update.vols[a.sym] !== undefined) a.vol = update.vols[a.sym];

  // 2. Theta: every leg loses dt of life.
  const dt = params.stepDays / 365;
  for (const p of s.positions) p.expiry = Math.max(p.expiry - dt, 0);

  if (!s.deployed || s.closed) {
    const { mark } = bookStats(s.positions, s.assets, params);
    s.navPerShare = s.shares > 0 ? (mark + s.reserve) / s.shares : s.navPerShare;
    return { state: s, events };
  }

  // 3. Mark to market.
  let stats = bookStats(s.positions, s.assets, params);
  s.navPerShare = (stats.mark + s.reserve) / s.shares;
  s.hwm = Math.max(s.hwm, s.navPerShare);
  events.push({ kind: "mark", day: s.day, navPerShare: s.navPerShare, mark: stats.mark });

  // 4. Drawdown floor → portfolio-level wind-down (NOT per-asset liquidation).
  if (s.navPerShare < params.floor * s.hwm) {
    const recovered = windDown(s, params);
    events.push({ kind: "windDown", day: s.day, navPerShare: s.navPerShare, recovered });
    return { state: s, events };
  }

  // 5. Hedge / rebalance via re-strike. The delta drift is measured as the
  //    DOLLAR-weighted average option delta (Σ qty·Δ·S / Σ qty·S) so legs on very
  //    different price scales are compared on equal economic footing — not the
  //    naive per-contract mean, which a high-priced leg would dominate.
  const avgDelta = stats.dollarNotional > 0 ? stats.dollarDelta / stats.dollarNotional : params.deltaTarget;
  const drift = avgDelta - params.deltaTarget;
  const scheduledDue = s.day - s.lastRebalDay >= params.rebalanceEveryDays;
  const bandDue = Math.abs(drift) > params.deltaBand;
  if (scheduledDue || bandDue) {
    const cost = reStrike(s, params);
    if (scheduledDue) s.lastRebalDay = s.day;
    stats = bookStats(s.positions, s.assets, params);
    events.push({ kind: "hedge", day: s.day, driftBefore: drift, reason: bandDue ? "band" : "scheduled" });
    if (cost > 0) events.push({ kind: "cost", day: s.day, amount: cost, reason: "restrike" });
    // Re-mark after the re-strike so NAV/share reflects any cost just paid.
    s.navPerShare = (stats.mark + s.reserve) / s.shares;
  }

  // 6. Epoch checkpoint: skim a slice of realized profit into the reserve.
  if (s.day - s.epochStartDay >= params.epochDays) {
    const profitPerShare = s.navPerShare - s.epochStartNav;
    const totalProfit = profitPerShare * s.shares;
    let skimmed = 0;
    if (totalProfit > 0) {
      const h = harvest(s, params, params.reserveSkim * totalProfit);
      skimmed = h.take;
      if (h.cost > 0) events.push({ kind: "cost", day: s.day, amount: h.cost, reason: "harvest" });
    }
    s.epoch += 1;
    s.navPerShare = (bookStats(s.positions, s.assets, params).mark + s.reserve) / s.shares;
    s.epochStartNav = s.navPerShare;
    s.epochStartDay = s.day;
    events.push({ kind: "epoch", day: s.day, epoch: s.epoch, profit: totalProfit, skimmed, reserve: s.reserve });
  }

  return { state: s, events };
}

/** Convenience: run a whole market path through the machine, collecting events. */
export function run(
  initial: StrategyState,
  params: StrategyParams,
  path: MarketUpdate[],
): { state: StrategyState; events: StrategyEvent[] } {
  let s = initial;
  const all: StrategyEvent[] = [];
  for (const u of path) {
    const r = step(s, params, u);
    s = r.state;
    all.push(...r.events);
    if (s.closed) break;
  }
  return { state: s, events: all };
}

/* =============================================================================
 * TimeMachine interactive operations
 * -----------------------------------------------------------------------------
 * These are the discretionary actions a user (or the console) performs against a
 * live position, distinct from the autonomous `step`. They are the on-ramps and
 * off-ramps of the "capital compression" engine: add base capital (exposure
 * scales up), redeem (exposure scales down), force a rebalance or a profit
 * harvest, or stress the basket with a shock. All preserve NAV/share continuity
 * (minting/burning at the live NAV) and the capped-downside invariant.
 * ===========================================================================*/

/** Add `amount` of base capital to a live position; mints shares at the current NAV. */
export function addCapital(state: StrategyState, amount: number, params: StrategyParams = DEFAULT_PARAMS): StepResult {
  const s = cloneState(state);
  if (!s.deployed || s.closed || amount <= 0 || !(s.navPerShare > 0)) {
    return { state: s, events: [{ kind: "note", day: s.day, msg: "add-capital ignored (not live)" }] };
  }
  const events: StrategyEvent[] = [];
  const newShares = amount / s.navPerShare; // mint at live NAV → NAV-continuous
  s.shares += newShares;

  // Rebuild the book on (current mark + new capital): exposure scales with capital.
  const { mark } = bookStats(s.positions, s.assets, params);
  s.weights = basketWeights(s.assets, params);
  const built = buildBook(s.assets, s.weights, mark + amount, params);
  s.positions = built.positions;
  s.equity = built.premiumSpent;

  const cost = chargeCost(s, params, amount);
  if (cost > 0) events.push({ kind: "cost", day: s.day, amount: cost, reason: "deploy" });
  s.navPerShare = (bookStats(s.positions, s.assets, params).mark + s.reserve) / s.shares;
  s.hwm = Math.max(s.hwm, s.navPerShare);
  events.push({ kind: "note", day: s.day, msg: `ADD CAPITAL +${amount.toFixed(0)} · +${newShares.toFixed(2)} shares` });
  return { state: s, events };
}

/** Redeem `sharesToRedeem` AFI shares for their NAV in cash (reserve first, then book). */
export function redeem(state: StrategyState, sharesToRedeem: number, params: StrategyParams = DEFAULT_PARAMS): StepResult {
  const s = cloneState(state);
  if (!s.deployed || sharesToRedeem <= 0 || s.shares <= 0) {
    return { state: s, events: [{ kind: "note", day: s.day, msg: "redeem ignored" }] };
  }
  const events: StrategyEvent[] = [];
  const burn = Math.min(sharesToRedeem, s.shares);
  const payout = burn * s.navPerShare;

  const fromReserve = Math.min(payout, s.reserve);
  s.reserve -= fromReserve;
  const fromBook = payout - fromReserve;
  const { mark } = bookStats(s.positions, s.assets, params);
  if (fromBook > 0 && mark > 0) {
    const scale = Math.max((mark - fromBook) / mark, 0);
    for (const p of s.positions) p.qty *= scale;
    s.equity *= scale;
  }
  s.shares -= burn;
  if (s.shares <= 1e-9) {
    s.positions = [];
    s.equity = 0;
    s.closed = true;
  }
  s.navPerShare = s.shares > 0 ? (bookStats(s.positions, s.assets, params).mark + s.reserve) / s.shares : s.navPerShare;
  events.push({ kind: "note", day: s.day, msg: `REDEEM ${burn.toFixed(2)} sh → ${payout.toFixed(0)}` });
  return { state: s, events };
}

/** Stress the basket with a multiplicative spot shock (e.g. −0.2 = −20%); re-marks and may wind down. */
export function shock(state: StrategyState, pct: number, params: StrategyParams = DEFAULT_PARAMS): StepResult {
  const s = cloneState(state);
  for (const a of s.assets) a.spot *= 1 + pct;
  const events: StrategyEvent[] = [];
  const stats = bookStats(s.positions, s.assets, params);
  s.navPerShare = s.shares > 0 ? (stats.mark + s.reserve) / s.shares : s.navPerShare;
  events.push({ kind: "mark", day: s.day, navPerShare: s.navPerShare, mark: stats.mark });
  if (s.deployed && !s.closed && s.navPerShare < params.floor * s.hwm) {
    const recovered = windDown(s, params);
    events.push({ kind: "windDown", day: s.day, navPerShare: s.navPerShare, recovered });
  }
  events.push({ kind: "note", day: s.day, msg: `SHOCK ${(pct * 100).toFixed(0)}%` });
  return { state: s, events };
}

/** Force an immediate risk-parity/ERC re-strike (manual rebalance). */
export function forceRebalance(state: StrategyState, params: StrategyParams = DEFAULT_PARAMS): StepResult {
  const s = cloneState(state);
  if (!s.deployed || s.closed) return { state: s, events: [{ kind: "note", day: s.day, msg: "rebalance ignored" }] };
  const cost = reStrike(s, params);
  s.lastRebalDay = s.day;
  const events: StrategyEvent[] = [{ kind: "hedge", day: s.day, driftBefore: 0, reason: "scheduled" }];
  if (cost > 0) events.push({ kind: "cost", day: s.day, amount: cost, reason: "restrike" });
  s.navPerShare = (bookStats(s.positions, s.assets, params).mark + s.reserve) / s.shares;
  return { state: s, events };
}

/** Force a profit harvest now: skim `fraction` (default reserveSkim) of epoch profit into the reserve. */
export function forceHarvest(state: StrategyState, params: StrategyParams = DEFAULT_PARAMS, fraction?: number): StepResult {
  const s = cloneState(state);
  if (!s.deployed || s.closed) return { state: s, events: [{ kind: "note", day: s.day, msg: "harvest ignored" }] };
  const events: StrategyEvent[] = [];
  const totalProfit = (s.navPerShare - s.epochStartNav) * s.shares;
  let skimmed = 0;
  if (totalProfit > 0) {
    const h = harvest(s, params, (fraction ?? params.reserveSkim) * totalProfit);
    skimmed = h.take;
    if (h.cost > 0) events.push({ kind: "cost", day: s.day, amount: h.cost, reason: "harvest" });
  }
  s.epochStartNav = s.navPerShare;
  s.navPerShare = (bookStats(s.positions, s.assets, params).mark + s.reserve) / s.shares;
  events.push({ kind: "epoch", day: s.day, epoch: s.epoch, profit: totalProfit, skimmed, reserve: s.reserve });
  return { state: s, events };
}
