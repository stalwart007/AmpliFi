/* =============================================================================
 * AmpliFi terminal — TimeMachine (TM) engine controller
 * -----------------------------------------------------------------------------
 * Drives the REAL @amplifi/strategy-core engine and frames its state in the
 * TimeMachine vocabulary the protocol was designed around:
 *
 *   Capital compression   deposit (base capital) → manufactured exposure
 *   Exposure engine       a risk-parity / ERC basket of long-option legs
 *   Profit engine         epoch checkpoints fold realised profit into capital
 *   Recursive growth      exposure rescales as the capital base compounds
 *   Buffer layers         reserve (safe) + book mark (at-risk) + floor distance
 *   Epoch reset           periodic recalculation of exposure on the new capital
 *   Liquidation           portfolio-level wind-down, never one asset
 *
 * The amplified exposure is financed by the long-options book: option sellers
 * provide the leverage, the vault pays premium (the deposit) + theta, and the
 * downside is capped at the premium. Risk (VaR/ES) comes from @amplifi/quant-core.
 * ===========================================================================*/

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createState,
  deploy,
  step,
  addCapital,
  redeem,
  shock,
  forceRebalance,
  forceHarvest,
  CorrelatedGbm,
  sharpeRatio,
  maxDrawdown,
  DEFAULT_PARAMS,
  type BasketAsset,
  type StrategyState,
  type StrategyEvent,
  type StrategyParams,
  type MarketConfig,
} from "@amplifi/strategy-core";
import { aggregate, monteCarloVar, linalg, type Leg } from "@amplifi/quant-core";
import { minVarianceWeights, tangencyWeights, ercWeights as optErc } from "@amplifi/portfolio-opt";

/* ---- the exposure universe (the basket the TM tracks) ---- */
type AssetClass = "crypto" | "metal" | "equity" | "energy" | "fx";
interface UniverseAsset {
  sym: string;
  spot: number;
  vol: number;
  cls: AssetClass;
}
export const UNIVERSE: UniverseAsset[] = [
  { sym: "BTC", spot: 64000, vol: 0.55, cls: "crypto" },
  { sym: "ETH", spot: 3400, vol: 0.66, cls: "crypto" },
  { sym: "SOL", spot: 150, vol: 0.92, cls: "crypto" },
  { sym: "BNB", spot: 585, vol: 0.58, cls: "crypto" },
  { sym: "GOLD", spot: 2400, vol: 0.16, cls: "metal" },
  { sym: "NDX", spot: 19500, vol: 0.22, cls: "equity" },
  { sym: "OIL", spot: 78, vol: 0.35, cls: "energy" },
  { sym: "AVAX", spot: 28, vol: 0.96, cls: "crypto" },
  { sym: "XRP", spot: 0.6, vol: 0.85, cls: "crypto" },
  { sym: "DOGE", spot: 0.16, vol: 1.05, cls: "crypto" },
  { sym: "ADA", spot: 0.45, vol: 0.9, cls: "crypto" },
  { sym: "LINK", spot: 18, vol: 0.86, cls: "crypto" },
  { sym: "DOT", spot: 7, vol: 0.88, cls: "crypto" },
  { sym: "LTC", spot: 85, vol: 0.7, cls: "crypto" },
  { sym: "ATOM", spot: 9, vol: 0.9, cls: "crypto" },
  { sym: "ARB", spot: 1.1, vol: 1.0, cls: "crypto" },
  { sym: "OP", spot: 2.2, vol: 1.0, cls: "crypto" },
  { sym: "SP500", spot: 5400, vol: 0.15, cls: "equity" },
  { sym: "SILVER", spot: 30, vol: 0.28, cls: "metal" },
  { sym: "COPPER", spot: 4.4, vol: 0.26, cls: "metal" },
  { sym: "NATGAS", spot: 2.5, vol: 0.55, cls: "energy" },
  { sym: "EURUSD", spot: 1.08, vol: 0.08, cls: "fx" },
];
const DEFAULT_ACTIVE = 6;
const R = 0.05;

/** Pairwise correlation by asset class — realistic cross-asset structure. */
function classCorr(a: AssetClass, b: AssetClass): number {
  if (a === b) return a === "crypto" ? 0.72 : 0.9;
  const key = [a, b].sort().join("-");
  const table: Record<string, number> = {
    "crypto-equity": 0.45,
    "crypto-metal": -0.1,
    "crypto-energy": 0.2,
    "equity-metal": 0.0,
    "energy-equity": 0.25,
    "energy-metal": 0.1,
    "crypto-fx": 0.1,
    "equity-fx": 0.2,
    "fx-metal": 0.3,
    "energy-fx": 0.12,
  };
  return table[key] ?? 0.15;
}
function buildCorr(syms: string[]): number[][] {
  const cls = syms.map((s) => UNIVERSE.find((u) => u.sym === s)!.cls);
  return cls.map((ci, i) => cls.map((cj, j) => (i === j ? 1 : classCorr(ci, cj))));
}

export interface TMConfig {
  deposit: number;
  costBps: number;
  useErc: boolean;
  jumps: boolean;
  drift: number;
  speed: number;
  active: string[]; // symbols the user has selected for exposure
}
export const DEFAULT_CONFIG: TMConfig = {
  deposit: 1000,
  costBps: 0, // frictionless by default → a 1000 deposit mints exactly 1000 AFI at NAV 1.000
  useErc: true,
  jumps: false,
  drift: 0.35,
  speed: 8,
  active: UNIVERSE.slice(0, DEFAULT_ACTIVE).map((u) => u.sym),
};

export interface LogLine {
  id: number;
  day: number;
  text: string;
  cls: string;
}
export interface LedgerRow {
  day: number;
  kind: string;
  amount: number;
}

export interface Snapshot {
  day: number;
  deployed: boolean;
  closed: boolean;
  epoch: number;
  // capital compression
  capital: number; // current base capital (NAV·shares)
  deposited: number; // cumulative deposited
  exposure: number; // manufactured dollar-delta notional
  leverage: number; // exposure / capital
  navPerShare: number;
  shares: number;
  // buffers
  reserve: number;
  bookMark: number; // at-risk book value
  floorNav: number; // wind-down threshold (floor·hwm)
  hwm: number;
  // profit
  realizedProfit: number; // reserve + (capital − deposited)
  costsPaid: number;
  // basket
  weights: { sym: string; w: number; vol: number; spot: number; cls: string }[];
  corr: { syms: string[]; matrix: number[][] };
  // series
  navHistory: number[];
  exposureHistory: number[];
  ddHistory: number[];
  epochMarks: { day: number; epoch: number }[];
  // analytics + risk
  metrics: { sharpe: number; maxDD: number };
  risk: { var95: number; es95: number; var99: number; base: number; pnl: number[] } | null;
  // optimizer (portfolio-opt) target weights for the active basket
  optimizer: { minVar: number[]; maxSharpe: number[]; erc: number[]; syms: string[] } | null;
  events: LogLine[];
  ledger: LedgerRow[];
}

function activeSyms(s: StrategyState): string[] {
  return s.assets.filter((a) => a.active).map((a) => a.sym);
}

function legsFromState(s: StrategyState): { legs: Leg[]; syms: string[]; spot0: Record<string, number>; vols: Record<string, number> } {
  const spotOf: Record<string, number> = {};
  s.assets.forEach((a) => (spotOf[a.sym] = a.spot));
  const legs: Leg[] = s.positions.map((p) => ({
    underlying: p.sym,
    type: "call",
    s: spotOf[p.sym],
    k: p.strike,
    t: p.expiry,
    vol: p.vol,
    r: R,
    b: 0,
    qty: p.qty,
  }));
  const syms = Array.from(new Set(s.positions.map((p) => p.sym)));
  const spot0: Record<string, number> = {};
  const vols: Record<string, number> = {};
  for (const sym of syms) {
    spot0[sym] = spotOf[sym];
    vols[sym] = s.assets.find((a) => a.sym === sym)?.vol ?? 0.6;
  }
  return { legs, syms, spot0, vols };
}

function exposureOf(s: StrategyState): number {
  if (s.positions.length === 0) return 0;
  return aggregate(legsFromState(s).legs).dollarDelta;
}

function computeRisk(s: StrategyState): Snapshot["risk"] {
  if (s.positions.length === 0) return null;
  try {
    const { legs, syms, spot0, vols } = legsFromState(s);
    const corr = buildCorr(syms);
    const cov = linalg.fromRows(corr.map((row, i) => row.map((rho, j) => vols[syms[i]] * vols[syms[j]] * rho)));
    const res = monteCarloVar(legs, syms, spot0, vols, cov, {
      paths: 3000,
      horizonYears: 1 / 365,
      antithetic: true,
      levels: [0.95, 0.99],
      seed: BigInt(1 + s.day),
    });
    return {
      var95: res.tail["0.9500"].var,
      es95: res.tail["0.9500"].es,
      var99: res.tail["0.9900"].var,
      base: res.base,
      pnl: Array.from(res.pnl),
    };
  } catch {
    return null;
  }
}

function optimizerWeights(s: StrategyState): Snapshot["optimizer"] {
  const syms = activeSyms(s);
  if (syms.length < 2) return null;
  try {
    const vols = syms.map((sym) => s.assets.find((a) => a.sym === sym)!.vol);
    const corr = buildCorr(syms);
    const cov = linalg.fromRows(corr.map((row, i) => row.map((rho, j) => vols[i] * vols[j] * rho)));
    const mu = vols.map((v) => 0.04 + 0.12 * v); // simple risk→return prior for the demo
    return {
      minVar: Array.from(minVarianceWeights(cov)),
      maxSharpe: Array.from(tangencyWeights(cov, mu, R)),
      erc: Array.from(optErc(cov)),
      syms,
    };
  } catch {
    return null;
  }
}

function drawdownSeries(nav: number[]): number[] {
  let peak = -Infinity;
  return nav.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? -((peak - v) / peak) : 0;
  });
}

function makeMarket(cfg: TMConfig, assets: BasketAsset[], seed: bigint): { gbm: CorrelatedGbm; spots: Record<string, number> } {
  const active = assets.filter((a) => a.active);
  const syms = active.map((a) => a.sym);
  const corr = buildCorr(syms);
  const drift: Record<string, number> = {};
  const vol: Record<string, number> = {};
  active.forEach((a) => {
    drift[a.sym] = cfg.drift;
    vol[a.sym] = a.vol;
  });
  const mc: MarketConfig = { drift, vol, corr, symbols: syms, stepDays: 1, seed };
  if (cfg.jumps) mc.jump = { intensityPerYear: 36, meanLog: -0.05, volLog: 0.05 };
  const spots: Record<string, number> = {};
  active.forEach((a) => (spots[a.sym] = a.spot));
  return { gbm: new CorrelatedGbm(spots, mc), spots };
}

export function useTimeMachine() {
  const [config, setConfig] = useState<TMConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const stateRef = useRef<StrategyState | null>(null);
  const gbmRef = useRef<CorrelatedGbm | null>(null);
  const paramsRef = useRef<StrategyParams>(DEFAULT_PARAMS);
  const depositedRef = useRef(0);
  const navHist = useRef<number[]>([]);
  const expHist = useRef<number[]>([]);
  const epochMarks = useRef<{ day: number; epoch: number }[]>([]);
  const events = useRef<LogLine[]>([]);
  const ledger = useRef<LedgerRow[]>([]);
  const eid = useRef(1);
  const riskRef = useRef<Snapshot["risk"]>(null);
  const optRef = useRef<Snapshot["optimizer"]>(null);

  const pushEvents = useCallback((evs: StrategyEvent[]) => {
    for (const e of evs) {
      let text = "";
      let cls = "muted";
      if (e.kind === "deploy") {
        text = `DEPLOY · ${e.legs} legs · ${e.realizedLeverage.toFixed(2)}× exposure`;
        cls = "cyan";
      } else if (e.kind === "hedge") {
        text = `${e.reason === "band" ? "DELTA RE-HEDGE" : "REBALANCE"} · drift ${(e.driftBefore * 100).toFixed(1)}%`;
        cls = "amber";
      } else if (e.kind === "epoch") {
        text = `EPOCH ${e.epoch} · profit ${e.profit.toFixed(0)} · skim ${e.skimmed.toFixed(0)} → reserve`;
        cls = "green";
        ledger.current.unshift({ day: e.day, kind: "skim", amount: e.skimmed });
      } else if (e.kind === "windDown") {
        text = `WIND-DOWN · NAV ${e.navPerShare.toFixed(3)} · recovered ${e.recovered.toFixed(0)}`;
        cls = "red";
      } else if (e.kind === "cost") {
        ledger.current.unshift({ day: e.day, kind: `cost:${e.reason}`, amount: -e.amount });
        continue;
      } else if (e.kind === "note") {
        text = e.msg;
        cls = "cyan";
      }
      if (text) events.current.unshift({ id: eid.current++, day: e.day, text, cls });
    }
    events.current = events.current.slice(0, 80);
    ledger.current = ledger.current.slice(0, 40);
  }, []);

  const snapshot = useCallback((): Snapshot => {
    const s = stateRef.current!;
    const nav = navHist.current;
    const capital = s.navPerShare * s.shares;
    const exposure = exposureOf(s);
    const bookMark = Math.max(capital - s.reserve, 0);
    return {
      day: s.day,
      deployed: s.deployed,
      closed: s.closed,
      epoch: s.epoch,
      capital,
      deposited: depositedRef.current,
      exposure,
      leverage: capital > 0 ? exposure / capital : 0,
      navPerShare: s.navPerShare,
      shares: s.shares,
      reserve: s.reserve,
      bookMark,
      floorNav: paramsRef.current.floor * s.hwm,
      hwm: s.hwm,
      realizedProfit: s.reserve + (capital - depositedRef.current),
      costsPaid: s.costsPaid,
      weights: s.assets
        .filter((a) => a.active)
        .map((a) => ({ sym: a.sym, w: s.weights[a.sym] ?? 0, vol: a.vol, spot: a.spot, cls: UNIVERSE.find((u) => u.sym === a.sym)?.cls ?? "crypto" })),
      corr: { syms: activeSyms(s), matrix: buildCorr(activeSyms(s)) },
      navHistory: nav.slice(-260),
      exposureHistory: expHist.current.slice(-260),
      ddHistory: drawdownSeries(nav).slice(-260),
      epochMarks: epochMarks.current.slice(-12),
      metrics: { sharpe: nav.length > 3 ? sharpeRatio(nav, 365) : 0, maxDD: maxDrawdown(nav) },
      risk: riskRef.current,
      optimizer: optRef.current,
      events: events.current,
      ledger: ledger.current,
    };
  }, []);

  const recordSeries = useCallback(() => {
    const s = stateRef.current!;
    navHist.current.push(s.navPerShare);
    expHist.current.push(exposureOf(s));
    if (navHist.current.length > 4000) {
      navHist.current.shift();
      expHist.current.shift();
    }
  }, []);

  const reset = useCallback(
    (cfg: TMConfig) => {
      const sel = cfg.active.length > 0 ? cfg.active : UNIVERSE.slice(0, DEFAULT_ACTIVE).map((u) => u.sym);
      const assets: BasketAsset[] = UNIVERSE.map((u) => ({ sym: u.sym, spot: u.spot, vol: u.vol, active: sel.includes(u.sym) }));
      const active = assets.filter((a) => a.active);
      paramsRef.current = { ...DEFAULT_PARAMS, costBps: cfg.costBps, corr: cfg.useErc ? buildCorr(active.map((a) => a.sym)) : undefined };
      const { gbm } = makeMarket(cfg, assets, 0xa11ce5n);
      gbmRef.current = gbm;

      // Carry an existing position across structural changes (e.g. token edits)
      // so a live deposit is never silently wiped; otherwise start EMPTY — the
      // vault holds no AFI until the user makes their first deposit.
      const prev = stateRef.current;
      const carry = prev && prev.deployed && !prev.closed ? prev.navPerShare * prev.shares : 0;
      eid.current = 1;
      events.current = [];
      if (carry > 0) {
        const dep = deploy(createState(assets), carry, paramsRef.current);
        stateRef.current = dep.state;
        navHist.current = [dep.state.navPerShare];
        expHist.current = [exposureOf(dep.state)];
        epochMarks.current = [{ day: 0, epoch: 1 }];
        ledger.current = [{ day: 0, kind: "redeploy", amount: carry }];
        pushEvents(dep.events);
        riskRef.current = computeRisk(dep.state);
        optRef.current = optimizerWeights(dep.state);
      } else {
        stateRef.current = createState(assets); // undeployed, 0 shares, 0 capital
        depositedRef.current = 0;
        navHist.current = [];
        expHist.current = [];
        epochMarks.current = [];
        ledger.current = [];
        riskRef.current = null;
        optRef.current = null;
      }
      setSnap(snapshot());
    },
    [pushEvents, snapshot],
  );

  // (re)initialise only when a structural field changes — NOT on speed, which
  // only affects the tick interval and must never reset a running simulation.
  const resetKey = `${config.deposit}|${config.costBps}|${config.useErc}|${config.jumps}|${config.drift}|${config.active.join(",")}`;
  useEffect(() => {
    reset(config);
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // stepping loop.
  useEffect(() => {
    if (!running) return;
    const interval = Math.max(20, Math.round(1000 / config.speed));
    let tick = 0;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      const gbm = gbmRef.current;
      if (!s || !gbm || s.closed || !s.deployed) {
        setRunning(false);
        return;
      }
      const prevEpoch = s.epoch;
      const r = step(s, paramsRef.current, gbm.next());
      stateRef.current = r.state;
      if (r.state.epoch !== prevEpoch) epochMarks.current.push({ day: r.state.day, epoch: r.state.epoch });
      recordSeries();
      pushEvents(r.events);
      if (tick % 8 === 0) {
        riskRef.current = computeRisk(r.state);
        optRef.current = optimizerWeights(r.state);
      }
      tick++;
      setSnap(snapshot());
      if (r.state.closed) setRunning(false);
    }, interval);
    return () => window.clearInterval(id);
  }, [running, config.speed, pushEvents, snapshot, recordSeries]);

  /** Apply a discretionary TM operation and refresh. */
  const apply = useCallback(
    (fn: (s: StrategyState, p: StrategyParams) => { state: StrategyState; events: StrategyEvent[] }) => {
      const s = stateRef.current;
      if (!s) return;
      const r = fn(s, paramsRef.current);
      stateRef.current = r.state;
      recordSeries();
      pushEvents(r.events);
      riskRef.current = computeRisk(r.state);
      optRef.current = optimizerWeights(r.state);
      setSnap(snapshot());
    },
    [pushEvents, snapshot, recordSeries],
  );

  /** Deposit: the FIRST deposit deploys the vault (mints AFI 1:1 at NAV 1.000);
   *  subsequent deposits add capital and scale exposure, NAV-continuously. */
  const deposit = useCallback(
    (amount: number) => {
      const s = stateRef.current;
      if (!s || !(amount > 0)) return;
      if (!s.deployed) {
        const dep = deploy(s, amount, paramsRef.current);
        stateRef.current = dep.state;
        depositedRef.current = amount;
        navHist.current = [dep.state.navPerShare];
        expHist.current = [exposureOf(dep.state)];
        epochMarks.current = [{ day: dep.state.day, epoch: dep.state.epoch }];
        ledger.current.unshift({ day: 0, kind: "deposit", amount });
        pushEvents(dep.events);
        riskRef.current = computeRisk(dep.state);
        optRef.current = optimizerWeights(dep.state);
        setSnap(snapshot());
      } else {
        depositedRef.current += amount;
        ledger.current.unshift({ day: s.day, kind: "deposit", amount });
        apply((st, p) => addCapital(st, amount, p));
      }
    },
    [apply, pushEvents, snapshot],
  );

  /** Console command parser → engine operations. */
  const command = useCallback(
    (raw: string): void => {
      const [cmd, arg] = raw.trim().toLowerCase().split(/\s+/);
      const n = Number(arg);
      switch (cmd) {
        case "add":
        case "deposit":
          if (n > 0) deposit(n);
          break;
        case "redeem":
          if (n > 0) apply((s, p) => redeem(s, n, p));
          break;
        case "rebalance":
          apply((s, p) => forceRebalance(s, p));
          break;
        case "harvest":
          apply((s, p) => forceHarvest(s, p));
          break;
        case "shock":
          if (Number.isFinite(n)) apply((s, p) => shock(s, n / 100, p));
          break;
        case "run":
          setRunning(true);
          break;
        case "pause":
          setRunning(false);
          break;
        case "reset":
          reset(config);
          break;
        case "redeploy":
        case "relaunch": {
          const s = stateRef.current;
          if (s) {
            const cash = Math.max(s.navPerShare * s.shares, 0);
            const freshAssets: BasketAsset[] = s.assets.map((a) => ({ ...a }));
            const dep = deploy(createState(freshAssets), cash, paramsRef.current);
            dep.state.day = s.day;
            stateRef.current = dep.state;
            epochMarks.current.push({ day: dep.state.day, epoch: dep.state.epoch });
            events.current.unshift({ id: eid.current++, day: dep.state.day, text: `REDEPLOY · ${cash.toFixed(0)} recovered capital`, cls: "cyan" });
            pushEvents(dep.events);
            riskRef.current = computeRisk(dep.state);
            optRef.current = optimizerWeights(dep.state);
            setSnap(snapshot());
          }
          break;
        }
        case "clear":
          events.current = [];
          setSnap(snapshot());
          break;
        default:
          events.current.unshift({ id: eid.current++, day: stateRef.current?.day ?? 0, text: `unknown: ${raw}`, cls: "red" });
          setSnap(snapshot());
      }
    },
    [apply, config, reset, snapshot, deposit],
  );

  /** Relaunch after a wind-down: redeploy the recovered cash as fresh capital. */
  const redeploy = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    const cash = Math.max(s.navPerShare * s.shares, 0);
    if (cash <= 0) {
      reset(config);
      return;
    }
    const freshAssets: BasketAsset[] = s.assets.map((a) => ({ ...a })); // keep current spots + selection
    const dep = deploy(createState(freshAssets), cash, paramsRef.current);
    const st = dep.state;
    st.day = s.day; // preserve the clock
    stateRef.current = st;
    recordSeries();
    epochMarks.current.push({ day: st.day, epoch: st.epoch });
    events.current.unshift({ id: eid.current++, day: st.day, text: `REDEPLOY · ${cash.toFixed(0)} recovered capital`, cls: "cyan" });
    pushEvents(dep.events);
    riskRef.current = computeRisk(st);
    optRef.current = optimizerWeights(st);
    setSnap(snapshot());
  }, [pushEvents, snapshot, recordSeries, reset, config]);

  return {
    snap,
    config,
    running,
    setConfig,
    setRunning,
    reset: () => reset(config),
    redeploy,
    command,
    addCapital: deposit,
    redeemShares: (sh: number) => apply((s, p) => redeem(s, sh, p)),
    rebalance: () => apply((s, p) => forceRebalance(s, p)),
    harvest: () => apply((s, p) => forceHarvest(s, p)),
    shockBasket: (pct: number) => apply((s, p) => shock(s, pct, p)),
  };
}
