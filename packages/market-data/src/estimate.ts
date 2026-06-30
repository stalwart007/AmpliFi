/* =============================================================================
 * @amplifi/market-data / estimate
 * -----------------------------------------------------------------------------
 * Turns price history into the statistics the risk and strategy layers consume:
 * log returns, realized (close-to-close) vol, EWMA vol, and an annualised
 * covariance/correlation matrix. All annualisation is explicit via
 * `periodsPerYear` so daily/hourly bars are handled identically.
 * ===========================================================================*/

import { linalg } from "@amplifi/quant-core";

export function logReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  return r;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Annualised realized volatility from close prices. */
export function realizedVol(prices: number[], periodsPerYear = 365): number {
  const r = logReturns(prices);
  if (r.length < 2) return 0;
  const m = mean(r);
  const variance = r.reduce((s, x) => s + (x - m) * (x - m), 0) / (r.length - 1);
  return Math.sqrt(variance * periodsPerYear);
}

/**
 * Annualised EWMA volatility (RiskMetrics-style). λ closer to 1 = slower decay /
 * longer memory. Returns the volatility as of the last observation.
 */
export function ewmaVol(prices: number[], lambda = 0.94, periodsPerYear = 365): number {
  const r = logReturns(prices);
  if (r.length === 0) return 0;
  let variance = r[0] * r[0];
  for (let i = 1; i < r.length; i++) variance = lambda * variance + (1 - lambda) * r[i] * r[i];
  return Math.sqrt(variance * periodsPerYear);
}

/**
 * Annualised covariance matrix from a price-history map. `symbols` fixes row/col
 * order. Series must be equal length; the shortest common length is used.
 */
export function covarianceMatrix(
  history: Record<string, number[]>,
  symbols: string[],
  periodsPerYear = 365,
): linalg.Mat {
  const rets = symbols.map((s) => logReturns(history[s] ?? []));
  const m = Math.min(...rets.map((r) => r.length));
  if (m < 2) throw new Error("need ≥3 aligned observations per symbol");
  const trimmed = rets.map((r) => r.slice(r.length - m));
  const means = trimmed.map(mean);
  const n = symbols.length;
  const data = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < m; t++) s += (trimmed[i][t] - means[i]) * (trimmed[j][t] - means[j]);
      const cov = (s / (m - 1)) * periodsPerYear;
      data[i * n + j] = cov;
      data[j * n + i] = cov;
    }
  return { rows: n, cols: n, data };
}

/** Correlation matrix derived from the covariance matrix. */
export function correlationMatrix(history: Record<string, number[]>, symbols: string[]): number[][] {
  const cov = covarianceMatrix(history, symbols, 1);
  const n = symbols.length;
  const sd = Array.from({ length: n }, (_, i) => Math.sqrt(linalg.at(cov, i, i)));
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const denom = sd[i] * sd[j];
      return denom > 0 ? linalg.at(cov, i, j) / denom : i === j ? 1 : 0;
    }),
  );
}
