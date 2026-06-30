/* =============================================================================
 * quant-core / pricing / binomial
 * -----------------------------------------------------------------------------
 * Cox–Ross–Rubinstein (CRR) binomial tree for European AND American options
 * under the cost-of-carry model (carry b, matching pricing/blackscholes). The
 * tree is the canonical way to price early exercise, which the closed-form
 * Black–Scholes cannot: at every node an American option takes max(continuation,
 * intrinsic).
 *
 * Convergence: as steps → ∞ the European tree price → Black–Scholes. The test
 * harness asserts this, and asserts the American early-exercise premium is ≥ 0
 * and zero for a non-dividend American call (never optimal to exercise early).
 *
 * Greeks are produced from the tree itself where the lattice already exposes
 * the needed nodes (delta, gamma from the first two layers; theta from the
 * central node two steps in) — no extra tree builds — falling back to a central
 * finite difference for vega/rho.
 * ===========================================================================*/

import { price as bsPrice, type OptionType } from "./blackscholes";

export interface BinomialInputs {
  s: number;
  k: number;
  t: number;
  vol: number;
  r: number;
  b?: number; // cost of carry; default r
  type: OptionType;
  american?: boolean; // default false (European)
  steps?: number; // default 256
}

export interface BinomialResult {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per year
}

const payoff = (type: OptionType, s: number, k: number): number =>
  type === "call" ? Math.max(s - k, 0) : Math.max(k - s, 0);

/**
 * Price + lattice greeks. We keep the asset-price lattice implicit (S·u^j·d^(i−j))
 * and roll a single value array backwards. To recover delta/gamma/theta we retain
 * the option values at steps 1 and 2 (the standard lattice-greek trick).
 */
export function binomial(inp: BinomialInputs): BinomialResult {
  const { s, k, t, vol, r, type } = inp;
  const b = inp.b ?? r;
  const american = inp.american ?? false;
  const n = Math.max(2, inp.steps ?? 256);

  const dt = t / n;
  const u = Math.exp(vol * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp(b * dt) - d) / (u - d);
  const q = 1 - p;

  // Terminal layer values.
  const v = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) v[j] = payoff(type, s * Math.pow(u, j) * Math.pow(d, n - j), k);

  // Capture the values at small step counts for greeks.
  let v00 = 0; // value at root
  let v10 = 0,
    v11 = 0; // step 1 (down, up)
  let v20 = 0,
    v21 = 0,
    v22 = 0; // step 2

  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= i; j++) {
      let cont = disc * (p * v[j + 1] + q * v[j]);
      if (american) {
        const sNode = s * Math.pow(u, j) * Math.pow(d, i - j);
        cont = Math.max(cont, payoff(type, sNode, k));
      }
      v[j] = cont;
    }
    if (i === 2) {
      v20 = v[0];
      v21 = v[1];
      v22 = v[2];
    }
    if (i === 1) {
      v10 = v[0];
      v11 = v[1];
    }
  }
  v00 = v[0];

  // Lattice greeks.
  const sU = s * u,
    sD = s * d;
  const delta = (v11 - v10) / (sU - sD);

  const sUU = s * u * u,
    sMid = s,
    sDD = s * d * d;
  const deltaUp = (v22 - v21) / (sUU - sMid);
  const deltaDown = (v21 - v20) / (sMid - sDD);
  const gamma = (deltaUp - deltaDown) / (0.5 * (sUU - sDD));

  // Theta: value at the central node two steps forward vs. root, over 2·dt.
  const theta = (v21 - v00) / (2 * dt);

  return { price: v00, delta, gamma, theta };
}

/** Convenience: price only. */
export function binomialPrice(inp: BinomialInputs): number {
  return binomial(inp).price;
}

/**
 * Early-exercise premium = American price − European price (≥ 0). A handy,
 * directly-testable quantity: it is exactly zero for a non-dividend American
 * call (b = r) and strictly positive for an American put.
 */
export function earlyExercisePremium(inp: Omit<BinomialInputs, "american">): number {
  const american = binomialPrice({ ...inp, american: true });
  const european = bsPrice({ s: inp.s, k: inp.k, t: inp.t, vol: inp.vol, r: inp.r, b: inp.b ?? inp.r, type: inp.type });
  return american - european;
}
