/* =============================================================================
 * @amplifi/strategy-core / test / verify
 * -----------------------------------------------------------------------------
 * Property tests for the strategy state machine. These assert economic
 * invariants that must hold regardless of the random path:
 *
 *   - risk-parity weights sum to 1 and rank inversely to vol
 *   - deploy spends exactly the premium budget and manufactures leverage > 1
 *   - CAPPED DOWNSIDE: book mark ≥ 0 and NAV ≥ 0 on every step of every path
 *   - one leg collapsing does NOT wind the vault down (portfolio-level risk)
 *   - a whole-book crash DOES wind down at the floor, then freezes
 *   - re-strike is NAV-neutral
 *   - reserve is monotone non-decreasing; epochs advance
 *   - determinism: identical seed ⇒ identical terminal state
 * ===========================================================================*/

import { BasketAsset, StrategyParams, DEFAULT_PARAMS } from "../src/types";
import { riskParityWeights, ercWeights } from "../src/basket";
import { createState, deploy, step, addCapital, redeem, shock, forceRebalance, forceHarvest } from "../src/machine";
import { CorrelatedGbm, flatCorrelationMarket } from "../src/market";
import { sharpeRatio, maxDrawdown, calmarRatio, sortinoRatio, navReturns } from "../src/analytics";

let passed = 0,
  failed = 0;
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
const close = (n: string, a: number, b: number, tol: number) => ok(n, Math.abs(a - b) <= tol, `|${a} − ${b}| > ${tol}`);

const mkAssets = (): BasketAsset[] => [
  { sym: "BTC", spot: 64000, vol: 0.55, active: true },
  { sym: "ETH", spot: 3400, vol: 0.66, active: true },
  { sym: "SOL", spot: 150, vol: 0.92, active: true },
];
const flatSpots = { BTC: 64000, ETH: 3400, SOL: 150 };

console.log("\n── risk-parity weights ──");
{
  const w = riskParityWeights(mkAssets());
  const sum = w.BTC + w.ETH + w.SOL;
  close("weights sum to 1", sum, 1, 1e-12);
  ok("lower vol ⇒ higher weight (BTC > ETH > SOL)", w.BTC > w.ETH && w.ETH > w.SOL, JSON.stringify(w));
}

console.log("\n── deploy ──");
{
  const { state, events } = deploy(createState(mkAssets()), 1000);
  const dep = events.find((e) => e.kind === "deploy") as Extract<(typeof events)[number], { kind: "deploy" }>;
  close("premium spent == deposit", state.equity, 1000, 1e-6);
  close("initial NAV/share ≈ 1", state.navPerShare, 1, 1e-9);
  ok("3 legs struck", dep.legs === 3);
  ok(`leverage manufactured > 1 (got ${dep.realizedLeverage.toFixed(2)}×)`, dep.realizedLeverage > 1);
}

console.log("\n── capped downside over random paths ──");
{
  let worstNav = Infinity,
    minMarkSeen = Infinity,
    anyNeg = false;
  for (let trial = 0; trial < 20; trial++) {
    const assets = mkAssets();
    const cfg = flatCorrelationMarket(assets, 0.4, -0.3 /* bear drift */, 1, BigInt(1000 + trial));
    const gbm = new CorrelatedGbm(flatSpots, cfg);
    let s = deploy(createState(assets), 1000).state;
    for (let d = 0; d < 120 && !s.closed; d++) {
      const r = step(s, DEFAULT_PARAMS, gbm.next());
      s = r.state;
      const markEv = r.events.find((e) => e.kind === "mark") as any;
      if (markEv) minMarkSeen = Math.min(minMarkSeen, markEv.mark);
      if (s.navPerShare < 0) anyNeg = true;
      worstNav = Math.min(worstNav, s.navPerShare);
    }
  }
  ok("NAV/share never negative on any path", !anyNeg, `worstNav=${worstNav}`);
  ok("book mark never negative (long options floor at 0)", minMarkSeen >= -1e-9, `minMark=${minMarkSeen}`);
  console.log(`     worst NAV/share observed across 20 bear paths: ${worstNav.toFixed(4)}`);
}

console.log("\n── single-leg collapse is survivable (portfolio-level risk) ──");
{
  let s = deploy(createState(mkAssets()), 1000).state;
  // SOL alone evaporates; BTC/ETH unchanged.
  const r = step(s, DEFAULT_PARAMS, { spots: { ...flatSpots, SOL: 1.5 } });
  s = r.state;
  ok("vault NOT wound down by one leg dying", !s.closed);
  ok(
    "NAV drop ≈ SOL weight, not catastrophic",
    s.navPerShare > 0.6 && s.navPerShare < 0.85,
    `nav=${s.navPerShare.toFixed(4)}`,
  );
}

console.log("\n── whole-book crash ⇒ wind-down, then freeze ──");
{
  let s = deploy(createState(mkAssets()), 1000).state;
  const crash = { spots: { BTC: 64000 * 0.18, ETH: 3400 * 0.18, SOL: 150 * 0.18 } };
  const r = step(s, DEFAULT_PARAMS, crash);
  s = r.state;
  ok("wound down on whole-book breach", s.closed, `nav=${s.navPerShare}`);
  ok(
    "breach occurred below the floor",
    s.navPerShare < DEFAULT_PARAMS.floor * s.hwm + 1e-6,
    `nav=${s.navPerShare.toFixed(4)} floor=${DEFAULT_PARAMS.floor}`,
  );
  ok("positions liquidated to reserve", s.positions.length === 0 && s.reserve >= 0);
  // Frozen: stepping again changes nothing material.
  const navBefore = s.navPerShare;
  const after = step(s, DEFAULT_PARAMS, { spots: flatSpots }).state;
  ok("terminal state stays frozen", after.closed && Math.abs(after.navPerShare - navBefore) < 1e-9);
}

console.log("\n── re-strike is NAV-neutral ──");
{
  const base = deploy(createState(mkAssets()), 1000).state;
  const withRestrike: StrategyParams = { ...DEFAULT_PARAMS, rebalanceEveryDays: 1 };
  const without: StrategyParams = { ...DEFAULT_PARAMS, rebalanceEveryDays: 9999 };
  // Same single step, no price move: the only difference is whether a re-strike fired.
  const a = step(base, withRestrike, { spots: flatSpots }).state;
  const b = step(base, without, { spots: flatSpots }).state;
  close("NAV identical with/without re-strike", a.navPerShare, b.navPerShare, 1e-9);
}

console.log("\n── reserve monotonic + epochs advance (smooth bull path) ──");
{
  // Smooth up-trend: strong drift, LOW diffusion vol (so the floor isn't tripped
  // by path noise), while the OPTION pricing vols stay realistic. This isolates
  // the convex-upside + epoch-compounding property from gap/drawdown risk, which
  // the bear-path and whole-book-crash tests above already cover.
  const assets = mkAssets();
  const cfg = flatCorrelationMarket(assets, 0.35, 0.9 /* strong bull */, 1, 7n);
  for (const sym of cfg.symbols) cfg.vol[sym] = 0.08; // diffusion only; pricing vol unchanged
  const gbm = new CorrelatedGbm(flatSpots, cfg);
  let s = deploy(createState(assets), 1000).state;
  let prevReserve = s.reserve;
  let reserveMonotone = true;
  let maxEpoch = s.epoch;
  for (let d = 0; d < 100 && !s.closed; d++) {
    s = step(s, DEFAULT_PARAMS, gbm.next()).state;
    if (s.reserve < prevReserve - 1e-9) reserveMonotone = false;
    prevReserve = s.reserve;
    maxEpoch = Math.max(maxEpoch, s.epoch);
  }
  ok("reserve never decreases", reserveMonotone);
  ok(`epochs advanced (reached epoch ${maxEpoch})`, maxEpoch >= 3);
  ok("upside is convex: bull path ends NAV/share > 1", s.navPerShare > 1, `nav=${s.navPerShare.toFixed(4)}`);
  ok("profit was skimmed to reserve", s.reserve > 0, `reserve=${s.reserve.toFixed(2)}`);
  console.log(
    `     bull terminal: NAV/share=${s.navPerShare.toFixed(4)}  reserve=${s.reserve.toFixed(2)}  epoch=${s.epoch}`,
  );
}

console.log("\n── determinism ──");
{
  const run = (seed: bigint) => {
    const assets = mkAssets();
    const cfg = flatCorrelationMarket(assets, 0.4, 0.1, 1, seed);
    const gbm = new CorrelatedGbm(flatSpots, cfg);
    let s = deploy(createState(assets), 1000).state;
    for (let d = 0; d < 80 && !s.closed; d++) s = step(s, DEFAULT_PARAMS, gbm.next()).state;
    return s;
  };
  const a = run(42n);
  const b = run(42n);
  ok("same seed ⇒ identical terminal NAV", a.navPerShare === b.navPerShare);
  ok("same seed ⇒ identical reserve + epoch", a.reserve === b.reserve && a.epoch === b.epoch);
}

console.log("\n── Equal-Risk-Contribution weighting ──");
{
  const assets = mkAssets();
  // Build a correlation matrix where BTC/ETH are highly correlated (a "cluster")
  // and SOL is more independent. ERC must down-weight the clustered pair vs. the
  // naive inverse-vol scheme, which ignores the clustering.
  const corr = [
    [1.0, 0.9, 0.2],
    [0.9, 1.0, 0.2],
    [0.2, 0.2, 1.0],
  ];
  const w = ercWeights(assets, corr);
  const sum = w.BTC + w.ETH + w.SOL;
  close("ERC weights sum to 1", sum, 1, 1e-9);

  // Verify the equal-risk-contribution property directly: RC_i = w_i·(Σw)_i equal.
  const vols = { BTC: 0.55, ETH: 0.66, SOL: 0.92 };
  const syms = ["BTC", "ETH", "SOL"] as const;
  const wv = syms.map((s) => w[s]);
  const cov = syms.map((a, i) => syms.map((b, j) => vols[a] * vols[b] * corr[i][j]));
  const mrc = wv.map((_, i) => cov[i].reduce((acc, c, j) => acc + c * wv[j], 0));
  const rc = wv.map((wi, i) => wi * mrc[i]);
  const avg = (rc[0] + rc[1] + rc[2]) / 3;
  const maxRel = Math.max(...rc.map((x) => Math.abs(x - avg) / avg));
  ok("risk contributions are equal (ERC property)", maxRel < 1e-6, `maxRel=${maxRel}`);

  // ERC gives the clustered pair LESS combined weight than inverse-vol does.
  const iv = riskParityWeights(assets);
  ok(
    "ERC down-weights the correlated cluster vs 1/σ",
    w.BTC + w.ETH < iv.BTC + iv.ETH,
    `erc=${(w.BTC + w.ETH).toFixed(3)} iv=${(iv.BTC + iv.ETH).toFixed(3)}`,
  );
}

console.log("\n── transaction costs ──");
{
  // Same smooth-bull path, run with and without costs; costs must reduce NAV and
  // accumulate, while the frictionless run reproduces the prior behaviour.
  const mkBullRun = (costBps: number) => {
    const assets = mkAssets();
    const cfg = flatCorrelationMarket(assets, 0.35, 0.9, 1, 7n);
    for (const sym of cfg.symbols) cfg.vol[sym] = 0.08;
    const gbm = new CorrelatedGbm(flatSpots, cfg);
    const params: StrategyParams = { ...DEFAULT_PARAMS, costBps };
    let s = deploy(createState(assets), 1000, params).state;
    for (let d = 0; d < 100 && !s.closed; d++) s = step(s, params, gbm.next()).state;
    return s;
  };
  const free = mkBullRun(0);
  const costly = mkBullRun(30); // 0.30% per turnover
  ok(
    "costs reduce terminal NAV",
    costly.navPerShare < free.navPerShare,
    `free=${free.navPerShare.toFixed(4)} costly=${costly.navPerShare.toFixed(4)}`,
  );
  ok(
    "costsPaid accumulates when costBps>0",
    costly.costsPaid > 0 && free.costsPaid === 0,
    `costly=${costly.costsPaid.toFixed(2)}`,
  );
  // A fresh frictionless deploy spends exactly the premium budget (no entry cost).
  const freshFree = deploy(createState(mkAssets()), 1000, { ...DEFAULT_PARAMS, costBps: 0 }).state;
  ok("frictionless deploy spends full premium", Math.abs(freshFree.equity - 1000) < 1e-6);
  const freshCostly = deploy(createState(mkAssets()), 1000, { ...DEFAULT_PARAMS, costBps: 30 }).state;
  ok("deploy with costs pays an entry cost (NAV < par)", freshCostly.navPerShare < 1 && freshCostly.costsPaid > 0);
  console.log(
    `     bull NAV: frictionless=${free.navPerShare.toFixed(4)}  with 0.30% costs=${costly.navPerShare.toFixed(4)}  (paid ${costly.costsPaid.toFixed(2)})`,
  );
}

console.log("\n── performance analytics ──");
{
  // Deterministic NAV series: +1%/period for 10 periods. Sharpe should be large
  // and positive, drawdown zero, returns all equal.
  const up = Array.from({ length: 11 }, (_, i) => Math.pow(1.01, i));
  ok("returns are ~1% each", Math.abs(navReturns(up)[0] - 0.01) < 1e-12);
  ok("monotone-up series has zero drawdown", maxDrawdown(up) === 0);
  ok("monotone-up Sharpe is large & positive", sharpeRatio(up, 365) > 10);
  ok("monotone-up Sortino is +Infinity (no downside)", sortinoRatio(up, 365) === Infinity);

  // A series with a dip has a measurable drawdown and finite Calmar.
  const dip = [1, 1.1, 1.21, 0.9, 1.0, 1.15];
  const dd = maxDrawdown(dip);
  close("drawdown from 1.21 → 0.90 ≈ 25.6%", dd, (1.21 - 0.9) / 1.21, 1e-12);
  ok("Calmar is finite with a drawdown present", Number.isFinite(calmarRatio(dip, 365)));
  console.log(`     dip series: maxDrawdown=${(dd * 100).toFixed(2)}%`);
}

console.log("\n── jump-diffusion stress market ──");
{
  const assets = mkAssets();
  const minStepReturn = (withJumps: boolean) => {
    const cfg = flatCorrelationMarket(assets, 0.4, 0, 1, 99n);
    if (withJumps) cfg.jump = { intensityPerYear: 60, meanLog: -0.06, volLog: 0.05 }; // crash-skewed
    const gbm = new CorrelatedGbm(flatSpots, cfg);
    let prev = flatSpots.BTC;
    let worst = 0;
    for (let d = 0; d < 400; d++) {
      const u = gbm.next();
      const px = u.spots!.BTC;
      worst = Math.min(worst, px / prev - 1);
      prev = px;
    }
    return worst;
  };
  const plain = minStepReturn(false);
  const jumpy = minStepReturn(true);
  ok("jumps produce fatter left tail than pure GBM", jumpy < plain, `gbm=${plain.toFixed(4)} jump=${jumpy.toFixed(4)}`);

  // Jumps should also make the strategy wind down more often across seeds.
  const windDownCount = (withJumps: boolean) => {
    let count = 0;
    for (let trial = 0; trial < 12; trial++) {
      const a = mkAssets();
      const cfg = flatCorrelationMarket(a, 0.5, 0.2, 1, BigInt(500 + trial));
      if (withJumps) cfg.jump = { intensityPerYear: 80, meanLog: -0.08, volLog: 0.06 };
      const gbm = new CorrelatedGbm(flatSpots, cfg);
      let s = deploy(createState(a), 1000).state;
      for (let d = 0; d < 120 && !s.closed; d++) s = step(s, DEFAULT_PARAMS, gbm.next()).state;
      if (s.closed) count++;
    }
    return count;
  };
  ok("jump regime triggers ≥ as many wind-downs", windDownCount(true) >= windDownCount(false));
  console.log(`     worst 1-day BTC return: GBM=${(plain * 100).toFixed(1)}%  with jumps=${(jumpy * 100).toFixed(1)}%`);
}

console.log("\n── TimeMachine operations ──");
{
  // add capital is NAV-continuous and scales exposure.
  let s = deploy(createState(mkAssets()), 1000).state;
  const navBefore = s.navPerShare;
  const sharesBefore = s.shares;
  const expBefore = s.equity;
  s = addCapital(s, 500).state;
  ok("addCapital keeps NAV/share continuous", Math.abs(s.navPerShare - navBefore) < 1e-9, `nav ${navBefore}→${s.navPerShare}`);
  ok("addCapital mints shares", s.shares > sharesBefore);
  ok("addCapital scales exposure up", s.equity > expBefore);

  // redeem is NAV-continuous and returns value.
  const navPre = s.navPerShare;
  s = redeem(s, 300).state;
  ok("redeem keeps NAV/share continuous", Math.abs(s.navPerShare - navPre) < 1e-9);
  ok("redeem burns shares", s.shares < sharesBefore + 500);

  // shock: a severe whole-basket crash winds down; NAV never negative.
  let c = deploy(createState(mkAssets()), 1000).state;
  c = shock(c, -0.85).state;
  ok("severe shock winds down", c.closed && c.navPerShare >= 0, `nav=${c.navPerShare}`);

  // a mild shock does NOT wind down (capped, portfolio-level).
  let m = deploy(createState(mkAssets()), 1000).state;
  m = shock(m, -0.1).state;
  ok("mild shock survives (portfolio-level)", !m.closed && m.navPerShare > 0);

  // force rebalance is NAV-neutral at zero cost.
  let r = deploy(createState(mkAssets()), 1000).state;
  const rnav = r.navPerShare;
  r = forceRebalance(r).state;
  ok("forceRebalance NAV-neutral (no cost)", Math.abs(r.navPerShare - rnav) < 1e-9);

  // force harvest after a gain moves value into the safe reserve.
  let h = deploy(createState(mkAssets()), 1000).state;
  for (const a of h.assets) a.spot *= 1.2; // +20% across the basket
  h = step(h, DEFAULT_PARAMS, { spots: { BTC: h.assets[0].spot, ETH: h.assets[1].spot, SOL: h.assets[2].spot } }).state;
  const resBefore = h.reserve;
  h = forceHarvest(h).state;
  ok("forceHarvest skims profit into reserve", h.reserve >= resBefore);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
