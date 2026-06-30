/* =============================================================================
 * @amplifi/portfolio-opt / blacklitterman
 * -----------------------------------------------------------------------------
 * The Black–Litterman model. It starts from the market-implied equilibrium
 * returns Π = δ·Σ·w_mkt (the returns the market's own weights imply) and blends
 * in subjective *views* P·E[R] = Q (± uncertainty Ω) to produce a posterior
 * expected-return vector that is far more stable than raw historical means.
 *
 * Posterior mean:
 *   E[R] = [ (τΣ)⁻¹ + Pᵀ Ω⁻¹ P ]⁻¹ [ (τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q ]
 *
 * With no views this returns Π exactly (asserted in the test); a bullish view on
 * an asset pushes that asset's posterior return above its equilibrium value
 * (also asserted). Pairs naturally with the mean-variance optimiser.
 * ===========================================================================*/

import { linalg } from "@amplifi/quant-core";

/** Market-implied equilibrium excess returns Π = δ·Σ·w_mkt. */
export function impliedEquilibriumReturns(
  cov: linalg.Mat,
  marketWeights: ArrayLike<number>,
  riskAversion: number,
): Float64Array {
  const sw = linalg.matVec(cov, marketWeights);
  const out = new Float64Array(sw.length);
  for (let i = 0; i < sw.length; i++) out[i] = riskAversion * sw[i];
  return out;
}

export interface BLViews {
  /** k × n pick matrix: each row selects/combines assets for one view. */
  P: number[][];
  /** k × 1 expected returns for each view. */
  Q: number[];
  /** Optional k × k view-uncertainty matrix Ω; defaults to diag(P·τΣ·Pᵀ). */
  omega?: number[][];
}

/** Black–Litterman posterior expected returns. */
export function blackLitterman(
  cov: linalg.Mat,
  marketWeights: ArrayLike<number>,
  riskAversion: number,
  views: BLViews | null,
  tau = 0.05,
): Float64Array {
  const n = cov.rows;
  const pi = impliedEquilibriumReturns(cov, marketWeights, riskAversion);
  if (!views || views.P.length === 0) return pi;

  const tauSigma = linalg.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) linalg.set(tauSigma, i, j, tau * linalg.at(cov, i, j));
  const invTauSigma = linalg.invSPD(tauSigma);

  const P = linalg.fromRows(views.P); // k × n
  const k = P.rows;
  const Pt = linalg.transpose(P); // n × k

  // Ω: default diag(P τΣ Pᵀ).
  let omega: linalg.Mat;
  if (views.omega) {
    omega = linalg.fromRows(views.omega);
  } else {
    const PtauS = linalg.matMul(P, tauSigma); // k × n
    const PtauSPt = linalg.matMul(PtauS, Pt); // k × k
    omega = linalg.zeros(k, k);
    for (let i = 0; i < k; i++) linalg.set(omega, i, i, Math.max(linalg.at(PtauSPt, i, i), 1e-12));
  }
  const invOmega = linalg.invSPD(omega);

  const PtInvOmega = linalg.matMul(Pt, invOmega); // n × k
  const PtInvOmegaP = linalg.matMul(PtInvOmega, P); // n × n

  // M = (τΣ)⁻¹ + PᵀΩ⁻¹P   (SPD)
  const M = linalg.zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) linalg.set(M, i, j, linalg.at(invTauSigma, i, j) + linalg.at(PtInvOmegaP, i, j));

  // rhs = (τΣ)⁻¹Π + PᵀΩ⁻¹Q
  const rhs1 = linalg.matVec(invTauSigma, pi);
  const rhs2 = linalg.matVec(PtInvOmega, Float64Array.from(views.Q));
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) rhs[i] = rhs1[i] + rhs2[i];

  return linalg.solveSPD(M, rhs);
}
