/* =============================================================================
 * quant-core / pricing / blackscholes
 * -----------------------------------------------------------------------------
 * Generalised Black–Scholes–Merton pricing with a full first- and second-order
 * greek surface. We use the "cost-of-carry" form b so a single implementation
 * covers every instrument AmpliFi's reference strategy touches:
 *
 *     b = r            → Black-Scholes on a non-dividend equity/spot
 *     b = r − q        → continuous dividend yield q
 *     b = 0            → Black-76 on a future/forward (perp options live here)
 *     b = r − r_f      → Garman–Kohlhagen FX
 *
 * Everything is expressed in the carry parameter so the perpetual-options book
 * (forwards, b≈0) and any spot-collateralised legs share one code path. All
 * rates/vols are continuous and annualised; T is in years.
 * ===========================================================================*/

import { normCdf, normPdf } from "../numeric/stats";

export type OptionType = "call" | "put";

export interface BsInputs {
  s: number; // spot (or forward, with b=0)
  k: number; // strike
  t: number; // time to expiry, years
  vol: number; // annualised volatility, σ
  r: number; // risk-free rate, continuous
  b?: number; // cost of carry; defaults to r (no dividend)
  type: OptionType;
}

export interface Greeks {
  price: number;
  delta: number; // ∂V/∂S
  gamma: number; // ∂²V/∂S²
  vega: number; // ∂V/∂σ  (per 1.00 vol, i.e. 100 vol points)
  theta: number; // ∂V/∂t  (per year; divide by 365 for per-day)
  rho: number; // ∂V/∂r  (per 1.00 rate)
  vanna: number; // ∂²V/∂S∂σ — delta's sensitivity to vol; key for skew hedging
  volga: number; // ∂²V/∂σ²  — vega convexity; drives the cost of the smile
}

/** d1, d2 of the BSM model under carry b. Returns NaN-safe values at T→0. */
export function d1d2(s: number, k: number, t: number, vol: number, b: number): [number, number] {
  const sqrtT = Math.sqrt(t);
  const denom = vol * sqrtT;
  if (denom < 1e-12) {
    // Degenerate: collapse to a step. Push d1/d2 to ±∞ based on moneyness.
    const fwd = s * Math.exp(b * t);
    const sign = fwd >= k ? 1 : -1;
    return [sign * Infinity, sign * Infinity];
  }
  const d1 = (Math.log(s / k) + (b + 0.5 * vol * vol) * t) / denom;
  const d2 = d1 - denom;
  return [d1, d2];
}

/**
 * Price + complete greek vector in one pass. Sharing d1/d2/φ(d1) across every
 * sensitivity is ~3× cheaper than calling separate closed forms and keeps the
 * whole surface internally consistent (greeks differentiate exactly the price
 * returned alongside them).
 */
export function priceGreeks(inp: BsInputs): Greeks {
  const { s, k, t, vol, r, type } = inp;
  const b = inp.b ?? r;
  const sign = type === "call" ? 1 : -1;

  // Intrinsic-only boundary at/near expiry — greeks degenerate gracefully.
  if (t <= 0 || vol <= 0) {
    const itm = sign * (s - k) > 0;
    return {
      price: Math.max(sign * (s - k), 0),
      delta: itm ? sign : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      vanna: 0,
      volga: 0,
    };
  }

  const sqrtT = Math.sqrt(t);
  const [d1, d2] = d1d2(s, k, t, vol, b);
  const pdfD1 = normPdf(d1);
  const Nd1 = normCdf(sign * d1);
  const Nd2 = normCdf(sign * d2);

  const carryDisc = Math.exp((b - r) * t); // e^{(b−r)T}
  const rDisc = Math.exp(-r * t);

  const price = sign * (s * carryDisc * Nd1 - k * rDisc * Nd2);
  const delta = sign * carryDisc * Nd1;
  const gamma = (carryDisc * pdfD1) / (s * vol * sqrtT);
  const vega = s * carryDisc * pdfD1 * sqrtT;

  // Theta in calendar terms: −∂V/∂t. The three-term form covers carry drift,
  // the time-value decay, and the discounting of the strike leg.
  const theta =
    -(s * carryDisc * pdfD1 * vol) / (2 * sqrtT) - sign * (b - r) * s * carryDisc * Nd1 - sign * r * k * rDisc * Nd2;

  const rho = sign * k * t * rDisc * Nd2;

  // Second-order: vanna and volga share φ(d1) with vega.
  const vanna = -carryDisc * pdfD1 * (d2 / vol);
  const volga = (vega * d1 * d2) / vol;

  return { price, delta, gamma, vega, theta, rho, vanna, volga };
}

/** Convenience: price only (skips the greek algebra). */
export function price(inp: BsInputs): number {
  return priceGreeks(inp).price;
}

/**
 * Put–call parity residual under carry b:
 *     C − P = S·e^{(b−r)T} − K·e^{−rT}
 * Returned as (lhs − rhs); a correct implementation drives this to ≈0 and the
 * test harness asserts exactly that.
 */
export function parityResidual(s: number, k: number, t: number, vol: number, r: number, b = r): number {
  const c = price({ s, k, t, vol, r, b, type: "call" });
  const p = price({ s, k, t, vol, r, b, type: "put" });
  const rhs = s * Math.exp((b - r) * t) - k * Math.exp(-r * t);
  return c - p - rhs;
}
