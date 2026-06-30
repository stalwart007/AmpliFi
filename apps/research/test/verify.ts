/* research tests: backtest report shape, determinism, cost-sweep monotonicity. */
import { runBacktest, sweep, formatTable, SCENARIOS, monteCarloStress, type Scenario } from "../src/index";

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

// A genuinely survivable trend: strong steady drift, very low realized vol, so
// the convex upside outruns theta bleed and the book never hits the floor.
const calm: Scenario = { name: "t-trend", drift: 1.0, diffusionVol: 0.05, rho: 0.3, days: 80, deposit: 1000, params: { costBps: 15 }, seed: 11n };

console.log("\n── backtest report ──");
{
  const r = runBacktest(calm);
  check("report has finite metrics", Number.isFinite(r.report.maxDrawdown) && Number.isFinite(r.report.cagr));
  check("strong trend survives & ends NAV > 1", !r.closed && r.finalNav > 1, `nav=${r.finalNav.toFixed(3)} closed=${r.closed}`);
  check("epochs advanced over 80 days", r.epochs >= 3);
  check("max drawdown in [0,1]", r.report.maxDrawdown >= 0 && r.report.maxDrawdown <= 1);
}

console.log("\n── determinism ──");
{
  const a = runBacktest(calm).finalNav;
  const b = runBacktest(calm).finalNav;
  check("same scenario ⇒ identical final NAV", a === b);
}

console.log("\n── transaction-cost sweep monotonicity ──");
{
  const res = sweep(calm, "costBps", [0, 20, 50, 100]);
  let monotone = true;
  for (let i = 1; i < res.length; i++) if (res[i].finalNav > res[i - 1].finalNav + 1e-9) monotone = false;
  check("higher cost ⇒ lower (or equal) terminal NAV", monotone, res.map((r) => r.finalNav.toFixed(3)).join(" → "));
  check("zero-cost run pays nothing", res[0].report.totalCost === 0);
  check("costly run pays > 0", res[3].report.totalCost > 0);
}

console.log("\n── full suite + table render ──");
{
  const all = SCENARIOS.map(runBacktest);
  check("every scenario produced a result", all.length === SCENARIOS.length);
  const table = formatTable(all);
  check("table renders a header + rows", table.includes("scenario") && table.split("\n").length === SCENARIOS.length + 2);
}

console.log("\n── Monte-Carlo stress ──");
{
  const calm: Scenario = { name: "s-calm", drift: 0.8, diffusionVol: 0.05, rho: 0.3, days: 100, deposit: 1000, params: { costBps: 15 }, seed: 1n };
  const crash: Scenario = { name: "s-crash", drift: -0.2, rho: 0.6, jump: { intensityPerYear: 120, meanLog: -0.12, volLog: 0.08 }, days: 100, deposit: 1000, params: { costBps: 15 }, seed: 1n };
  const sc = monteCarloStress(calm, 32);
  const ss = monteCarloStress(crash, 32);
  check("percentiles ordered (p5 ≤ p50 ≤ p95)", sc.navP5 <= sc.navP50 && sc.navP50 <= sc.navP95);
  check("worst ≤ p5 ≤ … ≤ best", sc.worstNav <= sc.navP5 && sc.navP95 <= sc.bestNav);
  check("wind-down rate in [0,1]", sc.windDownRate >= 0 && sc.windDownRate <= 1);
  check("crash regime winds down more than calm", ss.windDownRate > sc.windDownRate, `crash=${ss.windDownRate} calm=${sc.windDownRate}`);
  check("crash p5 NAV below calm p5 NAV", ss.navP5 < sc.navP5);
  console.log(`     calm wind-down ${(sc.windDownRate * 100).toFixed(0)}%  ·  crash wind-down ${(ss.windDownRate * 100).toFixed(0)}%`);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
