/* =============================================================================
 * @amplifi/strategy-core — public surface
 * -----------------------------------------------------------------------------
 * The strategy brain: risk-parity basket construction, long-option exposure
 * manufacture, delta-band hedging, epoch compounding, and drawdown wind-down,
 * expressed as a pure deterministic state machine over @amplifi/quant-core.
 *
 * This is the single implementation of the strategy's behaviour. The simulator
 * UI, the off-chain keeper, and the backtester all drive THIS machine — so what
 * a user sees and what the keeper does can never diverge.
 * ===========================================================================*/

export * from "./types";
export { riskParityWeights, ercWeights, basketWeights, buildBook, markBook } from "./basket";
export { createState, deploy, step, run, addCapital, redeem, shock, forceRebalance, forceHarvest } from "./machine";
export type { MarketUpdate } from "./machine";
export { CorrelatedGbm, flatCorrelationMarket } from "./market";
export type { MarketConfig, JumpConfig } from "./market";
export {
  navReturns,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown,
  calmarRatio,
  turnoverFromEvents,
  performanceReport,
} from "./analytics";
export type { PerformanceReport } from "./analytics";

export const STRATEGY_CORE_VERSION = "0.1.0";
