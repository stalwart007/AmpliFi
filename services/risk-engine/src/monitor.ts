/* =============================================================================
 * risk-engine / monitor
 * -----------------------------------------------------------------------------
 * Evaluates a live options book against risk limits using quant-core's
 * full-revaluation Monte-Carlo VaR/ES, and emits structured breaches. This is
 * the component a scheduler calls every N seconds and that pages on a breach.
 * ===========================================================================*/

import { aggregate, monteCarloVar, linalg, type Leg } from "@amplifi/quant-core";

export interface Book {
  legs: Leg[];
  underlyings: string[];
  spot0: Record<string, number>;
  vols: Record<string, number>;
  /** correlation matrix over `underlyings` (defaults to identity if absent) */
  corr?: number[][];
  /** equity / premium budget backing the book (for the leverage limit) */
  equity: number;
  navPerShare: number;
}

export interface RiskLimits {
  maxVar95Frac?: number; // VaR95 as a fraction of equity (e.g. 0.5 = 50%)
  maxEs99Frac?: number; // ES99 as a fraction of equity
  maxLeverage?: number; // dollar-delta / equity
  minNavPerShare?: number; // wind-down proximity floor
  horizonYears?: number;
  paths?: number;
}

export type Severity = "info" | "warn" | "critical";

export interface Breach {
  code: string;
  severity: Severity;
  message: string;
  value: number;
  limit: number;
}

export interface RiskReport {
  ts: string;
  base: number;
  var95: number;
  es95: number;
  var99: number;
  es99: number;
  leverage: number;
  navPerShare: number;
  breaches: Breach[];
  worstBreach: Severity | "none";
}

function covOf(book: Book): linalg.Mat {
  const n = book.underlyings.length;
  const corr = book.corr ?? Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const rows = corr.map((row, i) => row.map((rho, j) => book.vols[book.underlyings[i]] * book.vols[book.underlyings[j]] * rho));
  return linalg.fromRows(rows);
}

export function evaluate(book: Book, limits: RiskLimits = {}): RiskReport {
  const horizonYears = limits.horizonYears ?? 1 / 365;
  const paths = limits.paths ?? 20000;

  const mc =
    book.legs.length > 0
      ? monteCarloVar(book.legs, book.underlyings, book.spot0, book.vols, covOf(book), {
          paths,
          horizonYears,
          antithetic: true,
          levels: [0.95, 0.99],
        })
      : null;

  const var95 = mc?.tail["0.9500"].var ?? 0;
  const es95 = mc?.tail["0.9500"].es ?? 0;
  const var99 = mc?.tail["0.9900"].var ?? 0;
  const es99 = mc?.tail["0.9900"].es ?? 0;
  const base = mc?.base ?? 0;
  const leverage = book.equity > 0 && book.legs.length > 0 ? aggregate(book.legs).dollarDelta / book.equity : 0;

  const breaches: Breach[] = [];
  const push = (cond: boolean, code: string, severity: Severity, value: number, limit: number, message: string) => {
    if (cond) breaches.push({ code, severity, value, limit, message });
  };

  if (limits.maxVar95Frac !== undefined && book.equity > 0) {
    const frac = var95 / book.equity;
    push(frac > limits.maxVar95Frac, "VAR95_LIMIT", "warn", frac, limits.maxVar95Frac, `1-day VaR95 ${(frac * 100).toFixed(1)}% of equity exceeds ${(limits.maxVar95Frac * 100).toFixed(0)}%`);
  }
  if (limits.maxEs99Frac !== undefined && book.equity > 0) {
    const frac = es99 / book.equity;
    push(frac > limits.maxEs99Frac, "ES99_LIMIT", "critical", frac, limits.maxEs99Frac, `1-day ES99 ${(frac * 100).toFixed(1)}% of equity exceeds ${(limits.maxEs99Frac * 100).toFixed(0)}%`);
  }
  if (limits.maxLeverage !== undefined) {
    push(leverage > limits.maxLeverage, "LEVERAGE_LIMIT", "warn", leverage, limits.maxLeverage, `leverage ${leverage.toFixed(2)}× exceeds ${limits.maxLeverage}×`);
  }
  if (limits.minNavPerShare !== undefined) {
    push(book.navPerShare < limits.minNavPerShare, "NAV_FLOOR", "critical", book.navPerShare, limits.minNavPerShare, `NAV/share ${book.navPerShare.toFixed(3)} below floor ${limits.minNavPerShare}`);
  }

  const rank: Record<Severity, number> = { info: 0, warn: 1, critical: 2 };
  const worstBreach = breaches.length === 0 ? "none" : breaches.reduce<Severity>((acc, b) => (rank[b.severity] > rank[acc] ? b.severity : acc), "info");

  return { ts: new Date().toISOString(), base, var95, es95, var99, es99, leverage, navPerShare: book.navPerShare, breaches, worstBreach };
}
