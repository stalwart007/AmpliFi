/* =============================================================================
 * quant-core / pricing / heston
 * -----------------------------------------------------------------------------
 * Heston (1993) stochastic-volatility European option pricing via the
 * characteristic function, using the Albrecher et al. "Little Trap" formulation
 * for numerical stability (it keeps the complex square root on the principal
 * branch, avoiding the discontinuities of the original parameterisation).
 *
 * The model: dS = (r−q)S dt + √v S dW₁ ;  dv = κ(θ−v)dt + ξ√v dW₂ ;  dW₁dW₂ = ρ dt.
 * Stochastic vol is what produces the implied-vol *smile* that flat Black–Scholes
 * cannot — directly relevant to pricing the basket's options away from the money.
 *
 * Verification (in the harness): as the vol-of-vol ξ → 0 with v₀ = θ the model
 * collapses to Black–Scholes at σ = √θ, which the test asserts across strikes;
 * put–call parity holds exactly.
 * ===========================================================================*/

import { type Complex, cx, cAdd, cSub, cMul, cDiv, cScale, cExp, cSqrt, cLog } from "../numeric/complex";
import type { OptionType } from "./blackscholes";

export interface HestonParams {
  v0: number; // initial variance
  kappa: number; // mean-reversion speed κ
  theta: number; // long-run variance θ
  xi: number; // vol of vol ξ
  rho: number; // correlation ρ ∈ (−1,1)
}

export interface HestonInputs {
  s: number;
  k: number;
  t: number;
  r: number;
  q?: number; // continuous dividend / funding; carry b = r − q (default 0)
  params: HestonParams;
  type: OptionType;
  // integration controls
  uMax?: number;
  nodes?: number;
}

/** One of the two Heston probability-integrand characteristic functions. */
function phi(j: 1 | 2, u: number, x: number, t: number, r: number, q: number, p: HestonParams): Complex {
  const { v0, kappa, theta, xi, rho } = p;
  const uj = j === 1 ? 0.5 : -0.5;
  const bj = j === 1 ? kappa - rho * xi : kappa;
  const a = kappa * theta;
  const iu = cx(0, u);

  const rsiu = cScale(rho * xi, iu); // ρξ·iu
  const A = cSub(rsiu, cx(bj)); // ρξ·iu − bⱼ
  const A2 = cMul(A, A);
  const sig2 = cScale(xi * xi, cx(-u * u, 2 * uj * u)); // ξ²(2uⱼ·iu − u²)
  const d = cSqrt(cSub(A2, sig2));

  const bMinusRsi = cSub(cx(bj), rsiu); // bⱼ − ρξ·iu
  const numC = cSub(bMinusRsi, d); // bⱼ − ρξ·iu − d
  const denC = cAdd(bMinusRsi, d); // bⱼ − ρξ·iu + d
  const c = cDiv(numC, denC);

  const edt = cExp(cScale(-t, d)); // e^{−dt}
  const cedt = cMul(c, edt);
  const oneMinusCedt = cSub(cx(1), cedt);
  const logTerm = cLog(cDiv(oneMinusCedt, cSub(cx(1), c)));

  const C = cAdd(cScale((r - q) * t, iu), cScale(a / (xi * xi), cSub(cScale(t, numC), cScale(2, logTerm))));
  const D = cMul(cScale(1 / (xi * xi), numC), cDiv(cSub(cx(1), edt), oneMinusCedt));

  return cExp(cAdd(cAdd(C, cScale(v0, D)), cScale(x, iu))); // + iu·x
}

/** Midpoint quadrature of a real integrand over (a, b]. */
function integrate(f: (u: number) => number, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h);
  return s * h;
}

/** Heston European price. */
export function hestonPrice(inp: HestonInputs): number {
  const { s, k, t, r, type } = inp;
  const q = inp.q ?? 0;
  const x = Math.log(s);
  const lnK = Math.log(k);
  const uMax = inp.uMax ?? 200;
  const nodes = inp.nodes ?? 4000;

  const Pj = (j: 1 | 2): number => {
    const integrand = (u: number): number => {
      const f = phi(j, u, x, t, r, q, inp.params);
      // Re[ e^{−i u lnK} · φ / (i u) ]
      const num = cMul(cExp(cx(0, -u * lnK)), f);
      const val = cDiv(num, cx(0, u));
      return val.re;
    };
    return 0.5 + (1 / Math.PI) * integrate(integrand, 1e-6, uMax, nodes);
  };

  const p1 = Pj(1);
  const p2 = Pj(2);
  const call = s * Math.exp(-q * t) * p1 - k * Math.exp(-r * t) * p2;
  if (type === "call") return Math.max(call, 0);
  // put–call parity
  return Math.max(call - s * Math.exp(-q * t) + k * Math.exp(-r * t), 0);
}
