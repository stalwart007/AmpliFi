/* =============================================================================
 * research / stress
 * -----------------------------------------------------------------------------
 * Monte-Carlo stress testing of the strategy: run a scenario across many random
 * seeds and report the *distribution* of outcomes — the wind-down rate and the
 * NAV percentiles — rather than a single path. This is how you size tail risk
 * for a convex, path-dependent strategy: the median tells you little; the 5th
 * percentile and the wind-down frequency tell you everything.
 * ===========================================================================*/

import { runBacktest, type Scenario } from "./backtest";
import type { JumpConfig } from "@amplifi/strategy-core";

export interface StressResult {
  name: string;
  runs: number;
  windDownRate: number; // fraction of paths that hit the floor
  navP5: number; // 5th-percentile terminal NAV/share
  navP50: number; // median
  navP95: number; // 95th percentile
  worstNav: number;
  bestNav: number;
}

/** Run `base` across `runs` seeds and summarise the outcome distribution. */
export function monteCarloStress(base: Scenario, runs = 64): StressResult {
  const navs: number[] = [];
  let wound = 0;
  for (let s = 1; s <= runs; s++) {
    const r = runBacktest({ ...base, seed: BigInt(s * 2654435761) });
    navs.push(r.finalNav);
    if (r.closed) wound += 1;
  }
  navs.sort((a, b) => a - b);
  const pct = (q: number): number => navs[Math.min(navs.length - 1, Math.max(0, Math.floor(q * (navs.length - 1))))];
  return {
    name: base.name,
    runs,
    windDownRate: wound / runs,
    navP5: pct(0.05),
    navP50: pct(0.5),
    navP95: pct(0.95),
    worstNav: navs[0],
    bestNav: navs[navs.length - 1],
  };
}

const CRASH: JumpConfig = { intensityPerYear: 90, meanLog: -0.1, volLog: 0.07 };

/**
 * A library of named stress regimes spanning the failure modes that matter for a
 * long-options book: calm trend (control), a sharp jump-crash regime, a high
 * realised-vol regime that bleeds theta, and a correlation-breakdown regime
 * (high ρ removes diversification, so the whole basket moves together).
 */
export const STRESS_SUITE: Scenario[] = [
  { name: "calm-trend", drift: 0.6, diffusionVol: 0.06, rho: 0.3, days: 120, deposit: 1000, params: { costBps: 15 }, seed: 1n },
  { name: "jump-crash", drift: 0.1, rho: 0.5, jump: CRASH, days: 120, deposit: 1000, params: { costBps: 15 }, seed: 1n },
  { name: "high-vol-bleed", drift: 0.0, diffusionVol: 0.25, rho: 0.4, days: 120, deposit: 1000, params: { costBps: 15 }, seed: 1n },
  { name: "correlation-breakdown", drift: -0.1, rho: 0.95, days: 120, deposit: 1000, params: { costBps: 15 }, seed: 1n },
];

/** Run the full stress suite. */
export function runStressSuite(runs = 48): StressResult[] {
  return STRESS_SUITE.map((s) => monteCarloStress(s, runs));
}
