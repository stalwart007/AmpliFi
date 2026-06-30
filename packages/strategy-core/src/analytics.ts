/* =============================================================================
 * @amplifi/strategy-core / analytics
 * -----------------------------------------------------------------------------
 * Risk-adjusted performance metrics over a NAV/share series. These turn a raw
 * backtest into the numbers an allocator actually reads: Sharpe, Sortino, max
 * drawdown, Calmar, and realised turnover. All pure, all deterministic.
 *
 * Conventions: `nav` is the per-share series (par = 1 at genesis), one sample
 * per step; `periodsPerYear` annualises (e.g. 365 for daily steps). Returns are
 * simple period returns navₜ/navₜ₋₁ − 1. Risk-free is expressed per-annum and
 * de-annualised internally.
 * ===========================================================================*/

import { StrategyEvent } from "./types";

/** Simple period returns from a NAV series. */
export function navReturns(nav: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    const prev = nav[i - 1];
    r.push(prev > 0 ? nav[i] / prev - 1 : 0);
  }
  return r;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

/**
 * Annualised Sharpe ratio. The per-period excess return is annualised by
 * `periodsPerYear` and the per-period stdev by √periodsPerYear, so the ratio
 * scales by √periodsPerYear as expected.
 */
export function sharpeRatio(nav: number[], periodsPerYear = 365, riskFreeAnnual = 0): number {
  const r = navReturns(nav);
  if (r.length < 2) return 0;
  const rfPer = riskFreeAnnual / periodsPerYear;
  const excess = r.map((x) => x - rfPer);
  const sd = std(excess);
  if (sd === 0) return 0;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

/**
 * Annualised Sortino ratio — like Sharpe but penalising only downside
 * deviation (returns below the risk-free target). The right metric for a
 * convex, positively-skewed payoff, where upside volatility is not "risk".
 */
export function sortinoRatio(nav: number[], periodsPerYear = 365, riskFreeAnnual = 0): number {
  const r = navReturns(nav);
  if (r.length < 2) return 0;
  const rfPer = riskFreeAnnual / periodsPerYear;
  const excess = r.map((x) => x - rfPer);
  const downside = excess.map((x) => (x < 0 ? x * x : 0));
  const dd = Math.sqrt(mean(downside));
  if (dd === 0) return excess.every((x) => x >= 0) && mean(excess) > 0 ? Infinity : 0;
  return (mean(excess) / dd) * Math.sqrt(periodsPerYear);
}

/** Maximum peak-to-trough drawdown of the NAV series, as a positive fraction. */
export function maxDrawdown(nav: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  return maxDd;
}

/** Compound annual growth rate from first to last NAV sample. */
export function cagr(nav: number[], periodsPerYear = 365): number {
  if (nav.length < 2 || nav[0] <= 0) return 0;
  const years = (nav.length - 1) / periodsPerYear;
  if (years <= 0) return 0;
  return Math.pow(nav[nav.length - 1] / nav[0], 1 / years) - 1;
}

/** Calmar ratio: CAGR divided by max drawdown (return per unit of worst loss). */
export function calmarRatio(nav: number[], periodsPerYear = 365): number {
  const dd = maxDrawdown(nav);
  if (dd === 0) return 0;
  return cagr(nav, periodsPerYear) / dd;
}

/** Total transaction cost paid, summed from the event stream. */
export function turnoverFromEvents(events: StrategyEvent[]): { totalCost: number; restrikes: number } {
  let totalCost = 0;
  let restrikes = 0;
  for (const e of events) {
    if (e.kind === "cost") totalCost += e.amount;
    if (e.kind === "hedge") restrikes += 1;
  }
  return { totalCost, restrikes };
}

export interface PerformanceReport {
  finalNav: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  restrikes: number;
  totalCost: number;
}

/** One-call backtest summary from a NAV series and the event stream. */
export function performanceReport(
  nav: number[],
  events: StrategyEvent[] = [],
  periodsPerYear = 365,
  riskFreeAnnual = 0,
): PerformanceReport {
  const { totalCost, restrikes } = turnoverFromEvents(events);
  return {
    finalNav: nav.length ? nav[nav.length - 1] : 1,
    cagr: cagr(nav, periodsPerYear),
    sharpe: sharpeRatio(nav, periodsPerYear, riskFreeAnnual),
    sortino: sortinoRatio(nav, periodsPerYear, riskFreeAnnual),
    maxDrawdown: maxDrawdown(nav),
    calmar: calmarRatio(nav, periodsPerYear),
    restrikes,
    totalCost,
  };
}
