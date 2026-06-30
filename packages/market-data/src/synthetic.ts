/* =============================================================================
 * @amplifi/market-data / synthetic
 * -----------------------------------------------------------------------------
 * A deterministic correlated-GBM feed adapter built directly on quant-core's
 * RNG + Cholesky. Useful as a stand-in for a live feed in dev, demos, and tests.
 * Identical to the strategy-core market generator in spirit, but exposed through
 * the FeedAdapter interface and decoupled from the strategy package.
 * ===========================================================================*/

import { stats, linalg } from "@amplifi/quant-core";
import type { FeedAdapter, Snapshot } from "./types";

export interface SyntheticFeedConfig {
  symbols: string[];
  spot0: Record<string, number>;
  drift: Record<string, number>; // annualised μ
  vol: Record<string, number>; // annualised σ
  corr: number[][];
  stepDays: number;
  seed?: bigint;
}

export class SyntheticFeed implements FeedAdapter {
  readonly symbols: string[];
  private readonly L: linalg.Mat;
  private readonly gauss: stats.GaussianStream;
  private spot: Record<string, number>;

  constructor(private readonly cfg: SyntheticFeedConfig) {
    this.symbols = [...cfg.symbols];
    this.spot = { ...cfg.spot0 };
    this.L = linalg.safeCovCholesky(linalg.fromRows(cfg.corr));
    this.gauss = new stats.GaussianStream(new stats.Pcg32(cfg.seed ?? 0xfeed_1234n));
  }

  snapshot(): Snapshot {
    return { ...this.spot };
  }

  next(): Snapshot {
    const n = this.symbols.length;
    const dt = this.cfg.stepDays / 365;
    const sqrtDt = Math.sqrt(dt);
    const z = this.gauss.vector(n);
    const out: Snapshot = {};
    for (let i = 0; i < n; i++) {
      const sym = this.symbols[i];
      let c = 0;
      for (let j = 0; j <= i; j++) c += linalg.at(this.L, i, j) * z[j];
      const mu = this.cfg.drift[sym] ?? 0;
      const sig = this.cfg.vol[sym] ?? 0.5;
      this.spot[sym] = this.spot[sym] * Math.exp((mu - 0.5 * sig * sig) * dt + sig * sqrtDt * c);
      out[sym] = this.spot[sym];
    }
    return out;
  }
}
