/* =============================================================================
 * @amplifi/portfolio-opt / meanvariance
 * -----------------------------------------------------------------------------
 * Markowitz mean-variance portfolio construction in closed form. Every weight
 * vector here is the analytic solution of a quadratic program solved through
 * Σ⁻¹ (via quant-core's SPD Cholesky solve) — no iterative optimiser needed for
 * the equality-constrained (fully-invested) case.
 *
 *   minVariance     w = Σ⁻¹1 / (1ᵀΣ⁻¹1)
 *   tangency        w ∝ Σ⁻¹(μ − r_f 1)            (max Sharpe)
 *   targetReturn    efficient-frontier point with wᵀμ = target, wᵀ1 = 1
 *
 * The harness verifies optimality directly: min-variance has the lowest variance
 * of any fully-invested portfolio, the tangency beats equal-weight on Sharpe, and
 * the frontier point hits its target return at variance ≥ the global minimum.
 * ===========================================================================*/

import { linalg } from "@amplifi/quant-core";

const ones = (n: number): Float64Array => {
  const o = new Float64Array(n);
  o.fill(1);
  return o;
};
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const normalizeSum1 = (w: Float64Array): Float64Array => {
  let s = 0;
  for (const x of w) s += x;
  const out = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) out[i] = w[i] / s;
  return out;
};

/** Global minimum-variance portfolio (fully invested, weights sum to 1). */
export function minVarianceWeights(cov: linalg.Mat): Float64Array {
  const n = cov.rows;
  const sigInvOne = linalg.solveSPD(cov, ones(n)); // Σ⁻¹1
  return normalizeSum1(sigInvOne);
}

/** Tangency (max-Sharpe) portfolio for excess returns μ − r_f. */
export function tangencyWeights(cov: linalg.Mat, mu: ArrayLike<number>, riskFree = 0): Float64Array {
  const n = cov.rows;
  const excess = new Float64Array(n);
  for (let i = 0; i < n; i++) excess[i] = mu[i] - riskFree;
  const sigInvExcess = linalg.solveSPD(cov, excess); // Σ⁻¹(μ − r_f1)
  return normalizeSum1(sigInvExcess);
}

export const maxSharpeWeights = tangencyWeights;

/**
 * Efficient-frontier portfolio achieving exactly `target` expected return while
 * fully invested. Uses the standard two-fund Lagrangian constants A, B, C, D.
 */
export function targetReturnWeights(cov: linalg.Mat, mu: ArrayLike<number>, target: number): Float64Array {
  const n = cov.rows;
  const sigInvOne = linalg.solveSPD(cov, ones(n));
  const sigInvMu = linalg.solveSPD(cov, mu);
  const A = dot(ones(n), sigInvOne); // 1ᵀΣ⁻¹1
  const B = dot(ones(n), sigInvMu); // 1ᵀΣ⁻¹μ
  const C = dot(mu, sigInvMu); // μᵀΣ⁻¹μ
  const D = A * C - B * B;
  const lambda = (C - B * target) / D;
  const gamma = (A * target - B) / D;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = lambda * sigInvOne[i] + gamma * sigInvMu[i];
  return w;
}

export function portfolioVariance(cov: linalg.Mat, w: ArrayLike<number>): number {
  return linalg.quadForm(cov, w);
}
export function portfolioReturn(mu: ArrayLike<number>, w: ArrayLike<number>): number {
  return dot(mu, w);
}
export function portfolioSharpe(cov: linalg.Mat, mu: ArrayLike<number>, w: ArrayLike<number>, riskFree = 0): number {
  const vol = Math.sqrt(portfolioVariance(cov, w));
  return vol > 0 ? (portfolioReturn(mu, w) - riskFree) / vol : 0;
}
