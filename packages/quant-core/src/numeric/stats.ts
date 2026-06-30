/* =============================================================================
 * quant-core / numeric / stats
 * -----------------------------------------------------------------------------
 * Self-contained statistical primitives. No external dependencies — every
 * special function and generator here is implemented from a published numerical
 * recipe so the entire risk stack is reproducible bit-for-bit across machines.
 *
 * Contents
 *   - erf / erfc                 Abramowitz & Stegun 7.1.26 rational approx.
 *   - normPdf / normCdf          standard-normal density & distribution
 *   - normInv                    Acklam's inverse-CDF (≈1.15e-9 abs error)
 *   - Pcg32                      PCG-XSH-RR 64/32 deterministic generator
 *   - gaussianPair               Box–Muller transform over a uniform source
 *   - GaussianStream             pull-based N(0,1) stream with a one-slot cache
 *
 * Note on Φ: `normCdf` uses Graeme West's rational approximation, not the cruder
 * erf path, because option pricing and tail VaR both lean on Φ in the deep tails
 * where the A&S erf (~1.5e-7) is too coarse. West's form is accurate to ~1e-15
 * across the whole real line — effectively double precision — at a handful of
 * flops. `erf`/`erfc` are retained for callers that want them directly.
 * ===========================================================================*/

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const INV_SQRT_2PI = 1 / SQRT_2PI;

/**
 * Gauss error function. Maximum absolute error ≤ 1.5e-7 across all x, which is
 * comfortably below the noise floor of any Monte-Carlo estimate we build on it.
 * Uses the sign-symmetry erf(-x) = -erf(x) so only x ≥ 0 hits the polynomial.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  // A&S 7.1.26
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export const erfc = (x: number): number => 1 - erf(x);

/** Standard-normal probability density φ(x). */
export const normPdf = (x: number): number => INV_SQRT_2PI * Math.exp(-0.5 * x * x);

/**
 * Standard-normal cumulative distribution Φ(x). Graeme West's "Better
 * approximations to cumulative normal functions" (Wilmott, 2009): a 7-term
 * rational form in the body (|x| < 7.07) and a 5-level continued fraction in the
 * tail, accurate to ~1e-15 over the entire real line. Beyond |x| > 37 the result
 * is flat to double precision, so we short-circuit.
 */
export function normCdf(x: number): number {
  const ax = Math.abs(x);
  if (ax > 37) return x > 0 ? 1 : 0;

  const e = Math.exp(-0.5 * ax * ax);
  let c: number;
  if (ax < 7.07106781186547) {
    let num = 3.52624965998911e-2 * ax + 0.700383064443688;
    num = num * ax + 6.37396220353165;
    num = num * ax + 33.912866078383;
    num = num * ax + 112.079291497871;
    num = num * ax + 221.213596169931;
    num = num * ax + 220.206867912376;
    let den = 8.83883476483184e-2 * ax + 1.75566716318264;
    den = den * ax + 16.064177579207;
    den = den * ax + 86.7807322029461;
    den = den * ax + 296.564248779674;
    den = den * ax + 637.333633378831;
    den = den * ax + 793.826512519948;
    den = den * ax + 440.413735824752;
    c = (e * num) / den;
  } else {
    // Continued fraction for the far tail.
    let cf = ax + 0.65;
    cf = ax + 4 / cf;
    cf = ax + 3 / cf;
    cf = ax + 2 / cf;
    cf = ax + 1 / cf;
    c = e / cf / 2.506628274631;
  }
  return x > 0 ? 1 - c : c;
}

/**
 * Inverse standard-normal CDF (a.k.a. probit). Peter Acklam's algorithm:
 * a rational approximation in two tails plus a central region, good to about
 * 1.15e-9 absolute error. We deliberately do NOT add the Halley refinement
 * step — the raw approximation is already finer than our simulation tolerance
 * and the extra erf() call per draw is not worth it in hot Monte-Carlo loops.
 */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/* ---------------------------------------------------------------------------
 * Deterministic PRNG — PCG-XSH-RR 64/32 (O'Neill, 2014).
 *
 * We use a 64-bit LCG state advanced with BigInt (JS numbers cannot hold the
 * full 64-bit multiply) and emit a permuted 32-bit output. This is the smallest
 * generator that simultaneously passes TestU01 BigCrush and supports cheap
 * stream-splitting, which matters when we fan risk simulations across workers
 * and need each shard to draw from an independent, reproducible sub-stream.
 * ------------------------------------------------------------------------- */
const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

export class Pcg32 {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: bigint | number = 0x853c49e6748fea9bn, seq: bigint | number = 0xda3e39cb94b95bdbn) {
    this.inc = ((BigInt(seq) << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.next(); // prime
    this.state = (this.state + BigInt(seed)) & MASK64;
    this.next();
  }

  /** Raw 32-bit unsigned output. */
  next(): number {
    const old = this.state;
    this.state = (old * MULT + this.inc) & MASK64;
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n) & 0xffffffff;
    const rot = Number(old >> 59n) & 31;
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform in [0,1) with 32 bits of entropy. */
  unit(): number {
    return this.next() / 4294967296;
  }

  /** Uniform in the open interval (0,1) — safe to feed to log()/normInv(). */
  unitOpen(): number {
    return (this.next() + 0.5) / 4294967296;
  }

  /** Fork an independent stream; the child's sequence is derived from a draw. */
  split(): Pcg32 {
    return new Pcg32(this.state ^ MULT, BigInt(this.next()) | 1n);
  }
}

/**
 * Box–Muller transform: two independent U(0,1) draws → two independent N(0,1)
 * variates. Returned as a pair so callers that want both avoid recomputing the
 * shared radius/angle. We use the trigonometric (not polar-rejection) form
 * because it has no branch and vectorises cleanly.
 */
export function gaussianPair(u1: number, u2: number): [number, number] {
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Pull-based stream of standard normals over a PCG source. Box–Muller produces
 * variates in pairs, so we cache the second one — a stream consumed an odd
 * number of times wastes at most one draw.
 */
export class GaussianStream {
  private cache: number | null = null;
  constructor(private readonly rng: Pcg32) {}

  draw(): number {
    if (this.cache !== null) {
      const v = this.cache;
      this.cache = null;
      return v;
    }
    const [z0, z1] = gaussianPair(this.rng.unitOpen(), this.rng.unitOpen());
    this.cache = z1;
    return z0;
  }

  /** Fill (and return) an n-vector of i.i.d. standard normals. */
  vector(n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.draw();
    return out;
  }
}

/** Sample mean of a Float64Array. */
export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** Unbiased (n-1) sample standard deviation. */
export function stdev(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Lower-tail empirical quantile via linear interpolation between order
 * statistics (the "type-7" definition used by NumPy/R). Sorts a copy, so the
 * caller's buffer is left untouched.
 */
export function quantile(xs: ArrayLike<number>, q: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const sorted = Array.from(xs).sort((a, b) => a - b);
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[n - 1];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const frac = h - lo;
  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
}
