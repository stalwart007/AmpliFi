/* =============================================================================
 * quant-core / pricing / exotics
 * -----------------------------------------------------------------------------
 * Closed-form exotic options under the cost-of-carry Black–Scholes model, plus a
 * model-free variance-swap fair strike by static replication. Each has a clean,
 * implementation-independent verification:
 *
 *   - geometric Asian (Kemna–Vorst): exact; < vanilla; matches MC of the average
 *   - digitals (cash/asset-or-nothing): vanilla = assetON − K·cashON (exact)
 *   - variance swap (Demeterfi replication): flat smile ⇒ fair vol ≈ σ
 *
 * (A floating-strike lookback closed form is deferred until it can be checked
 * against a published reference — the in-house MC did not corroborate the first
 * formula transcription, so it is intentionally not shipped here.)
 * ===========================================================================*/

import { price as bsPrice, d1d2, type OptionType } from "./blackscholes";
import { normCdf } from "../numeric/stats";

/* ----------------------------------- Asian ------------------------------- */

/**
 * Continuous geometric-average Asian option. The geometric average of a GBM is
 * itself lognormal, so the price is Black–Scholes with a reduced volatility
 * σ/√3 and an adjusted carry ½(b − σ²/6) (Kemna–Vorst, 1990).
 */
export function geometricAsian(
  s: number,
  k: number,
  t: number,
  vol: number,
  r: number,
  b: number,
  type: OptionType,
): number {
  const volA = vol / Math.sqrt(3);
  const bA = 0.5 * (b - (vol * vol) / 6);
  return bsPrice({ s, k, t, vol: volA, r, b: bA, type });
}

/* --------------------------------- Digitals ------------------------------ */

/** Cash-or-nothing: pays 1 unit of cash if in-the-money at expiry. */
export function digitalCashOrNothing(
  s: number,
  k: number,
  t: number,
  vol: number,
  r: number,
  b: number,
  type: OptionType,
): number {
  const [, d2] = d1d2(s, k, t, vol, b);
  const sign = type === "call" ? 1 : -1;
  return Math.exp(-r * t) * normCdf(sign * d2);
}

/** Asset-or-nothing: pays one unit of the asset if in-the-money at expiry. */
export function digitalAssetOrNothing(
  s: number,
  k: number,
  t: number,
  vol: number,
  r: number,
  b: number,
  type: OptionType,
): number {
  const [d1] = d1d2(s, k, t, vol, b);
  const sign = type === "call" ? 1 : -1;
  return s * Math.exp((b - r) * t) * normCdf(sign * d1);
}

/* ----------------------------- Variance swap ----------------------------- */

/**
 * Fair variance of a variance swap by Demeterfi–Derman–Kamal–Zou (1999) static
 * replication across a strip of OTM options. `volSmile(K)` supplies the implied
 * vol at each strike (a flat smile must return the realised-variance level back,
 * which the test asserts). Returns the fair *variance* (σ²); take √ for vol.
 */
export function varianceSwapFairVariance(
  s0: number,
  r: number,
  q: number,
  t: number,
  volSmile: (k: number) => number,
  opts: { kMinFrac?: number; kMaxFrac?: number; nodes?: number } = {},
): number {
  const fwd = s0 * Math.exp((r - q) * t);
  const sb = fwd; // boundary between puts (below) and calls (above)
  const kMin = (opts.kMinFrac ?? 0.1) * s0;
  const kMax = (opts.kMaxFrac ?? 3) * s0;
  const n = opts.nodes ?? 4000;
  const dK = (kMax - kMin) / n;

  let integral = 0;
  for (let i = 0; i < n; i++) {
    const k = kMin + (i + 0.5) * dK;
    const vol = volSmile(k);
    const type: OptionType = k <= sb ? "put" : "call";
    const px = bsPrice({ s: s0, k, t, vol, r, b: r - q, type });
    integral += (px / (k * k)) * dK;
  }

  const boundaryTerm = (2 / t) * (r * t - ((s0 / sb) * Math.exp(r * t) - 1) - Math.log(sb / s0));
  return boundaryTerm + Math.exp(r * t) * (2 / t) * integral;
}
