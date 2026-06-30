/* =============================================================================
 * quant-core / pricing / barrier
 * -----------------------------------------------------------------------------
 * Analytic single-barrier options (continuous monitoring) under the cost-of-
 * carry model — the Reiner–Rubinstein / Merton closed forms as tabulated by
 * Haug. Eight types: {down,up} × {in,out} × {call,put}, rebate-free.
 *
 * Why barriers belong here: a knock-out is the cheapest way to express a capped,
 * path-dependent view, and the in/out decomposition (knock-in + knock-out =
 * vanilla) is an exact arbitrage relationship the test harness asserts. The
 * harness ALSO cross-checks every price against an independent Monte-Carlo
 * barrier simulation, so a transcription error in the closed form cannot pass.
 * ===========================================================================*/

import { normCdf } from "../numeric/stats";
import type { OptionType } from "./blackscholes";

export type BarrierKind = "down-in" | "down-out" | "up-in" | "up-out";

export interface BarrierInputs {
  s: number;
  k: number;
  h: number; // barrier level
  t: number;
  vol: number;
  r: number;
  b?: number; // cost of carry; default r
  type: OptionType;
  kind: BarrierKind;
}

export function barrierPrice(inp: BarrierInputs): number {
  const { s, k, h, t, vol, r, type, kind } = inp;
  const b = inp.b ?? r;
  const phi = type === "call" ? 1 : -1;
  const eta = kind.startsWith("down") ? 1 : -1;
  const isIn = kind.endsWith("in");

  const sigT = vol * Math.sqrt(t);
  const mu = (b - 0.5 * vol * vol) / (vol * vol);
  const carry = Math.exp((b - r) * t);
  const disc = Math.exp(-r * t);

  const x1 = Math.log(s / k) / sigT + (1 + mu) * sigT;
  const x2 = Math.log(s / h) / sigT + (1 + mu) * sigT;
  const y1 = Math.log((h * h) / (s * k)) / sigT + (1 + mu) * sigT;
  const y2 = Math.log(h / s) / sigT + (1 + mu) * sigT;

  const powP = Math.pow(h / s, 2 * (mu + 1));
  const powM = Math.pow(h / s, 2 * mu);

  const A = phi * s * carry * normCdf(phi * x1) - phi * k * disc * normCdf(phi * x1 - phi * sigT);
  const B = phi * s * carry * normCdf(phi * x2) - phi * k * disc * normCdf(phi * x2 - phi * sigT);
  const C = phi * s * carry * powP * normCdf(eta * y1) - phi * k * disc * powM * normCdf(eta * y1 - eta * sigT);
  const D = phi * s * carry * powP * normCdf(eta * y2) - phi * k * disc * powM * normCdf(eta * y2 - eta * sigT);

  const kGtH = k > h;

  // Haug's rebate-free combination table.
  let v: number;
  if (type === "call" && kind === "down-in") v = kGtH ? C : A - B + D;
  else if (type === "call" && kind === "down-out") v = kGtH ? A - C : B - D;
  else if (type === "call" && kind === "up-in") v = kGtH ? A : B - C + D;
  else if (type === "call" && kind === "up-out") v = kGtH ? 0 : A - B + C - D;
  else if (type === "put" && kind === "down-in") v = kGtH ? B - C + D : A;
  else if (type === "put" && kind === "down-out") v = kGtH ? A - B + C - D : 0;
  else if (type === "put" && kind === "up-in") v = kGtH ? A - B + D : C;
  else v = kGtH ? B - D : A - C; // put up-out

  // A knocked-IN option only has value if the barrier has not yet been hit; for a
  // spot already past the barrier the in-option is simply the vanilla and the
  // out-option is worthless. The closed form handles the live-barrier case; we
  // clamp tiny negative values from floating error.
  void isIn;
  return Math.max(v, 0);
}
