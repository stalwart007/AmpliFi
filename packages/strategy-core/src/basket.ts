/* =============================================================================
 * @amplifi/strategy-core / basket
 * -----------------------------------------------------------------------------
 * Basket construction: how a premium budget becomes a book of long-option legs.
 *
 *   1. RISK-PARITY weights — each active asset is weighted ∝ 1/σ, so every leg
 *      contributes roughly equal *risk* rather than equal dollars. Low-vol
 *      names get more budget; weights sum to 1.
 *   2. PREMIUM ALLOCATION — leg i receives wᵢ · budget of premium and buys ATM
 *      calls: qtyᵢ = (wᵢ · budget) / priceᵢ. Total premium spent == budget,
 *      which is exactly the capped-downside guarantee (you cannot lose more
 *      than the premium you paid).
 *   3. REALIZED LEVERAGE — Σ qtyᵢ · Δᵢ · spotᵢ / budget. This is an *output*
 *      of the option deltas, not an input; reporting it honestly is the whole
 *      point — leverage is manufactured, not asserted.
 *
 * All pricing/greeks come from @amplifi/quant-core; this module never touches
 * Black–Scholes directly.
 * ===========================================================================*/

import { priceGreeks } from "@amplifi/quant-core";
import { BasketAsset, Position, StrategyParams } from "./types";

/** Risk-parity weights over the active assets (∝ 1/σ, normalised to sum 1). */
export function riskParityWeights(assets: BasketAsset[]): Record<string, number> {
  const active = assets.filter((a) => a.active);
  const invSum = active.reduce((s, a) => s + 1 / a.vol, 0);
  const w: Record<string, number> = {};
  for (const a of assets) w[a.sym] = a.active && invSum > 0 ? 1 / a.vol / invSum : 0;
  return w;
}

/**
 * Equal-Risk-Contribution (ERC) weights — the covariance-aware generalisation of
 * risk parity. Inverse-vol weighting only equalises risk when assets are
 * uncorrelated; with real cross-asset correlation it over-weights clustered
 * names. ERC instead solves for weights where each leg's *risk contribution*
 * RCᵢ = wᵢ·(Σw)ᵢ is equal across the basket.
 *
 * Solved by a damped multiplicative fixed-point iteration (Spinu-style): cheap,
 * dependency-free, and convergent for any PSD covariance. `corr` is indexed by
 * the full `assets` array; inactive legs get weight 0. Falls back to inverse-vol
 * if the iteration cannot make progress (e.g. degenerate covariance).
 */
export function ercWeights(assets: BasketAsset[], corr: number[][], iters = 500): Record<string, number> {
  const idx: number[] = [];
  assets.forEach((a, i) => a.active && idx.push(i));
  const n = idx.length;
  if (n === 0) return {};
  if (n === 1) return { [assets[idx[0]].sym]: 1 };

  // Covariance over active legs: Σ_ab = σ_a σ_b ρ_ab.
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++)
    for (let bI = 0; bI < n; bI++) {
      const va = assets[idx[a]].vol;
      const vb = assets[idx[bI]].vol;
      const rho = corr[idx[a]]?.[idx[bI]] ?? (a === bI ? 1 : 0);
      cov[a][bI] = va * vb * rho;
    }

  // Initialise at inverse-vol, then iterate w_i ← w_i·(avgRC / RC_i)^η.
  let w = idx.map((i) => 1 / assets[i].vol);
  const norm = (v: number[]) => {
    const s = v.reduce((acc, x) => acc + x, 0);
    return s > 0 ? v.map((x) => x / s) : v.map(() => 1 / v.length);
  };
  w = norm(w);

  const eta = 0.5;
  for (let it = 0; it < iters; it++) {
    const mrc = w.map((_, a) => cov[a].reduce((acc, cab, bI) => acc + cab * w[bI], 0)); // (Σw)
    const rc = w.map((wa, a) => wa * mrc[a]);
    const avg = rc.reduce((acc, x) => acc + x, 0) / n;
    if (avg <= 0) break;
    let maxRel = 0;
    for (let a = 0; a < n; a++) {
      maxRel = Math.max(maxRel, Math.abs(rc[a] - avg) / avg);
      w[a] = Math.max(w[a] * Math.pow(avg / Math.max(rc[a], 1e-18), eta), 1e-12);
    }
    w = norm(w);
    if (maxRel < 1e-10) break;
  }

  const out: Record<string, number> = {};
  for (const a of assets) out[a.sym] = 0;
  idx.forEach((i, a) => (out[assets[i].sym] = w[a]));
  return out;
}

/** Pick the weighting scheme: ERC when a correlation matrix is supplied, else 1/σ. */
export function basketWeights(assets: BasketAsset[], params: StrategyParams): Record<string, number> {
  return params.corr ? ercWeights(assets, params.corr) : riskParityWeights(assets);
}

/**
 * Strike a fresh book of long ATM calls from a premium `budget`. Returns the
 * positions plus the realized leverage they manufacture. Legs whose price is
 * non-positive (degenerate inputs) are skipped rather than producing infinities.
 */
export function buildBook(
  assets: BasketAsset[],
  weights: Record<string, number>,
  budget: number,
  params: StrategyParams,
): { positions: Position[]; realizedLeverage: number; premiumSpent: number } {
  const positions: Position[] = [];
  let premiumSpent = 0;
  let dollarDelta = 0;

  for (const a of assets) {
    if (!a.active) continue;
    const w = weights[a.sym] ?? 0;
    if (w <= 0) continue;
    const legBudget = w * budget;

    const g = priceGreeks({
      s: a.spot,
      k: a.spot, // at-the-money
      t: params.expiryYears,
      vol: a.vol,
      r: params.r,
      b: params.b,
      type: "call",
    });
    if (!(g.price > 0)) continue;

    const qty = legBudget / g.price;
    positions.push({
      sym: a.sym,
      qty,
      strike: a.spot,
      expiry: params.expiryYears,
      vol: a.vol,
      entrySpot: a.spot,
      premiumPaid: legBudget,
    });
    premiumSpent += legBudget;
    dollarDelta += qty * g.delta * a.spot;
  }

  const realizedLeverage = budget > 0 ? dollarDelta / budget : 0;
  return { positions, realizedLeverage, premiumSpent };
}

/**
 * Mark-to-market value of a book at the current asset spots, plus its net
 * dollar-delta (used by the hedger). Each position is repriced with the live
 * spot, its own strike, and its *remaining* time-to-expiry — so theta decay is
 * reflected in the mark, not just spot moves.
 */
export function markBook(
  positions: Position[],
  assets: BasketAsset[],
  params: StrategyParams,
): { mark: number; dollarDelta: number } {
  const spotOf: Record<string, number> = {};
  for (const a of assets) spotOf[a.sym] = a.spot;

  let mark = 0;
  let dollarDelta = 0;
  for (const p of positions) {
    const s = spotOf[p.sym];
    if (s === undefined) continue;
    const g = priceGreeks({
      s,
      k: p.strike,
      t: p.expiry,
      vol: p.vol,
      r: params.r,
      b: params.b,
      type: "call",
    });
    mark += p.qty * g.price;
    dollarDelta += p.qty * g.delta * s;
  }
  return { mark, dollarDelta };
}
