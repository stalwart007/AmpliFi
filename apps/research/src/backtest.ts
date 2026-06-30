/* =============================================================================
 * research / backtest
 * -----------------------------------------------------------------------------
 * Runs the real strategy-core engine over a generated market path and reports
 * risk-adjusted performance. This is the offline counterpart to the live keeper:
 * same state machine, deterministic market, full analytics. Parameter sweeps let
 * us study how costs, the drawdown floor, and jump regimes move the outcome.
 * ===========================================================================*/

import {
  createState,
  deploy,
  step,
  CorrelatedGbm,
  flatCorrelationMarket,
  performanceReport,
  DEFAULT_PARAMS,
  type BasketAsset,
  type StrategyParams,
  type PerformanceReport,
  type JumpConfig,
} from "@amplifi/strategy-core";

export interface Scenario {
  name: string;
  drift: number; // annualised market drift
  diffusionVol?: number; // override per-asset diffusion vol (keeps pricing vol)
  rho: number; // pairwise correlation
  jump?: JumpConfig;
  days: number;
  deposit: number;
  params?: Partial<StrategyParams>;
  seed: bigint;
}

export interface BacktestResult {
  scenario: string;
  report: PerformanceReport;
  finalNav: number;
  closed: boolean;
  daysSurvived: number;
  epochs: number;
}

const UNIVERSE: BasketAsset[] = [
  { sym: "BTC", spot: 64000, vol: 0.55, active: true },
  { sym: "ETH", spot: 3400, vol: 0.66, active: true },
  { sym: "SOL", spot: 150, vol: 0.92, active: true },
  { sym: "BNB", spot: 585, vol: 0.58, active: true },
];

export function runBacktest(sc: Scenario): BacktestResult {
  const assets = UNIVERSE.map((a) => ({ ...a }));
  const active = assets.filter((a) => a.active);
  const params: StrategyParams = { ...DEFAULT_PARAMS, ...sc.params };

  const cfg = flatCorrelationMarket(active, sc.rho, sc.drift, 1, sc.seed);
  if (sc.diffusionVol !== undefined) for (const s of cfg.symbols) cfg.vol[s] = sc.diffusionVol;
  if (sc.jump) cfg.jump = sc.jump;
  const spots: Record<string, number> = {};
  active.forEach((a) => (spots[a.sym] = a.spot));
  const gbm = new CorrelatedGbm(spots, cfg);

  let s = deploy(createState(assets), sc.deposit, params).state;
  const nav: number[] = [s.navPerShare];
  const events = [];
  for (let d = 0; d < sc.days && !s.closed; d++) {
    const r = step(s, params, gbm.next());
    s = r.state;
    nav.push(s.navPerShare);
    events.push(...r.events);
  }
  const report = performanceReport(nav, events, 365);
  return {
    scenario: sc.name,
    report,
    finalNav: s.navPerShare,
    closed: s.closed,
    daysSurvived: s.day,
    epochs: s.epoch,
  };
}

/** Sweep one numeric parameter across values, returning a result per point. */
export function sweep<K extends keyof StrategyParams>(base: Scenario, key: K, values: number[]): BacktestResult[] {
  return values.map((v) =>
    runBacktest({ ...base, name: `${base.name} · ${String(key)}=${v}`, params: { ...base.params, [key]: v } }),
  );
}
