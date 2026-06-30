/* =============================================================================
 * quant-core / portfolio / greeks
 * -----------------------------------------------------------------------------
 * Aggregate a book of option legs into portfolio-level greeks and a mark.
 *
 * This is the bridge between the per-instrument pricing layer and the
 * strategy/risk layers: AmpliFi's reference book is a basket of LONG calls
 * across many underlyings, so "the portfolio" is really a list of legs each
 * tied to its own spot, strike, expiry and the surface-implied vol at that
 * point. Net delta/gamma/vega/theta drive the rebalancing and risk logic that
 * the on-chain ExposureManager / RiskController are meant to enforce.
 *
 * Dollar greeks: per-underlying delta is unitless (∂V/∂S); the dollar exposure
 * to a 1% move is delta·S·0.01·qty. We report both so a caller can reason about
 * notional ("how much spot am I really long?") and P&L ("what does a 1% tape do
 * to my mark?") without re-deriving the conversions.
 * ===========================================================================*/

import { priceGreeks, Greeks, OptionType } from "../pricing/blackscholes";

export interface Leg {
  underlying: string;
  type: OptionType;
  s: number;
  k: number;
  t: number;
  vol: number;
  r: number;
  b?: number;
  qty: number; // signed contracts: + long, − short
  multiplier?: number; // contract size; default 1
}

export interface PortfolioGreeks {
  mark: number; // present value of the book
  delta: number; // Σ qty·mult·∂V/∂S      (per-underlying, summed)
  gamma: number;
  vega: number; // Σ qty·mult·∂V/∂σ
  theta: number; // Σ qty·mult·∂V/∂t  (per year)
  rho: number;
  dollarDelta: number; // Σ delta·S      — spot-equivalent notional
  dollarGamma: number; // Σ gamma·S²·0.01 — P&L curvature per 1% move
  vannaSum: number;
  volgaSum: number;
  perLeg: Array<{ leg: Leg; greeks: Greeks }>;
}

export function aggregate(legs: Leg[]): PortfolioGreeks {
  let mark = 0,
    delta = 0,
    gamma = 0,
    vega = 0,
    theta = 0,
    rho = 0,
    dollarDelta = 0,
    dollarGamma = 0,
    vannaSum = 0,
    volgaSum = 0;
  const perLeg: PortfolioGreeks["perLeg"] = [];

  for (const leg of legs) {
    const mult = leg.multiplier ?? 1;
    const q = leg.qty * mult;
    const g = priceGreeks({
      s: leg.s,
      k: leg.k,
      t: leg.t,
      vol: leg.vol,
      r: leg.r,
      b: leg.b ?? leg.r,
      type: leg.type,
    });
    mark += q * g.price;
    delta += q * g.delta;
    gamma += q * g.gamma;
    vega += q * g.vega;
    theta += q * g.theta;
    rho += q * g.rho;
    dollarDelta += q * g.delta * leg.s;
    dollarGamma += q * g.gamma * leg.s * leg.s * 0.01;
    vannaSum += q * g.vanna;
    volgaSum += q * g.volga;
    perLeg.push({ leg, greeks: g });
  }
  return { mark, delta, gamma, vega, theta, rho, dollarDelta, dollarGamma, vannaSum, volgaSum, perLeg };
}

/**
 * Net delta as a fraction of a target notional — the quantity the reference
 * strategy bands around (DELTA_TARGET / DELTA_BAND in the sim engine). Returns
 * the signed drift so a keeper can decide whether a re-hedge roll is due.
 */
export function deltaDrift(book: PortfolioGreeks, targetNotional: number, deltaTarget: number): number {
  if (targetNotional <= 0) return 0;
  const realised = book.dollarDelta / targetNotional;
  return realised - deltaTarget;
}
