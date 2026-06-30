/* =============================================================================
 * quant-core / risk / montecarlo
 * -----------------------------------------------------------------------------
 * Full-revaluation Monte-Carlo risk for an options book.
 *
 * Method
 *   1. Estimate (or accept) a covariance matrix of the underlyings' log-returns
 *      over the risk horizon h.
 *   2. Cholesky-factor it (with the Higham safety net) → L.
 *   3. For each path, draw z ~ N(0, I), correlate via L·z, and evolve every
 *      underlying as a one-step GBM:  S_h = S_0 · exp((μ − ½σ²)h + correlated).
 *   4. Re-price the *entire book* at the shocked spots (full revaluation — not a
 *      delta-gamma Taylor proxy), giving a path P&L = V(S_h) − V(S_0).
 *   5. Reduce the P&L sample to VaR / Expected Shortfall and moments.
 *
 * Full revaluation matters here because the book is long convex options: a
 * delta-normal VaR systematically *understates* the upside and misprices the
 * capped downside that is the strategy's whole selling point. We pay the
 * per-path repricing cost to get the tails right.
 * ===========================================================================*/

import { Mat, at, safeCovCholesky } from "../numeric/linalg";
import { Pcg32, GaussianStream, mean, stdev, quantile } from "../numeric/stats";
import { Leg, aggregate } from "../portfolio/greeks";

export interface McConfig {
  paths: number;
  horizonYears: number; // h — risk horizon (e.g. 1/365 for 1-day VaR)
  drift?: Float64Array; // annualised μ per underlying; defaults to 0 (risk-neutral-ish)
  seed?: bigint;
  /** confidence levels for VaR/ES, e.g. [0.95, 0.99] */
  levels?: number[];
  /**
   * Antithetic variates: draw each shock z together with its mirror −z. The
   * pair's estimation errors are negatively correlated, so the mean/VaR/ES
   * estimators converge with materially lower variance for the same number of
   * repricings. Default on; set false for plain i.i.d. sampling.
   */
  antithetic?: boolean;
}

export interface McResult {
  paths: number;
  horizonYears: number;
  base: number; // V(S_0)
  meanPnl: number;
  stdPnl: number;
  /** map confidence → { var, es } as POSITIVE loss magnitudes */
  tail: Record<string, { var: number; es: number }>;
  /** best/worst single-path P&L observed */
  worst: number;
  best: number;
  pnl: Float64Array; // raw sample (caller may histogram it)
}

/**
 * Estimate an annualised log-return covariance matrix from a price history
 * matrix `prices` (rows = observations in time order, cols = underlyings).
 * `periodsPerYear` annualises (e.g. 365 for daily marks). Used when the caller
 * has data; if they already have a covariance view they pass it straight to
 * `monteCarloVar`.
 */
export function estimateCovariance(prices: Mat, periodsPerYear: number): Mat {
  const T = prices.rows;
  const N = prices.cols;
  if (T < 3) throw new Error("need ≥3 observations to estimate covariance");
  // log returns
  const R = new Float64Array((T - 1) * N);
  for (let t = 1; t < T; t++)
    for (let j = 0; j < N; j++) R[(t - 1) * N + j] = Math.log(at(prices, t, j) / at(prices, t - 1, j));
  const m = T - 1;
  const means = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let t = 0; t < m; t++) s += R[t * N + j];
    means[j] = s / m;
  }
  const data = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = i; j < N; j++) {
      let s = 0;
      for (let t = 0; t < m; t++) s += (R[t * N + i] - means[i]) * (R[t * N + j] - means[j]);
      const cov = (s / (m - 1)) * periodsPerYear; // unbiased + annualised
      data[i * N + j] = cov;
      data[j * N + i] = cov;
    }
  return { rows: N, cols: N, data };
}

/**
 * Core engine. `legs` is the book; `underlyings` is the ordered list of distinct
 * underlying symbols whose spots the covariance refers to; `vols` is the
 * per-underlying annualised vol used for the GBM diffusion (typically the
 * ATM implied vol from the surface). The covariance supplies cross-asset
 * correlation; its diagonal and `vols` should be mutually consistent but the
 * engine renormalises correlation from the covariance internally, so a slight
 * mismatch is tolerated.
 */
export function monteCarloVar(
  legs: Leg[],
  underlyings: string[],
  spot0: Record<string, number>,
  vols: Record<string, number>,
  cov: Mat,
  cfg: McConfig,
): McResult {
  const N = underlyings.length;
  if (cov.rows !== N || cov.cols !== N) throw new Error("covariance dim ≠ #underlyings");

  const L = safeCovCholesky(cov);
  const rng = new Pcg32(cfg.seed ?? 0x9e3779b97f4a7c15n);
  const gauss = new GaussianStream(rng);
  const h = cfg.horizonYears;
  const sqrtH = Math.sqrt(h);
  const levels = cfg.levels ?? [0.95, 0.99];

  // Base mark at S_0.
  const base = aggregate(legs).mark;

  // Index legs by underlying so each path only re-maps the shocked spots.
  const idxOf: Record<string, number> = {};
  underlyings.forEach((u, i) => (idxOf[u] = i));

  const drift = cfg.drift ?? new Float64Array(N); // default μ = 0
  const sigma = new Float64Array(N);
  for (let i = 0; i < N; i++) sigma[i] = vols[underlyings[i]] ?? Math.sqrt(at(cov, i, i));

  const antithetic = cfg.antithetic ?? true;

  // Reprice the whole book under a standard-normal shock vector z. `sign` flips
  // the shock to its antithetic mirror (−z) without redrawing, so a pair shares
  // exactly opposite diffusion. theta rolls forward by h on every path.
  const repriceShock = (z: Float64Array, sign: number): number => {
    const shockedSpot: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      let c = 0;
      for (let j = 0; j <= i; j++) c += at(L, i, j) * z[j];
      c *= sign;
      const s0 = spot0[underlyings[i]];
      shockedSpot[underlyings[i]] = s0 * Math.exp((drift[i] - 0.5 * sigma[i] * sigma[i]) * h + c * sqrtH);
    }
    const shockedLegs: Leg[] = legs.map((leg) => ({
      ...leg,
      s: shockedSpot[leg.underlying] ?? leg.s,
      t: Math.max(leg.t - h, 0),
    }));
    return aggregate(shockedLegs).mark - base;
  };

  const pnl = new Float64Array(cfg.paths);
  if (antithetic) {
    for (let p = 0; p < cfg.paths; p += 2) {
      const z = gauss.vector(N);
      pnl[p] = repriceShock(z, +1);
      if (p + 1 < cfg.paths) pnl[p + 1] = repriceShock(z, -1);
    }
  } else {
    for (let p = 0; p < cfg.paths; p++) pnl[p] = repriceShock(gauss.vector(N), +1);
  }

  const tail: McResult["tail"] = {};
  for (const lvl of levels) {
    // Loss tail: VaR is the (1−lvl) lower quantile of P&L, reported as a positive loss.
    const qLoss = quantile(pnl, 1 - lvl);
    const varLoss = Math.max(-qLoss, 0);
    // ES = mean loss conditional on breaching VaR.
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < pnl.length; i++) {
      if (pnl[i] <= qLoss) {
        sum += pnl[i];
        cnt++;
      }
    }
    const es = cnt > 0 ? Math.max(-(sum / cnt), 0) : varLoss;
    tail[lvl.toFixed(4)] = { var: varLoss, es };
  }

  let worst = Infinity;
  let best = -Infinity;
  for (let i = 0; i < pnl.length; i++) {
    if (pnl[i] < worst) worst = pnl[i];
    if (pnl[i] > best) best = pnl[i];
  }

  return {
    paths: cfg.paths,
    horizonYears: h,
    base,
    meanPnl: mean(pnl),
    stdPnl: stdev(pnl),
    tail,
    worst,
    best,
    pnl,
  };
}
