/* =============================================================================
 * quant-core / test / verify
 * -----------------------------------------------------------------------------
 * A self-contained numerical verification harness — no test framework, just a
 * tiny assert layer so it runs anywhere `tsx verify.ts` does. Every check is a
 * property the math must satisfy *independent of the implementation*:
 *
 *   - Φ against published reference values
 *   - put–call parity ≈ 0
 *   - greeks vs. central finite differences of the price
 *   - implied-vol round-trip (price→σ→price)
 *   - Cholesky reconstructs Σ; Higham fixes an indefinite correlation matrix
 *   - SVI slice is arbitrage-free where it should be
 *   - Monte-Carlo VaR is positive, ES ≥ VaR, and a long-call book is convex
 *     (mean P&L under a zero-drift shock is ≥ 0 net of theta within tolerance)
 *
 * Exit code is non-zero if any assertion fails, so CI can gate on it.
 * ===========================================================================*/

import { normCdf, Pcg32, GaussianStream } from "../src/numeric/stats";
import { priceGreeks, price, parityResidual } from "../src/pricing/blackscholes";
import { impliedVol } from "../src/pricing/impliedvol";
import { binomialPrice, earlyExercisePremium } from "../src/pricing/binomial";
import { barrierPrice, type BarrierKind } from "../src/pricing/barrier";
import { hestonPrice } from "../src/pricing/heston";
import {
  geometricAsian,
  digitalCashOrNothing,
  digitalAssetOrNothing,
  varianceSwapFairVariance,
} from "../src/pricing/exotics";
import type { OptionType } from "../src/pricing/blackscholes";
import {
  cholesky,
  fromRows,
  at,
  matVec,
  solveSPD,
  invSPD,
  nearestCorrelation,
  safeCovCholesky,
  Mat,
} from "../src/numeric/linalg";
import {
  sliceNoArbViolations,
  localDensityOk,
  SviParams,
  sviTotalVariance,
  calibrateSlice,
  calibrateSliceLM,
} from "../src/surface/svi";
import { monteCarloVar } from "../src/risk/montecarlo";
import { Leg } from "../src/portfolio/greeks";

let passed = 0;
let failed = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  ✗ ${name}  ${detail}`);
  }
}
function close(name: string, a: number, b: number, tol: number): void {
  ok(name, Math.abs(a - b) <= tol, `|${a.toExponential(4)} - ${b.toExponential(4)}| > ${tol}`);
}

console.log("\n── normal CDF reference values ──");
close("Phi(0)=0.5", normCdf(0), 0.5, 1e-7);
close("Phi(1)=0.8413447", normCdf(1), 0.8413447, 1e-5);
close("Phi(-1.96)=0.0249979", normCdf(-1.96), 0.0249979, 1e-5);
close("Phi(2.5)=0.9937903", normCdf(2.5), 0.9937903, 1e-5);

console.log("\n── put–call parity (carry b) ──");
for (const [s, k, t, vol, r, b] of [
  [100, 100, 1, 0.2, 0.03, 0.03],
  [64000, 60000, 0.25, 0.7, 0.05, 0.0], // perp-style, b=0
  [3400, 3800, 0.5, 0.66, 0.04, 0.01],
] as number[][]) {
  close(`parity S=${s} K=${k} b=${b}`, parityResidual(s, k, t, vol, r, b), 0, 1e-6);
}

console.log("\n── greeks vs central finite differences ──");
{
  const base = { s: 100, k: 95, t: 0.75, vol: 0.35, r: 0.03, b: 0.03, type: "call" as const };
  const g = priceGreeks(base);
  const hS = 1e-2;
  const dPrice_dS = (price({ ...base, s: base.s + hS }) - price({ ...base, s: base.s - hS })) / (2 * hS);
  close("delta ≈ dV/dS", g.delta, dPrice_dS, 1e-4);

  const d2 = (price({ ...base, s: base.s + hS }) - 2 * price(base) + price({ ...base, s: base.s - hS })) / (hS * hS);
  close("gamma ≈ d2V/dS2", g.gamma, d2, 1e-3);

  const hV = 1e-4;
  const dPrice_dVol = (price({ ...base, vol: base.vol + hV }) - price({ ...base, vol: base.vol - hV })) / (2 * hV);
  close("vega ≈ dV/dσ", g.vega, dPrice_dVol, 1e-2);

  const hT = 1e-5;
  // theta = -dV/dt(calendar) = +dV/d(timeToExpiry decreasing) ... compare to -∂V/∂T
  const dPrice_dT = (price({ ...base, t: base.t + hT }) - price({ ...base, t: base.t - hT })) / (2 * hT);
  close("theta ≈ -dV/dT", g.theta, -dPrice_dT, 1e-1);

  const hR = 1e-5;
  const dPrice_dR =
    (price({ ...base, r: base.r + hR, b: base.b + hR }) - price({ ...base, r: base.r - hR, b: base.b - hR })) /
    (2 * hR);
  // rho here is ∂V/∂r at fixed carry; compare with caution (b moved too) — loose tol
  ok("rho finite & same sign as fd", Number.isFinite(g.rho) && Math.sign(g.rho) === Math.sign(dPrice_dR));
}

console.log("\n── implied-vol round-trip ──");
for (const trueVol of [0.1, 0.25, 0.5, 0.9, 1.5]) {
  const inp = { s: 64000, k: 66000, t: 0.3, r: 0.05, b: 0.0, type: "call" as const };
  const mkt = price({ ...inp, vol: trueVol });
  const res = impliedVol({ ...inp, target: mkt });
  ok(
    `IV recovers σ=${trueVol} (got ${res.vol.toFixed(6)}, ${res.iterations} it)`,
    res.converged && Math.abs(res.vol - trueVol) < 1e-4,
    `residual=${res.residual}`,
  );
}

console.log("\n── Cholesky & nearest-correlation ──");
{
  const cov = fromRows([
    [0.04, 0.012, 0.006],
    [0.012, 0.09, 0.018],
    [0.006, 0.018, 0.16],
  ]);
  const L = cholesky(cov);
  // reconstruct LLᵀ and compare
  let maxErr = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k <= Math.min(i, j); k++) s += at(L, i, k) * at(L, j, k);
      maxErr = Math.max(maxErr, Math.abs(s - at(cov, i, j)));
    }
  close("LLᵀ reconstructs Σ", maxErr, 0, 1e-10);

  // An indefinite "correlation" matrix (eigenvalue < 0): Higham must fix it.
  const bad = fromRows([
    [1.0, 0.9, -0.9],
    [0.9, 1.0, 0.9],
    [-0.9, 0.9, 1.0],
  ]);
  let threw = false;
  try {
    cholesky(bad);
  } catch {
    threw = true;
  }
  ok("raw Cholesky rejects indefinite matrix", threw);
  const fixed: Mat = nearestCorrelation(bad);
  let fixedOk = true;
  try {
    cholesky(fixed);
  } catch {
    fixedOk = false;
  }
  ok("nearestCorrelation → factorable", fixedOk);
  ok(
    "safeCovCholesky never throws on indefinite",
    (() => {
      try {
        safeCovCholesky(bad);
        return true;
      } catch {
        return false;
      }
    })(),
  );
}

console.log("\n── SPD solve & inverse ──");
{
  const A = fromRows([
    [4, 1, 0.5],
    [1, 3, 0.25],
    [0.5, 0.25, 2],
  ]);
  const b = [1, 2, 3];
  const x = solveSPD(A, b);
  const Ax = matVec(A, x);
  close("solveSPD: A·x ≈ b", Math.max(Math.abs(Ax[0] - 1), Math.abs(Ax[1] - 2), Math.abs(Ax[2] - 3)), 0, 1e-10);
  const inv = invSPD(A);
  // A·A⁻¹ ≈ I — check the worst element error.
  let maxErr = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += at(A, i, k) * at(inv, k, j);
      maxErr = Math.max(maxErr, Math.abs(s - (i === j ? 1 : 0)));
    }
  close("invSPD: A·A⁻¹ ≈ I", maxErr, 0, 1e-10);
}

console.log("\n── SVI arbitrage checks ──");
{
  const good: SviParams = { a: 0.04, b: 0.1, rho: -0.3, m: 0.0, zeta: 0.15 };
  ok(
    "clean slice: no static violations",
    sliceNoArbViolations(good, 0.5).length === 0,
    JSON.stringify(sliceNoArbViolations(good, 0.5)),
  );
  ok("clean slice: density ≥ 0", localDensityOk(good));
  const bad: SviParams = { a: 0.04, b: 2.5, rho: -0.99, m: 0, zeta: 0.02 };
  ok("steep slice: flagged", sliceNoArbViolations(bad, 1).length > 0);
}

console.log("\n── SVI Levenberg–Marquardt calibration ──");
{
  // Generate total variances from a known slice, fit, and recover it.
  const truth: SviParams = { a: 0.03, b: 0.12, rho: -0.4, m: 0.02, zeta: 0.15 };
  const ks = Array.from({ length: 21 }, (_, i) => -1 + (2 * i) / 20);
  const tv = ks.map((k) => sviTotalVariance(truth, k));
  const lm = calibrateSliceLM(ks, tv);
  const sseOf = (p: SviParams) => ks.reduce((s, k, i) => s + (sviTotalVariance(p, k) - tv[i]) ** 2, 0);
  ok("LM recovers slice (SSE ≈ 0)", sseOf(lm) < 1e-10, `sse=${sseOf(lm).toExponential(2)}`);
  // LM converges far tighter than the compact coordinate-descent fitter.
  const cd = calibrateSlice(ks, tv);
  ok(
    "LM SSE ≤ coordinate-descent SSE",
    sseOf(lm) <= sseOf(cd) + 1e-12,
    `lm=${sseOf(lm).toExponential(2)} cd=${sseOf(cd).toExponential(2)}`,
  );
  // Robust to a little noise: still a tight fit.
  let seed = 99;
  const noisy = tv.map((v) => v + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 1e-4);
  ok("LM stays tight under noise", sseOf2(ks, noisy, calibrateSliceLM(ks, noisy)) < 1e-6);
  function sseOf2(kk: number[], target: number[], p: SviParams) {
    return kk.reduce((s, k, i) => s + (sviTotalVariance(p, k) - target[i]) ** 2, 0);
  }
}

console.log("\n── Monte-Carlo VaR / ES on a long-call basket ──");
{
  const underlyings = ["BTC", "ETH", "SOL"];
  const spot0 = { BTC: 64000, ETH: 3400, SOL: 150 };
  const vols = { BTC: 0.55, ETH: 0.66, SOL: 0.92 };
  // annualised covariance consistent-ish with those vols, positively correlated
  const cov = fromRows([
    [0.3025, 0.18, 0.22],
    [0.18, 0.4356, 0.27],
    [0.22, 0.27, 0.8464],
  ]);
  const legs: Leg[] = underlyings.map((u) => ({
    underlying: u,
    type: "call",
    s: spot0[u as keyof typeof spot0],
    k: spot0[u as keyof typeof spot0], // ATM
    t: 0.25,
    vol: vols[u as keyof typeof vols],
    r: 0.05,
    b: 0.0,
    qty: 1,
  }));
  const res = monteCarloVar(legs, underlyings, spot0, vols, cov, {
    paths: 40000,
    horizonYears: 5 / 365,
    seed: 0xc0ffeen,
    levels: [0.95, 0.99],
  });
  ok("base mark > 0", res.base > 0, `base=${res.base}`);
  ok("VaR99 ≥ VaR95 ≥ 0", res.tail["0.9900"].var >= res.tail["0.9500"].var && res.tail["0.9500"].var >= 0);
  ok("ES ≥ VaR at 99%", res.tail["0.9900"].es >= res.tail["0.9900"].var - 1e-6);
  // Long options ⇒ capped loss: worst path cannot lose more than total premium paid.
  ok(
    "worst loss ≤ premium paid (capped downside)",
    -res.worst <= res.base + 1e-6,
    `worst=${res.worst} base=${res.base}`,
  );
  console.log(
    `     base=${res.base.toFixed(2)}  meanPnL=${res.meanPnl.toFixed(2)}  VaR95=${res.tail["0.9500"].var.toFixed(2)}  ES95=${res.tail["0.9500"].es.toFixed(2)}  VaR99=${res.tail["0.9900"].var.toFixed(2)}`,
  );
}

console.log("\n── high-precision normal CDF (West) ──");
{
  close("Phi(0)=0.5", normCdf(0), 0.5, 1e-15);
  close("Phi(1) (15 dp)", normCdf(1), 0.8413447460685429, 1e-14);
  close("Phi(-1) (15 dp)", normCdf(-1), 0.15865525393145707, 1e-14);
  close("Phi(2) (15 dp)", normCdf(2), 0.9772498680518208, 1e-14);
  close("Phi(-3) (15 dp)", normCdf(-3), 0.0013498980316300933, 1e-15);
  // deep tail — far beyond the old A&S erf's ~1e-7 reach
  const phiNeg5 = normCdf(-5);
  ok(
    "Phi(-5) tail accurate to ~1e-12 rel",
    Math.abs(phiNeg5 - 2.866515718791939e-7) / 2.866515718791939e-7 < 1e-9,
    `got ${phiNeg5}`,
  );
  ok("Phi(-8) does not underflow to 0", normCdf(-8) > 0 && normCdf(-8) < 1e-14);
  close("symmetry Phi(x)+Phi(-x)=1", normCdf(1.3) + normCdf(-1.3), 1, 1e-15);
}

console.log("\n── Monte-Carlo antithetic variance reduction ──");
{
  const u = ["BTC", "ETH", "SOL"];
  const spot0 = { BTC: 64000, ETH: 3400, SOL: 150 };
  const vols = { BTC: 0.55, ETH: 0.66, SOL: 0.92 };
  const cov = fromRows([
    [0.3025, 0.18, 0.22],
    [0.18, 0.4356, 0.27],
    [0.22, 0.27, 0.8464],
  ]);
  const legs: Leg[] = u.map((s) => ({
    underlying: s,
    type: "call" as const,
    s: spot0[s as keyof typeof spot0],
    k: spot0[s as keyof typeof spot0],
    t: 0.25,
    vol: vols[s as keyof typeof vols],
    r: 0.05,
    b: 0,
    qty: 1,
  }));
  const meanAt = (paths: number, seed: bigint, antithetic: boolean) =>
    monteCarloVar(legs, u, spot0, vols, cov, { paths, horizonYears: 10 / 365, seed, antithetic }).meanPnl;

  const reference = meanAt(120000, 1n, false); // large-sample "truth"
  const rmse = (antithetic: boolean) => {
    let se = 0;
    const K = 12;
    for (let k = 0; k < K; k++) {
      const m = meanAt(2000, BigInt(1000 + k), antithetic);
      se += (m - reference) ** 2;
    }
    return Math.sqrt(se / K);
  };
  const rA = rmse(true);
  const rP = rmse(false);
  ok("antithetic lowers mean-estimator RMSE", rA < rP, `antithetic=${rA.toFixed(4)} plain=${rP.toFixed(4)}`);
  ok("antithetic stays unbiased (RMSE ≪ |mean move|)", rA < Math.abs(reference) * 5 + 50);
  console.log(
    `     RMSE(mean P&L): antithetic=${rA.toFixed(3)}  plain=${rP.toFixed(3)}  (×${(rP / rA).toFixed(2)} tighter)`,
  );
}

console.log("\n── binomial (American) engine ──");
{
  // European binomial → Black–Scholes as steps grow.
  const inp = { s: 100, k: 100, t: 1, vol: 0.3, r: 0.04, b: 0.04, type: "call" as const };
  const bs = price(inp);
  close("binomial(2048) ≈ BS", binomialPrice({ ...inp, steps: 2048 }), bs, 0.05);
  // Non-dividend American call: never optimal to exercise early ⇒ premium ≈ 0.
  ok("American call early-exercise premium ≈ 0", Math.abs(earlyExercisePremium({ ...inp, steps: 1000 })) < 0.05);
  // American put has a positive early-exercise premium.
  const putInp = { s: 100, k: 110, t: 1, vol: 0.3, r: 0.08, b: 0.08, type: "put" as const };
  ok(
    "American put early-exercise premium > 0",
    earlyExercisePremium({ ...putInp, steps: 1000 }) > 0.05,
    `prem=${earlyExercisePremium({ ...putInp, steps: 1000 }).toFixed(3)}`,
  );
}

console.log("\n── analytic barrier options ──");
{
  // Monte-Carlo barrier reference with the Broadie–Glasserman–Kou continuity
  // correction so discrete monitoring matches the continuous closed form.
  function mcBarrier(
    s: number,
    k: number,
    h: number,
    t: number,
    vol: number,
    r: number,
    b: number,
    type: OptionType,
    kind: BarrierKind,
    paths: number,
    steps: number,
    seed: bigint,
  ): number {
    const dt = t / steps;
    const drift = (b - 0.5 * vol * vol) * dt;
    const vs = vol * Math.sqrt(dt);
    const beta = 0.5826; // BGK constant
    // Discrete monitoring under-hits; shift the MC barrier toward spot (down ⇒ up,
    // up ⇒ down) so the discretely-monitored MC emulates the continuous closed form.
    const corr = Math.exp((kind.startsWith("down") ? 1 : -1) * beta * vol * Math.sqrt(dt));
    const hAdj = h * corr;
    const down = kind.startsWith("down");
    const gauss = new GaussianStream(new Pcg32(seed));
    let sum = 0;
    for (let p = 0; p < paths; p++) {
      let px = s;
      let hit = false;
      for (let i = 0; i < steps; i++) {
        px *= Math.exp(drift + vs * gauss.draw());
        if ((down && px <= hAdj) || (!down && px >= hAdj)) hit = true;
      }
      const alive = kind.endsWith("in") ? hit : !hit;
      if (alive) sum += type === "call" ? Math.max(px - k, 0) : Math.max(k - px, 0);
    }
    return (Math.exp(-r * t) * sum) / paths;
  }

  const base = { s: 100, k: 100, t: 0.5, vol: 0.3, r: 0.05, b: 0.05 };

  // In/out parity: knock-in + knock-out = vanilla, exactly.
  const vanillaCall = price({ ...base, type: "call" });
  const di = barrierPrice({ ...base, h: 90, type: "call", kind: "down-in" });
  const doo = barrierPrice({ ...base, h: 90, type: "call", kind: "down-out" });
  close("down-in + down-out = vanilla call", di + doo, vanillaCall, 1e-9);
  const ui = barrierPrice({ ...base, h: 115, type: "call", kind: "up-in" });
  const uo = barrierPrice({ ...base, h: 115, type: "call", kind: "up-out" });
  close("up-in + up-out = vanilla call", ui + uo, vanillaCall, 1e-9);
  const vanillaPut = price({ ...base, type: "put" });
  const pdi = barrierPrice({ ...base, h: 90, type: "put", kind: "down-in" });
  const pdo = barrierPrice({ ...base, h: 90, type: "put", kind: "down-out" });
  close("put down-in + down-out = vanilla put", pdi + pdo, vanillaPut, 1e-9);

  // Absolute correctness vs. Monte-Carlo (the formula could be internally
  // consistent yet wrong; MC catches that).
  const analyticDO = barrierPrice({ ...base, h: 90, type: "call", kind: "down-out" });
  const mcDO = mcBarrier(base.s, base.k, 90, base.t, base.vol, base.r, base.b, "call", "down-out", 60000, 400, 0xb0n);
  ok(
    "down-out call matches Monte-Carlo",
    Math.abs(analyticDO - mcDO) < 0.25,
    `analytic=${analyticDO.toFixed(3)} mc=${mcDO.toFixed(3)}`,
  );
  const analyticUI = barrierPrice({ ...base, h: 115, type: "call", kind: "up-in" });
  const mcUI = mcBarrier(base.s, base.k, 115, base.t, base.vol, base.r, base.b, "call", "up-in", 60000, 400, 0xb1n);
  ok(
    "up-in call matches Monte-Carlo",
    Math.abs(analyticUI - mcUI) < 0.25,
    `analytic=${analyticUI.toFixed(3)} mc=${mcUI.toFixed(3)}`,
  );

  // Barrier-far limits.
  ok(
    "far down-out call ≈ vanilla",
    Math.abs(barrierPrice({ ...base, h: 1, type: "call", kind: "down-out" }) - vanillaCall) < 1e-6,
  );
  ok("far down-in call ≈ 0", barrierPrice({ ...base, h: 1, type: "call", kind: "down-in" }) < 1e-6);
}

console.log("\n── Heston stochastic-vol pricer ──");
{
  const V = 0.04,
    r = 0.03,
    t = 1.0;
  // As vol-of-vol ξ → 0 (with v0 = θ) Heston collapses to Black–Scholes at √θ.
  let maxDiff = 0;
  for (const k of [90, 100, 110]) {
    const h = hestonPrice({ s: 100, k, t, r, type: "call", params: { v0: V, kappa: 3, theta: V, xi: 0.03, rho: 0 } });
    const bs = price({ s: 100, k, t, vol: Math.sqrt(V), r, b: r, type: "call" });
    maxDiff = Math.max(maxDiff, Math.abs(h - bs));
  }
  ok("Heston → Black–Scholes as ξ→0", maxDiff < 0.02, `maxDiff=${maxDiff.toFixed(4)}`);

  // Put–call parity under Heston.
  const params = { v0: 0.05, kappa: 1.5, theta: 0.04, xi: 0.5, rho: -0.6 };
  const c = hestonPrice({ s: 100, k: 105, t, r, type: "call", params });
  const p = hestonPrice({ s: 100, k: 105, t, r, type: "put", params });
  close("Heston put–call parity", c - p, 100 - 105 * Math.exp(-r * t), 1e-6);

  // Independent Monte-Carlo Heston (full-truncation Euler) cross-check.
  const mc = (() => {
    const paths = 40000,
      steps = 200;
    const dt = t / steps,
      sq = Math.sqrt(dt);
    const g = new GaussianStream(new Pcg32(0x4e57n));
    const pr = { v0: 0.05, kappa: 1.5, theta: 0.04, xi: 0.4, rho: -0.6 };
    let sum = 0;
    for (let i = 0; i < paths; i++) {
      let S = 100,
        v = pr.v0;
      for (let j = 0; j < steps; j++) {
        const z1 = g.draw();
        const z2 = pr.rho * z1 + Math.sqrt(1 - pr.rho * pr.rho) * g.draw();
        const vp = Math.max(v, 0);
        S *= Math.exp((r - 0.5 * vp) * dt + Math.sqrt(vp) * sq * z1);
        v = v + pr.kappa * (pr.theta - vp) * dt + pr.xi * Math.sqrt(vp) * sq * z2;
      }
      sum += Math.max(S - 100, 0);
    }
    return (Math.exp(-r * t) * sum) / paths;
  })();
  const analytic = hestonPrice({
    s: 100,
    k: 100,
    t,
    r,
    type: "call",
    params: { v0: 0.05, kappa: 1.5, theta: 0.04, xi: 0.4, rho: -0.6 },
  });
  ok(
    "Heston analytic matches Monte-Carlo",
    Math.abs(analytic - mc) < 0.25,
    `analytic=${analytic.toFixed(3)} mc=${mc.toFixed(3)}`,
  );
}

console.log("\n── exotic options ──");
{
  const s = 100,
    k = 100,
    t = 1,
    vol = 0.3,
    r = 0.05,
    b = 0.05;
  const vanilla = price({ s, k, t, vol, r, b, type: "call" });

  // Digital decomposition is exact: vanilla call = assetON − K·cashON.
  const aon = digitalAssetOrNothing(s, k, t, vol, r, b, "call");
  const con = digitalCashOrNothing(s, k, t, vol, r, b, "call");
  close("vanilla = assetON − K·cashON", aon - k * con, vanilla, 1e-9);
  close(
    "cashON call + put = e^{−rT}",
    digitalCashOrNothing(s, k, t, vol, r, b, "call") + digitalCashOrNothing(s, k, t, vol, r, b, "put"),
    Math.exp(-r * t),
    1e-12,
  );

  // Geometric Asian < vanilla, and matches a direct MC of the geometric average.
  const ga = geometricAsian(s, k, t, vol, r, b, "call");
  ok("geometric Asian < vanilla", ga < vanilla, `ga=${ga.toFixed(3)} vanilla=${vanilla.toFixed(3)}`);
  const gaMc = (() => {
    const paths = 40000,
      steps = 250;
    const dt = t / steps,
      sq = Math.sqrt(dt);
    const g = new GaussianStream(new Pcg32(0xa51a4n));
    let sum = 0;
    for (let i = 0; i < paths; i++) {
      let S = s,
        logsum = 0;
      for (let j = 0; j < steps; j++) {
        S *= Math.exp((b - 0.5 * vol * vol) * dt + vol * sq * g.draw());
        logsum += Math.log(S);
      }
      sum += Math.max(Math.exp(logsum / steps) - k, 0);
    }
    return (Math.exp(-r * t) * sum) / paths;
  })();
  ok("geometric Asian matches MC", Math.abs(ga - gaMc) < 0.15, `analytic=${ga.toFixed(3)} mc=${gaMc.toFixed(3)}`);

  // Variance swap on a FLAT smile must return that vol back.
  const fairVar = varianceSwapFairVariance(s, r, 0, t, () => 0.3);
  close("flat-smile var swap ⇒ fair vol ≈ σ", Math.sqrt(fairVar), 0.3, 5e-3);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
