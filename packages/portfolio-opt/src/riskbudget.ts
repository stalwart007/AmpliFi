/* =============================================================================
 * @amplifi/portfolio-opt / riskbudget
 * -----------------------------------------------------------------------------
 * Risk-budgeting portfolios: choose weights so each asset contributes a *target
 * share of total portfolio risk*. Equal budgets give the Equal-Risk-Contribution
 * (ERC / "risk parity") portfolio. Solved by a damped multiplicative fixed point
 * that is convergent for any PSD covariance (Spinu-style), the same scheme used
 * inside strategy-core but generalised to arbitrary budgets here.
 *
 * Risk contribution of asset i: RCᵢ = wᵢ·(Σw)ᵢ ; fractional RCᵢ / Σ RC. At the
 * solution the fractional contributions equal the requested budgets — which the
 * test asserts for both equal and skewed budgets.
 * ===========================================================================*/

import { linalg } from "@amplifi/quant-core";

/** Fractional risk contributions of `w` under covariance `cov` (sum to 1). */
export function riskContributions(cov: linalg.Mat, w: ArrayLike<number>): number[] {
  const mrc = linalg.matVec(cov, w); // Σw
  const rc = Array.from(w, (wi, i) => wi * mrc[i]);
  const total = rc.reduce((s, x) => s + x, 0);
  return rc.map((x) => (total !== 0 ? x / total : 0));
}

/**
 * Weights whose fractional risk contributions match `budgets` (a positive vector
 * summing to 1). Long-only, fully invested. `budgets` defaulting to equal gives
 * the ERC portfolio.
 */
export function riskBudgetWeights(cov: linalg.Mat, budgets?: number[], iters = 1000): Float64Array {
  const n = cov.rows;
  const b = budgets ?? new Array(n).fill(1 / n);
  const bSum = b.reduce((s, x) => s + x, 0);
  const target = b.map((x) => x / bSum);

  // Initialise at inverse-vol (a good risk-parity seed).
  let w = Array.from({ length: n }, (_, i) => 1 / Math.sqrt(linalg.at(cov, i, i)));
  const norm = (v: number[]): number[] => {
    const s = v.reduce((acc, x) => acc + x, 0);
    return v.map((x) => x / s);
  };
  w = norm(w);

  const eta = 0.5;
  for (let it = 0; it < iters; it++) {
    const mrc = linalg.matVec(cov, w); // Σw
    const rc = w.map((wi, i) => wi * mrc[i]);
    const totalRc = rc.reduce((s, x) => s + x, 0);
    if (totalRc <= 0) break;
    let maxRel = 0;
    for (let i = 0; i < n; i++) {
      const frac = rc[i] / totalRc;
      maxRel = Math.max(maxRel, Math.abs(frac - target[i]));
      w[i] = Math.max(w[i] * Math.pow(target[i] / Math.max(frac, 1e-18), eta), 1e-12);
    }
    w = norm(w);
    if (maxRel < 1e-12) break;
  }
  return Float64Array.from(w);
}

/** Convenience: the Equal-Risk-Contribution (risk-parity) portfolio. */
export function ercWeights(cov: linalg.Mat): Float64Array {
  return riskBudgetWeights(cov);
}
