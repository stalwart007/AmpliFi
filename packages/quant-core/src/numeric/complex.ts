/* =============================================================================
 * quant-core / numeric / complex
 * -----------------------------------------------------------------------------
 * Minimal complex arithmetic — just enough for characteristic-function pricers
 * (Heston, and any future Lévy model). Values are plain {re, im} records; the
 * functions are pure. Principal branches are used for sqrt and log, which is the
 * correct choice for the "Little Trap" Heston formulation that avoids the branch
 * discontinuities of the original 1993 parameterisation.
 * ===========================================================================*/

export interface Complex {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });

export const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

export const cScale = (s: number, a: Complex): Complex => ({ re: s * a.re, im: s * a.im });

/** e^z = e^{re}(cos im + i sin im). */
export function cExp(a: Complex): Complex {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
}

export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cArg = (a: Complex): number => Math.atan2(a.im, a.re);

/** Principal square root. */
export function cSqrt(a: Complex): Complex {
  const r = cAbs(a);
  const re = Math.sqrt((r + a.re) / 2);
  let im = Math.sqrt((r - a.re) / 2);
  if (a.im < 0) im = -im;
  return { re, im };
}

/** Principal natural log: ln|z| + i·arg(z), arg ∈ (−π, π]. */
export function cLog(a: Complex): Complex {
  return { re: Math.log(cAbs(a)), im: cArg(a) };
}
