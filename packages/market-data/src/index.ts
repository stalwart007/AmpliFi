/* @amplifi/market-data — feeds, replay, and estimation over normalised marks. */
export * from "./types";
export { SyntheticFeed } from "./synthetic";
export type { SyntheticFeedConfig } from "./synthetic";
export { ReplayFeed, parseWideCsv, ticksToBars } from "./replay";
export { logReturns, realizedVol, ewmaVol, covarianceMatrix, correlationMatrix } from "./estimate";
export const MARKET_DATA_VERSION = "0.1.0";
