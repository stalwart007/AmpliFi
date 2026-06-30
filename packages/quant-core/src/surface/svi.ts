/* =============================================================================
 * quant-core / surface / svi
 * -----------------------------------------------------------------------------
 * Gatheral's "raw" SVI (Stochastic Volatility Inspired) parameterisation of a
 * single expiry's implied-variance smile, plus a thin term-structure container
 * that stitches per-expiry slices into a full surface.
 *
 * For one expiry the total implied variance w(k) = σ²(k)·T as a function of
 * log-moneyness k = ln(K/F) is:
 *
 *     w(k) = a + b · ( ρ (k − m) + √((k − m)² + ζ²) )
 *
 * Five parameters with direct trader meaning:
 *     a   vertical level (overall variance floor)
 *     b   angle between the two asymptotic wings (≥ 0)
 *     ρ   wing asymmetry / skew, ρ ∈ (−1, 1)
 *     m   horizontal shift of the smile's minimum
 *     ζ   curvature of the ATM region (σ in Gatheral's notation; renamed to
 *         avoid clashing with volatility σ everywhere else in this codebase)
 *
 * Implied volatility for a slice is then σ(k) = √(w(k)/T).
 *
 * We deliberately implement raw SVI (not natural or jump-wing) because its
 * no-arbitrage conditions are the cleanest to state and check, and a calibrated
 * raw slice converts losslessly to the other forms if a consumer needs them.
 * ===========================================================================*/

import { fromRows, solveSPD } from "../numeric/linalg";

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  zeta: number; // curvature (Gatheral's σ)
}

/** Total implied variance w(k) for a raw-SVI slice. */
export function sviTotalVariance(p: SviParams, k: number): number {
  const dk = k - p.m;
  return p.a + p.b * (p.rho * dk + Math.sqrt(dk * dk + p.zeta * p.zeta));
}

/** Implied volatility σ(k) = √(w/T) for the slice at expiry T. */
export function sviVol(p: SviParams, k: number, t: number): number {
  const w = sviTotalVariance(p, k);
  return Math.sqrt(Math.max(w, 0) / t);
}

/**
 * Necessary static no-arbitrage conditions for a raw-SVI slice (Gatheral &
 * Jacquier, 2014):
 *   - b ≥ 0
 *   - |ρ| < 1
 *   - a + b·ζ·√(1−ρ²) ≥ 0   (the minimum of w is non-negative)
 *   - b·(1+|ρ|) ≤ 4/T-ish wing slope bound (butterfly-arb guard, here as a
 *     conservative slope check so calibration cannot hand us a negative density)
 * These are *necessary* conditions; full butterfly/calendar arbitrage freedom
 * needs the density check, which we expose separately as `localDensityOk`.
 */
export function sliceNoArbViolations(p: SviParams, t: number): string[] {
  const errs: string[] = [];
  if (p.b < 0) errs.push(`b<0 (${p.b})`);
  if (Math.abs(p.rho) >= 1) errs.push(`|rho|>=1 (${p.rho})`);
  const wMin = p.a + p.b * p.zeta * Math.sqrt(1 - p.rho * p.rho);
  if (wMin < 0) errs.push(`min total variance < 0 (${wMin.toFixed(6)})`);
  const wingSlope = p.b * (1 + Math.abs(p.rho));
  if (wingSlope * t > 4) errs.push(`wing slope ${(wingSlope * t).toFixed(3)} > 4 (butterfly risk)`);
  return errs;
}

/**
 * Gatheral's g(k) — proportional to the risk-neutral density implied by the
 * smile. g(k) ≥ 0 everywhere ⇔ the slice is butterfly-arbitrage-free. We sample
 * it on a moneyness grid; a single negative sample flags a bad calibration.
 */
export function localDensityOk(p: SviParams, kLo = -1.5, kHi = 1.5, steps = 60): boolean {
  const h = 1e-4;
  for (let i = 0; i <= steps; i++) {
    const k = kLo + ((kHi - kLo) * i) / steps;
    const w = sviTotalVariance(p, k);
    if (w <= 0) return false;
    const wp = (sviTotalVariance(p, k + h) - sviTotalVariance(p, k - h)) / (2 * h);
    const wpp = (sviTotalVariance(p, k + h) - 2 * w + sviTotalVariance(p, k - h)) / (h * h);
    // g(k) = (1 − k w'/(2w))² − (w'/2)²(1/w + 1/4) + w''/2
    const term1 = (1 - (k * wp) / (2 * w)) ** 2;
    const term2 = ((wp * wp) / 4) * (1 / w + 0.25);
    const g = term1 - term2 + wpp / 2;
    if (g < -1e-9) return false;
  }
  return true;
}

export interface SurfaceSlice {
  expiry: number; // T in years
  params: SviParams;
}

/**
 * A full implied-vol surface: a set of calibrated SVI slices ordered by expiry,
 * with linear interpolation in *total variance* across the term structure
 * (interpolating variance, not vol, is what keeps the surface calendar-arbitrage
 * sane — total variance must be non-decreasing in T at fixed moneyness).
 */
export class VolSurface {
  private slices: SurfaceSlice[];

  constructor(slices: SurfaceSlice[]) {
    this.slices = [...slices].sort((x, y) => x.expiry - y.expiry);
    if (this.slices.length === 0) throw new Error("VolSurface needs ≥1 slice");
  }

  /** Implied volatility at log-moneyness k and arbitrary expiry T (interpolated). */
  vol(k: number, t: number): number {
    const s = this.slices;
    if (t <= s[0].expiry) return sviVol(s[0].params, k, s[0].expiry);
    if (t >= s[s.length - 1].expiry) {
      const last = s[s.length - 1];
      return sviVol(last.params, k, last.expiry);
    }
    // Find the bracketing slices and interpolate total variance linearly in T.
    let i = 0;
    while (i < s.length - 1 && s[i + 1].expiry < t) i++;
    const lo = s[i];
    const hi = s[i + 1];
    const wLo = sviTotalVariance(lo.params, k);
    const wHi = sviTotalVariance(hi.params, k);
    const frac = (t - lo.expiry) / (hi.expiry - lo.expiry);
    const w = wLo + frac * (wHi - wLo);
    return Math.sqrt(Math.max(w, 0) / t);
  }

  /** Validate every slice; returns a per-expiry report of any violations. */
  audit(): { expiry: number; violations: string[]; densityOk: boolean }[] {
    return this.slices.map((sl) => ({
      expiry: sl.expiry,
      violations: sliceNoArbViolations(sl.params, sl.expiry),
      densityOk: localDensityOk(sl.params),
    }));
  }

  /** Calendar-arbitrage check: total variance must be monotone non-decreasing in T. */
  calendarOk(kGrid = [-1, -0.5, 0, 0.5, 1]): boolean {
    for (const k of kGrid) {
      for (let i = 1; i < this.slices.length; i++) {
        const wPrev = sviTotalVariance(this.slices[i - 1].params, k);
        const wCur = sviTotalVariance(this.slices[i].params, k);
        if (wCur < wPrev - 1e-9) return false;
      }
    }
    return true;
  }
}

/**
 * Lightweight least-squares calibration of a single slice to observed
 * (logMoneyness, totalVariance) points via coordinate-descent on the three
 * nonlinear parameters (m, ζ, ρ) with a closed-form linear solve for (a, b)
 * at each step. This is intentionally a compact, dependency-free fitter — good
 * enough to seed a slice from market quotes; a production calibrator would hand
 * the residual to a proper Levenberg–Marquardt routine, which slots in here
 * behind the same signature.
 */
export function calibrateSlice(ks: number[], totalVars: number[], init?: Partial<SviParams>, iters = 200): SviParams {
  let p: SviParams = {
    a: init?.a ?? Math.min(...totalVars) * 0.9,
    b: init?.b ?? 0.1,
    rho: init?.rho ?? -0.3,
    m: init?.m ?? 0,
    zeta: init?.zeta ?? 0.1,
  };
  const sse = (q: SviParams): number => {
    let s = 0;
    for (let i = 0; i < ks.length; i++) {
      const d = sviTotalVariance(q, ks[i]) - totalVars[i];
      s += d * d;
    }
    return s;
  };
  let step = 0.25;
  let best = sse(p);
  for (let it = 0; it < iters; it++) {
    let improved = false;
    const keys: (keyof SviParams)[] = ["a", "b", "rho", "m", "zeta"];
    for (const key of keys) {
      for (const dir of [1, -1]) {
        const trial: SviParams = { ...p, [key]: p[key] + dir * step };
        if (key === "rho") trial.rho = Math.max(-0.999, Math.min(0.999, trial.rho));
        if (key === "b") trial.b = Math.max(0, trial.b);
        if (key === "zeta") trial.zeta = Math.max(1e-4, trial.zeta);
        const e = sse(trial);
        if (e < best) {
          best = e;
          p = trial;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
    if (step < 1e-6) break;
  }
  return p;
}

/**
 * Levenberg–Marquardt calibration of a SVI slice — a damped Gauss–Newton fit
 * that interpolates between gradient descent (large λ, robust) and Newton (small
 * λ, fast quadratic convergence). At each step it solves the normal equations
 *     (JᵀJ + λ·diag(JᵀJ)) δ = −Jᵀr
 * (SPD ⇒ Cholesky solve) and accepts the step only if the SSE drops, shrinking λ
 * on success and growing it on failure. This converges far tighter than the
 * compact coordinate-descent fitter and is the production calibrator. Parameter
 * constraints (b ≥ 0, |ρ| < 1, ζ > 0) are enforced by projection after each step.
 */
export function calibrateSliceLM(ks: number[], totalVars: number[], init?: Partial<SviParams>, iters = 200): SviParams {
  const keys: (keyof SviParams)[] = ["a", "b", "rho", "m", "zeta"];
  const clamp = (q: SviParams): SviParams => ({
    a: q.a,
    b: Math.max(q.b, 1e-6),
    rho: Math.max(-0.999, Math.min(0.999, q.rho)),
    m: q.m,
    zeta: Math.max(q.zeta, 1e-4),
  });
  let p = clamp({
    a: init?.a ?? Math.min(...totalVars) * 0.5,
    b: init?.b ?? 0.1,
    rho: init?.rho ?? -0.3,
    m: init?.m ?? 0,
    zeta: init?.zeta ?? 0.1,
  });
  const m = ks.length;
  const resid = (q: SviParams): number[] => ks.map((k, i) => sviTotalVariance(q, k) - totalVars[i]);
  const sse = (q: SviParams): number => resid(q).reduce((s, r) => s + r * r, 0);

  let lambda = 1e-2;
  let cur = sse(p);
  for (let it = 0; it < iters; it++) {
    const r = resid(p);
    // Numerical Jacobian J (m × 5).
    const J: number[][] = Array.from({ length: m }, () => new Array(5).fill(0));
    for (let j = 0; j < 5; j++) {
      const key = keys[j];
      const step = Math.max(Math.abs(p[key]) * 1e-6, 1e-8);
      const pj: SviParams = { ...p, [key]: p[key] + step };
      const rp = resid(pj);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / step;
    }
    // JᵀJ (5×5) and Jᵀr (5).
    const JtJ: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
    const Jtr = new Array(5).fill(0);
    for (let a = 0; a < 5; a++) {
      for (let b = 0; b < 5; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
        JtJ[a][b] = s;
      }
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i][a] * r[i];
      Jtr[a] = s;
    }
    const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)));
    let delta: Float64Array;
    try {
      delta = solveSPD(
        fromRows(A),
        Jtr.map((x) => -x),
      );
    } catch {
      lambda = Math.min(lambda * 5, 1e8);
      continue;
    }
    const trial = clamp({
      a: p.a + delta[0],
      b: p.b + delta[1],
      rho: p.rho + delta[2],
      m: p.m + delta[3],
      zeta: p.zeta + delta[4],
    });
    const trialSse = sse(trial);
    if (trialSse < cur) {
      p = trial;
      cur = trialSse;
      lambda = Math.max(lambda * 0.5, 1e-10);
    } else {
      lambda = Math.min(lambda * 5, 1e8);
    }
    if (cur < 1e-16) break;
  }
  return p;
}
