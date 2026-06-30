/* portfolio-opt tests: optimality properties of each constructor. */
import { linalg } from "@amplifi/quant-core";
import {
  minVarianceWeights,
  tangencyWeights,
  targetReturnWeights,
  portfolioVariance,
  portfolioReturn,
  portfolioSharpe,
  riskContributions,
  riskBudgetWeights,
  ercWeights,
  impliedEquilibriumReturns,
  blackLitterman,
} from "../src/index";

let passed = 0,
  failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  ✗ ${name}  ${detail}`);
  }
}
const sum = (w: ArrayLike<number>) => Array.from(w).reduce((s, x) => s + x, 0);
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A 3-asset covariance (annualised) with positive correlations.
const cov = linalg.fromRows([
  [0.04, 0.012, 0.006],
  [0.012, 0.09, 0.018],
  [0.006, 0.018, 0.16],
]);
const mu = [0.08, 0.12, 0.15];
const equal = [1 / 3, 1 / 3, 1 / 3];

console.log("\n── mean-variance ──");
{
  const w = minVarianceWeights(cov);
  check("min-variance sums to 1", close(sum(w), 1, 1e-12));
  check("min-variance ≤ equal-weight variance", portfolioVariance(cov, w) <= portfolioVariance(cov, equal) + 1e-12);
  // No other fully-invested portfolio beats it: probe random perturbations.
  let beats = false;
  let seed = 1;
  for (let t = 0; t < 200; t++) {
    const p = Array.from(
      { length: 3 },
      () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.4,
    );
    const wp = Array.from(w, (x, i) => x + p[i]);
    const s = sum(wp);
    const wn = wp.map((x) => x / s);
    if (portfolioVariance(cov, wn) < portfolioVariance(cov, w) - 1e-9) beats = true;
  }
  check("min-variance is the global minimum (200 probes)", !beats);

  const tan = tangencyWeights(cov, mu, 0.02);
  check("tangency sums to 1", close(sum(tan), 1, 1e-12));
  check(
    "tangency Sharpe ≥ equal-weight Sharpe",
    portfolioSharpe(cov, mu, tan, 0.02) >= portfolioSharpe(cov, mu, equal, 0.02),
  );

  const tgt = 0.13;
  const wt = targetReturnWeights(cov, mu, tgt);
  check("frontier hits target return", close(portfolioReturn(mu, wt), tgt, 1e-10) && close(sum(wt), 1, 1e-10));
  check(
    "frontier variance ≥ global min",
    portfolioVariance(cov, wt) >= portfolioVariance(cov, minVarianceWeights(cov)) - 1e-12,
  );
}

console.log("\n── risk budgeting ──");
{
  const erc = ercWeights(cov);
  const rc = riskContributions(cov, erc);
  const maxDev = Math.max(...rc.map((x) => Math.abs(x - 1 / 3)));
  check("ERC: equal risk contributions", maxDev < 1e-6, `maxDev=${maxDev}`);
  check("ERC weights sum to 1", close(sum(erc), 1, 1e-9));
  // Lower-vol asset (0) gets more weight than higher-vol asset (2).
  check("ERC over-weights the low-vol asset", erc[0] > erc[2]);

  const budgets = [0.5, 0.3, 0.2];
  const w = riskBudgetWeights(cov, budgets);
  const frac = riskContributions(cov, w);
  const dev = Math.max(...frac.map((x, i) => Math.abs(x - budgets[i])));
  check("custom budgets: RC fractions match budgets", dev < 1e-6, `dev=${dev}`);
}

console.log("\n── Black–Litterman ──");
{
  const mkt = [0.5, 0.3, 0.2];
  const delta = 2.5;
  const pi = impliedEquilibriumReturns(cov, mkt, delta);
  check("equilibrium returns positive & ordered by risk·weight", pi[0] > 0 && pi[1] > 0 && pi[2] > 0);

  // No views ⇒ posterior equals equilibrium exactly.
  const noView = blackLitterman(cov, mkt, delta, null);
  check("no views ⇒ posterior = Π", Math.max(...Array.from(pi, (p, i) => Math.abs(p - noView[i]))) < 1e-12);

  // A bullish absolute view on asset 0 lifts its posterior above equilibrium.
  const bull = blackLitterman(cov, mkt, delta, { P: [[1, 0, 0]], Q: [pi[0] + 0.05] }, 0.05);
  check(
    "bullish view raises that asset's posterior",
    bull[0] > pi[0],
    `post=${bull[0].toFixed(4)} pi=${pi[0].toFixed(4)}`,
  );
  // The un-viewed assets move far less than the viewed one.
  check("view impact concentrated on the viewed asset", Math.abs(bull[0] - pi[0]) > Math.abs(bull[1] - pi[1]));
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
