/* =============================================================================
 * quant-core / pricing / impliedvol
 * -----------------------------------------------------------------------------
 * Invert Black–Scholes for σ given a market price. The function price(σ) is
 * smooth and strictly increasing in σ, so root-finding is well posed — but a
 * bare Newton step can overshoot into σ<0 for deep ITM/OTM quotes where vega
 * collapses. We therefore run a *safeguarded* Newton: take the Newton step when
 * it stays inside the current bracket, otherwise fall back to bisection. This
 * is the classic `rtsafe` strategy and it never diverges on a valid quote.
 * ===========================================================================*/

import { price, priceGreeks, OptionType } from "./blackscholes";

export interface IvInputs {
  target: number; // observed option price
  s: number;
  k: number;
  t: number;
  r: number;
  b?: number;
  type: OptionType;
}

export interface IvResult {
  vol: number;
  iterations: number;
  converged: boolean;
  /** absolute price residual at the returned vol */
  residual: number;
}

const VOL_LO = 1e-4; // 0.01% — below this the option is effectively intrinsic
const VOL_HI = 5.0; // 500% — crypto perps get wild, but not this wild

/**
 * No-arbitrage bounds check. A call must price within [max(S e^{(b-r)T}−K e^{-rT},0),
 * S e^{(b-r)T}]; a violated quote has no real implied vol and we say so rather
 * than return a garbage root.
 */
function withinNoArb(inp: IvInputs): boolean {
  const b = inp.b ?? inp.r;
  const fwdDisc = inp.s * Math.exp((b - inp.r) * inp.t);
  const kDisc = inp.k * Math.exp(-inp.r * inp.t);
  if (inp.type === "call") {
    const lo = Math.max(fwdDisc - kDisc, 0);
    return inp.target >= lo - 1e-9 && inp.target <= fwdDisc + 1e-9;
  }
  const lo = Math.max(kDisc - fwdDisc, 0);
  return inp.target >= lo - 1e-9 && inp.target <= kDisc + 1e-9;
}

export function impliedVol(inp: IvInputs, tol = 1e-8, maxIter = 100): IvResult {
  if (!withinNoArb(inp)) {
    return { vol: NaN, iterations: 0, converged: false, residual: Infinity };
  }

  const f = (vol: number): number =>
    price({ s: inp.s, k: inp.k, t: inp.t, vol, r: inp.r, b: inp.b ?? inp.r, type: inp.type }) - inp.target;

  let lo = VOL_LO;
  let hi = VOL_HI;
  let fLo = f(lo);
  let fHi = f(hi);

  // If the target sits outside [f(lo), f(hi)] the bracket is invalid → clamp.
  if (fLo > 0) return { vol: lo, iterations: 0, converged: false, residual: Math.abs(fLo) };
  if (fHi < 0) return { vol: hi, iterations: 0, converged: false, residual: Math.abs(fHi) };

  // Brenner–Subrahmanyam seed: σ₀ ≈ √(2π/T)·(price/S). Cheap, and usually lands
  // within a couple of Newton steps of the root for near-ATM quotes.
  let vol = Math.sqrt((2 * Math.PI) / inp.t) * (inp.target / inp.s);
  if (!(vol > lo && vol < hi)) vol = 0.5 * (lo + hi);

  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const g = priceGreeks({ s: inp.s, k: inp.k, t: inp.t, vol, r: inp.r, b: inp.b ?? inp.r, type: inp.type });
    const fv = g.price - inp.target;

    // Maintain the bracket so the bisection fallback always has a valid sign change.
    if (fv < 0) {
      lo = vol;
      fLo = fv;
    } else {
      hi = vol;
      fHi = fv;
    }

    if (Math.abs(fv) < tol) {
      return { vol, iterations: iterations + 1, converged: true, residual: Math.abs(fv) };
    }

    // Newton step; guard against vanishing vega (deep ITM/OTM).
    const newton = g.vega > 1e-12 ? vol - fv / g.vega : Infinity;
    if (newton > lo && newton < hi && Number.isFinite(newton)) {
      vol = newton;
    } else {
      vol = 0.5 * (lo + hi); // bisection safeguard
    }

    if (hi - lo < tol) {
      return { vol, iterations: iterations + 1, converged: true, residual: Math.abs(fv) };
    }
  }
  return { vol, iterations, converged: false, residual: Math.abs(f(vol)) };
}
