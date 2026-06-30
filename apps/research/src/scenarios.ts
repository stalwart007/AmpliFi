/* A curated scenario suite spanning bull, calm-bull, bear, and jump regimes. */
import type { Scenario } from "./backtest";

export const SCENARIOS: Scenario[] = [
  { name: "calm-bull", drift: 0.6, diffusionVol: 0.1, rho: 0.35, days: 180, deposit: 1000, params: { costBps: 15 }, seed: 1n },
  { name: "volatile-bull", drift: 0.8, rho: 0.4, days: 180, deposit: 1000, params: { costBps: 15 }, seed: 2n },
  { name: "sideways", drift: 0.0, diffusionVol: 0.18, rho: 0.4, days: 180, deposit: 1000, params: { costBps: 15 }, seed: 3n },
  { name: "bear", drift: -0.4, rho: 0.5, days: 180, deposit: 1000, params: { costBps: 15 }, seed: 4n },
  {
    name: "jump-stress",
    drift: 0.2,
    rho: 0.5,
    jump: { intensityPerYear: 60, meanLog: -0.07, volLog: 0.06 },
    days: 180,
    deposit: 1000,
    params: { costBps: 15 },
    seed: 5n,
  },
];
