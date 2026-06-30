/* =============================================================================
 * @amplifi/quant-core — public surface
 * -----------------------------------------------------------------------------
 * The deterministic, dependency-free quantitative core shared by the AmpliFi
 * simulation engine, the off-chain alpha/risk services, and (via codegen) the
 * on-chain risk parameters. Everything here is pure: same inputs → same outputs,
 * no I/O, no globals, safe to run in a browser worker, a Node service, or a
 * fuzzing harness.
 *
 * Layers (low → high):
 *   numeric/   special functions, RNG, linear algebra
 *   pricing/   Black–Scholes greeks + implied-vol inversion
 *   surface/   SVI implied-vol surface + calibration
 *   portfolio/ book-level greek aggregation
 *   risk/      full-revaluation Monte-Carlo VaR / ES
 * ===========================================================================*/

export * as stats from "./numeric/stats";
export * as linalg from "./numeric/linalg";
export * as bs from "./pricing/blackscholes";
export * as iv from "./pricing/impliedvol";
export * as svi from "./surface/svi";
export * as book from "./portfolio/greeks";
export * as risk from "./risk/montecarlo";

// Re-export the most-used symbols at top level for ergonomic imports.
export { priceGreeks, price, parityResidual } from "./pricing/blackscholes";
export type { Greeks, BsInputs, OptionType } from "./pricing/blackscholes";
export { impliedVol } from "./pricing/impliedvol";
export { binomial, binomialPrice, earlyExercisePremium } from "./pricing/binomial";
export type { BinomialInputs, BinomialResult } from "./pricing/binomial";
export { barrierPrice } from "./pricing/barrier";
export type { BarrierInputs, BarrierKind } from "./pricing/barrier";
export { hestonPrice } from "./pricing/heston";
export type { HestonInputs, HestonParams } from "./pricing/heston";
export {
  geometricAsian,
  digitalCashOrNothing,
  digitalAssetOrNothing,
  varianceSwapFairVariance,
} from "./pricing/exotics";
export { VolSurface, sviVol, sviTotalVariance, calibrateSlice, calibrateSliceLM } from "./surface/svi";
export type { SviParams } from "./surface/svi";
export { aggregate, deltaDrift } from "./portfolio/greeks";
export type { Leg, PortfolioGreeks } from "./portfolio/greeks";
export { monteCarloVar, estimateCovariance } from "./risk/montecarlo";
export type { McConfig, McResult } from "./risk/montecarlo";

export const QUANT_CORE_VERSION = "0.1.0";
