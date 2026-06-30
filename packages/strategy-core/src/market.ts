/* =============================================================================
 * @amplifi/strategy-core / market
 * -----------------------------------------------------------------------------
 * A deterministic correlated-GBM market generator used to drive the strategy in
 * simulation, in property tests, and (later) in the backtester. It is NOT a live
 * feed — the production path swaps this for @amplifi/market-data — but it shares
 * the same MarketUpdate shape so the strategy machine is agnostic to the source.
 *
 * Prices follow correlated geometric Brownian motion: per step,
 *     Sᵢ ← Sᵢ · exp((μᵢ − ½σᵢ²)·dt + σᵢ·√dt · cᵢ),   c = L·z,  z ~ N(0, I)
 * where L is the Cholesky factor of the correlation matrix. A `shock` hook lets
 * a test inject a jump on a given day so we can exercise the wind-down path.
 * ===========================================================================*/

import { stats, linalg } from "@amplifi/quant-core";
import { BasketAsset } from "./types";
import { MarketUpdate } from "./machine";

/**
 * Optional Merton jump-diffusion overlay. Pure GBM cannot produce the gap/crash
 * moves that the strategy is most exposed to (our own tests showed wind-down is
 * gap-driven), so honest stress testing needs jumps. Per step each asset draws
 * a Poisson(intensityPerYear·dt) number of jumps, each a lognormal multiplier
 * exp(meanLog + volLog·Z). A negative `meanLog` models crash-skew.
 */
export interface JumpConfig {
  intensityPerYear: number; // λ — expected jumps per year
  meanLog: number; // mean of the log jump size (negative ⇒ crash-skewed)
  volLog: number; // stdev of the log jump size
}

export interface MarketConfig {
  drift: Record<string, number>; // annualised μ per symbol
  vol: Record<string, number>; // annualised σ per symbol (diffusion)
  corr: number[][]; // correlation matrix, ordered as `symbols`
  symbols: string[];
  stepDays: number;
  seed?: bigint;
  jump?: JumpConfig; // optional jump-diffusion overlay (applied per asset)
}

export class CorrelatedGbm {
  private readonly L: linalg.Mat;
  private readonly rng: stats.Pcg32;
  private readonly gauss: stats.GaussianStream;
  private readonly spot: Record<string, number>;
  private readonly cfg: MarketConfig;

  constructor(initialSpots: Record<string, number>, cfg: MarketConfig) {
    this.cfg = cfg;
    this.spot = { ...initialSpots };
    this.L = linalg.safeCovCholesky(linalg.fromRows(cfg.corr));
    this.rng = new stats.Pcg32(cfg.seed ?? 0x1234_5678n);
    this.gauss = new stats.GaussianStream(this.rng);
  }

  /** Draw a Poisson(λ) count by Knuth's multiplicative method (λ small here). */
  private poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const limit = Math.exp(-lambda);
    let k = 0;
    let prod = this.rng.unitOpen();
    while (prod > limit) {
      k++;
      prod *= this.rng.unitOpen();
    }
    return k;
  }

  /** Produce the next market update; optionally apply a multiplicative shock. */
  next(shock?: Record<string, number>): MarketUpdate {
    const n = this.cfg.symbols.length;
    const dt = this.cfg.stepDays / 365;
    const sqrtDt = Math.sqrt(dt);
    const z = this.gauss.vector(n);
    const spots: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const sym = this.cfg.symbols[i];
      let c = 0;
      for (let j = 0; j <= i; j++) c += linalg.at(this.L, i, j) * z[j];
      const mu = this.cfg.drift[sym] ?? 0;
      const sig = this.cfg.vol[sym] ?? 0.5;
      let s = this.spot[sym] * Math.exp((mu - 0.5 * sig * sig) * dt + sig * sqrtDt * c);

      // Merton jump overlay: compound the diffusion with any jumps this step.
      if (this.cfg.jump) {
        const nJ = this.poisson(this.cfg.jump.intensityPerYear * dt);
        if (nJ > 0) {
          const jLog = nJ * this.cfg.jump.meanLog + Math.sqrt(nJ) * this.cfg.jump.volLog * this.gauss.draw();
          s *= Math.exp(jLog);
        }
      }

      if (shock && shock[sym] !== undefined) s *= shock[sym];
      this.spot[sym] = s;
      spots[sym] = s;
    }
    return { spots };
  }

  /** Materialise `steps` updates up front (handy for tests/backtests). */
  path(steps: number, shocks: Record<number, Record<string, number>> = {}): MarketUpdate[] {
    const out: MarketUpdate[] = [];
    for (let d = 0; d < steps; d++) out.push(this.next(shocks[d]));
    return out;
  }
}

/** Build a market config from a basket, with a flat pairwise correlation. */
export function flatCorrelationMarket(
  assets: BasketAsset[],
  rho: number,
  drift = 0,
  stepDays = 1,
  seed?: bigint,
): MarketConfig {
  const symbols = assets.map((a) => a.sym);
  const n = symbols.length;
  const corr = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : rho)));
  const driftMap: Record<string, number> = {};
  const volMap: Record<string, number> = {};
  for (const a of assets) {
    driftMap[a.sym] = drift;
    volMap[a.sym] = a.vol;
  }
  return { drift: driftMap, vol: volMap, corr, symbols, stepDays, seed };
}
