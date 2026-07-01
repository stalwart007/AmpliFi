/* =============================================================================
 * AmpliFi terminal — panel library
 * -----------------------------------------------------------------------------
 * Fewer, richer panels with a clear hierarchy: a dominant interactive HeroChart
 * in the centre, grouped tabbed panels (Structure / Risk / Activity) on the
 * sides, and a compact control deck. Every panel is a live view over the
 * TimeMachine Snapshot; none touch the engine directly.
 * ===========================================================================*/

import { useState } from "react";
import type { Snapshot, TMConfig } from "./tm";
import { UNIVERSE } from "./tm";
import type { WalletState } from "./wallet";
import { VAULT_ADDRESS, AFI_TOKEN_ADDRESS, shortAddr } from "./wallet";
import { HeroChart, DrawdownChart, Histogram, Donut, Heatmap, Gauge, StackedBar, HBars, Sparkline, fmtUsd, fmtNum, fmtPct, type HeroSeries } from "./viz";
import { MarketsPanel } from "./markets";
import { LiveVaultPanel } from "./livePanel";

export interface PanelCtx {
  snap: Snapshot;
  config: TMConfig;
  running: boolean;
  setConfig: (updater: (c: TMConfig) => TMConfig) => void;
  setRunning: (b: boolean) => void;
  reset: () => void;
  redeploy: () => void;
  command: (s: string) => void;
  addCapital: (n: number) => void;
  redeemShares: (n: number) => void;
  rebalance: () => void;
  harvest: () => void;
  shockBasket: (p: number) => void;
  wallet: WalletState;
}

export const ASSET_COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#6ea8ff",
  SOL: "#14f195",
  BNB: "#f3ba2f",
  GOLD: "#ffd166",
  NDX: "#b98cff",
  OIL: "#8d99ae",
  AVAX: "#e84142",
};
const colorOf = (sym: string) => ASSET_COLORS[sym] ?? "#36d6c3";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Reusable in-panel tabs. Each tab renders a component so hooks are safe. */
function Tabs({ tabs }: { tabs: { id: string; label: string; node: JSX.Element }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const cur = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tab-bar">
        {tabs.map((t) => (
          <button key={t.id} className={`tab-btn ${t.id === active ? "on" : ""}`} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body">{cur.node}</div>
    </div>
  );
}

/* ════════════════════ CENTRE: hero + compression ════════════════════ */

function HeroPanel({ c }: { c: PanelCtx }) {
  const s = c.snap;
  const marks = s.epochMarks.map((m) => Math.max(0, Math.min(s.navHistory.length - 1, m.day))).filter((d, i, a) => a.indexOf(d) === i);
  const series: HeroSeries[] = [
    { key: "nav", label: "NAV / share", color: "var(--green)", data: s.navHistory, fmt: (v) => fmtNum(v, 4), baseline: 1 },
    { key: "exp", label: "Exposure", color: "var(--cyan)", data: s.exposureHistory, fmt: (v) => fmtUsd(v) },
    { key: "ret", label: "Return", color: "var(--violet)", data: s.navHistory.map((v) => v - 1), fmt: (v) => fmtPct(v, 1), baseline: 0 },
    { key: "dd", label: "Drawdown", color: "var(--red)", data: s.ddHistory, fmt: (v) => fmtPct(v, 1), baseline: 0 },
  ];
  return (
    <div className="panel-body">
      <HeroChart series={series} marks={marks} height={300} />
    </div>
  );
}

function CapitalEngine({ c }: { c: PanelCtx }) {
  const s = c.snap;
  const lev = s.leverage;
  const expPct = Math.min(1, s.capital > 0 ? s.exposure / (s.capital * Math.max(lev, 1)) : 0);
  return (
    <div className="panel-body">
      <div className="stat-row">
        <Stat label="Base capital" value={fmtUsd(s.capital)} sub="premium budget" />
        <Stat label="Manufactured exposure" value={fmtUsd(s.exposure)} tone="cyan" sub="dollar-delta" />
        <Stat label="Realized leverage" value={`${lev.toFixed(2)}×`} tone="violet" />
        <Stat label="Reserve" value={fmtUsd(s.reserve)} tone="green" sub="safe layer" />
      </div>
      <div className="compress">
        <div className="compress-row">
          <span className="compress-tag">CAPITAL</span>
          <div className="compress-track">
            <div className="compress-fill base" style={{ width: "16%" }} />
          </div>
          <span className="compress-amt">{fmtUsd(s.capital)}</span>
        </div>
        <div className="compress-arrow">▼ compression × {lev.toFixed(2)}</div>
        <div className="compress-row">
          <span className="compress-tag">EXPOSURE</span>
          <div className="compress-track">
            <div className="compress-fill exp" style={{ width: `${16 + expPct * 82}%`, transition: "width .4s" }} />
          </div>
          <span className="compress-amt">{fmtUsd(s.exposure)}</span>
        </div>
      </div>
      <p className="panel-note">
        Each premium dollar finances ~{lev.toFixed(1)}× of spot exposure via <strong>long perpetual options</strong>: sellers provide the
        leverage, the vault pays premium + theta, downside capped at the premium.
      </p>
    </div>
  );
}

/* ════════════════════ LEFT: control deck ════════════════════ */

function WalletPanel({ c }: { c: PanelCtx }) {
  const s = c.snap;
  const [dep, setDep] = useState(() => (c.snap.deployed ? "" : String(c.config.deposit)));
  const [wd, setWd] = useState("");
  const [copied, setCopied] = useState("");
  const depN = Number(dep) || 0;
  const wdN = Number(wd) || 0;
  const copy = (t: string, tag: string) => {
    void navigator.clipboard?.writeText(t);
    setCopied(tag);
    window.setTimeout(() => setCopied(""), 1200);
  };
  return (
    <div className="panel-body">
      <div className="wallet-id">
        <span className="dot green" />
        <span className="mono">{c.wallet.address ? shortAddr(c.wallet.address) : "—"}</span>
        {c.wallet.isDemo && <span className="tag">DEMO</span>}
      </div>
      <div className="addr-row" onClick={() => copy(VAULT_ADDRESS, "vault")}>
        <span className="addr-label">Deposit address</span>
        <span className="mono small">{shortAddr(VAULT_ADDRESS)}</span>
        <span className="copy">{copied === "vault" ? "✓" : "copy"}</span>
      </div>
      <div className="addr-row" onClick={() => copy(AFI_TOKEN_ADDRESS, "afi")}>
        <span className="addr-label">AFI token</span>
        <span className="mono small">{shortAddr(AFI_TOKEN_ADDRESS)}</span>
        <span className="copy">{copied === "afi" ? "✓" : "copy"}</span>
      </div>
      <div className="stat-row tight">
        <Stat label="AFI balance" value={fmtNum(s.shares, 2)} sub="shares" />
        <Stat label="Value" value={fmtUsd(s.capital)} tone="cyan" />
      </div>

      <div className="io-block">
        <div className="io-head">
          <span>{s.deployed ? "Deposit USDC → mint AFI" : "Initial deposit → deploy vault"}</span>
          {depN > 0 && <span className="io-preview">≈ {fmtNum(depN / s.navPerShare, 2)} AFI</span>}
        </div>
        <div className="io-row">
          <input className="io-input" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} inputMode="decimal" />
          <button
            className="op-btn primary"
            onClick={() => {
              if (depN > 0) {
                c.addCapital(depN);
                setDep("");
              }
            }}
            disabled={s.closed || !(depN > 0)}
          >
            Deposit
          </button>
        </div>
      </div>

      <div className="io-block">
        <div className="io-head">
          <span>Redeem AFI → burn for cash</span>
          <button className="io-max" onClick={() => setWd(s.shares.toFixed(4))}>
            max {fmtNum(s.shares, 2)}
          </button>
        </div>
        <div className="io-row">
          <input className="io-input" placeholder="0.00 shares" value={wd} onChange={(e) => setWd(e.target.value)} inputMode="decimal" />
          <button
            className="op-btn"
            onClick={() => {
              const burn = Math.min(wdN, s.shares);
              if (burn > 0) {
                c.redeemShares(burn);
                setWd("");
              }
            }}
            disabled={!(wdN > 0) || s.shares <= 0}
          >
            Redeem
          </button>
        </div>
        {wdN > 0 && (
          <div className="io-foot">
            ≈ {fmtUsd(Math.min(wdN, s.shares) * s.navPerShare)} out
            {wdN >= s.shares && <span className="io-warn"> · closes your entire position</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function OperationsPanel({ c }: { c: PanelCtx }) {
  const s = c.snap;
  if (!s.deployed) {
    return (
      <div className="panel-body">
        <div className="winddown-note" style={{ color: "var(--muted)" }}>
          <span className="dot amber" /> Vault is empty. Make a deposit in the Wallet panel to mint AFI and deploy the engine.
        </div>
        <button className="run-btn" disabled>
          ▶ Run engine
        </button>
        <p className="panel-note">Nothing is at risk until you deposit. Your first deposit mints AFI 1:1 at NAV 1.000 and strikes the option book.</p>
      </div>
    );
  }
  if (s.closed) {
    return (
      <div className="panel-body">
        <div className="winddown-note">
          <span className="dot red" /> Book wound down — the portfolio breached its floor and settled to {fmtUsd(s.reserve)} of recovered cash.
        </div>
        <button className="run-btn" onClick={c.redeploy}>
          ⟲ Redeploy {fmtUsd(s.reserve)}
        </button>
        <button className="op-btn" onClick={c.reset}>
          Reset to {fmtUsd(c.config.deposit)} fresh
        </button>
        <p className="panel-note">Redeploy re-strikes a fresh book on the recovered cash at current prices and re-opens the epoch. Reset starts over at the configured deposit.</p>
      </div>
    );
  }
  return (
    <div className="panel-body">
      <button className={`run-btn ${c.running ? "running" : ""}`} onClick={() => c.setRunning(!c.running)}>
        {c.running ? "❚❚ Pause engine" : "▶ Run engine"}
      </button>
      <div className="btn-grid">
        <button className="op-btn" onClick={() => c.command("rebalance")}>
          ⟳ Rebalance
        </button>
        <button className="op-btn" onClick={() => c.command("harvest")}>
          ⤓ Harvest
        </button>
        <button className="op-btn warn" onClick={() => c.shockBasket(-0.25)}>
          ⚡ −25%
        </button>
        <button className="op-btn warn" onClick={() => c.shockBasket(0.18)}>
          ⚡ +18%
        </button>
      </div>
      <div className="status-line">
        <span className={`dot ${c.running ? "green" : "amber"}`} />
        {c.running ? "live" : "idle"} · day {s.day} · epoch {s.epoch}
        <button className="reset-link" onClick={c.reset}>
          reset
        </button>
      </div>
    </div>
  );
}

function TokenSelector({ c }: { c: PanelCtx }) {
  const active = new Set(c.config.active);
  const toggle = (sym: string) => {
    const next = new Set(active);
    if (next.has(sym)) {
      if (next.size <= 2) return;
      next.delete(sym);
    } else next.add(sym);
    c.setConfig((cfg) => ({ ...cfg, active: UNIVERSE.filter((u) => next.has(u.sym)).map((u) => u.sym) }));
  };
  return (
    <div className="panel-body">
      <div className="token-grid">
        {UNIVERSE.map((u) => (
          <button key={u.sym} className={`token-chip ${active.has(u.sym) ? "on" : ""}`} onClick={() => toggle(u.sym)}>
            <span className="token-dot" style={{ background: colorOf(u.sym) }} />
            <span className="token-sym">{u.sym}</span>
            <span className="token-vol">{fmtPct(u.vol, 0)}</span>
          </button>
        ))}
      </div>
      <p className="panel-note">Pick the underlyings the exposure engine builds legs over. Changing the basket re-deploys at the current capital.</p>
    </div>
  );
}

function EngineParams({ c }: { c: PanelCtx }) {
  const cfg = c.config;
  return (
    <div className="panel-body">
      <Slider label="Drift μ" value={cfg.drift} min={-0.3} max={1.0} step={0.05} fmt={(v) => fmtPct(v, 0)} onChange={(v) => c.setConfig((p) => ({ ...p, drift: v }))} />
      <Slider label="Cost (bps)" value={cfg.costBps} min={0} max={60} step={1} fmt={(v) => v.toFixed(0)} onChange={(v) => c.setConfig((p) => ({ ...p, costBps: v }))} />
      <Slider label="Speed" value={cfg.speed} min={1} max={30} step={1} fmt={(v) => `${v.toFixed(0)}×`} onChange={(v) => c.setConfig((p) => ({ ...p, speed: v }))} />
      <div className="toggle-row">
        <Toggle label="ERC" on={cfg.useErc} onClick={() => c.setConfig((p) => ({ ...p, useErc: !p.useErc }))} />
        <Toggle label="Jumps" on={cfg.jumps} onClick={() => c.setConfig((p) => ({ ...p, jumps: !p.jumps }))} />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <span className="mono">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={onClick}>
      <span className="toggle-knob" />
      {label}
    </button>
  );
}

/* ════════════════════ RIGHT: Structure (tabs) ════════════════════ */

function BasketAllocation({ c }: { c: PanelCtx }) {
  const s = c.snap;
  const slices = s.weights.map((w) => ({ label: w.sym, value: w.w, color: colorOf(w.sym) }));
  return (
    <div className="donut-wrap">
      <Donut slices={slices} defaultCenter={{ top: `${s.weights.length}`, bottom: "legs" }} />
      <div className="legend">
        {s.weights.map((w) => (
          <div key={w.sym} className="legend-row">
            <span className="legend-dot" style={{ background: colorOf(w.sym) }} />
            <span className="legend-sym">{w.sym}</span>
            <span className="legend-w">{fmtPct(w.w, 1)}</span>
            <span className="legend-exp">{fmtUsd(w.w * s.exposure)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrelationView({ c }: { c: PanelCtx }) {
  const { syms, matrix } = c.snap.corr;
  return (
    <div className="center">
      <Heatmap syms={syms} matrix={matrix} />
    </div>
  );
}

function Optimizer({ c }: { c: PanelCtx }) {
  const o = c.snap.optimizer;
  const [mode, setMode] = useState<"minVar" | "maxSharpe" | "erc">("erc");
  if (!o) return <div className="muted pad">Need ≥2 active legs.</div>;
  const w = o[mode];
  const rows = o.syms.map((sym, i) => ({ label: sym, value: w[i], color: colorOf(sym) }));
  return (
    <div>
      <div className="seg">
        {(["erc", "minVar", "maxSharpe"] as const).map((m) => (
          <button key={m} className={`seg-btn ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
            {m === "erc" ? "ERC" : m === "minVar" ? "Min-Var" : "Max-Sharpe"}
          </button>
        ))}
      </div>
      <HBars rows={rows} />
    </div>
  );
}

function StructurePanel({ c }: { c: PanelCtx }) {
  return (
    <div className="panel-body">
      <Tabs
        tabs={[
          { id: "basket", label: "Basket", node: <BasketAllocation c={c} /> },
          { id: "corr", label: "Correlation", node: <CorrelationView c={c} /> },
          { id: "opt", label: "Optimizer", node: <Optimizer c={c} /> },
        ]}
      />
    </div>
  );
}

/* ════════════════════ RIGHT: Risk (tabs) ════════════════════ */

function MonteCarloRisk({ c }: { c: PanelCtx }) {
  const r = c.snap.risk;
  if (!r) return <div className="muted pad">Deploy capital to compute VaR…</div>;
  return (
    <div>
      <Histogram data={r.pnl} varLine={r.var95} h={150} />
      <div className="stat-row tight">
        <Stat label="VaR 95%" value={fmtUsd(r.var95)} tone="amber" sub="1-day" />
        <Stat label="ES 95%" value={fmtUsd(r.es95)} tone="red" />
        <Stat label="VaR 99%" value={fmtUsd(r.var99)} tone="red" />
      </div>
    </div>
  );
}

function RiskDials({ c }: { c: PanelCtx }) {
  const s = c.snap;
  return (
    <div className="gauges">
      <Gauge value={s.leverage} max={8} label="leverage ×" color="var(--violet)" />
      <Gauge value={s.risk ? s.risk.var95 : 0} max={Math.max(1, s.capital * 0.6)} label="1d VaR 95%" color="var(--amber)" />
      <Gauge value={Math.abs(s.metrics.maxDD) * 100} max={60} label="max DD %" color="var(--red)" />
    </div>
  );
}

function BuffersView({ c }: { c: PanelCtx }) {
  const s = c.snap;
  const floorGap = Math.max(0, s.navPerShare - s.floorNav) * s.shares;
  return (
    <div>
      <StackedBar
        segments={[
          { label: "reserve", value: s.reserve, color: "var(--green)" },
          { label: "book at risk", value: s.bookMark, color: "var(--cyan)" },
        ]}
      />
      <div className="buffer-legend">
        <span className="lg green">reserve {fmtUsd(s.reserve)}</span>
        <span className="lg cyan">book {fmtUsd(s.bookMark)}</span>
      </div>
      <div className="stat-row tight">
        <Stat label="Floor NAV" value={fmtNum(s.floorNav, 3)} tone="red" sub="wind-down" />
        <Stat label="To floor" value={fmtUsd(floorGap)} tone={floorGap > 0 ? "green" : "red"} />
      </div>
      <DrawdownChart data={s.ddHistory} h={90} />
    </div>
  );
}

function RiskPanel({ c }: { c: PanelCtx }) {
  return (
    <div className="panel-body">
      <Tabs
        tabs={[
          { id: "mc", label: "Monte-Carlo", node: <MonteCarloRisk c={c} /> },
          { id: "dials", label: "Dials", node: <RiskDials c={c} /> },
          { id: "buf", label: "Buffers", node: <BuffersView c={c} /> },
        ]}
      />
    </div>
  );
}

/* ════════════════════ RIGHT: Activity (tabs) ════════════════════ */

function Console({ c }: { c: PanelCtx }) {
  const [cmd, setCmd] = useState("");
  return (
    <div className="console">
      <div className="console-log">
        {c.snap.events.map((e) => (
          <div key={e.id} className={`log-line ${e.cls}`}>
            <span className="log-day">d{e.day}</span> {e.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cmd.trim()) {
            c.command(cmd);
            setCmd("");
          }
        }}
        className="console-input"
      >
        <span className="prompt">tm›</span>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="add 500 · redeem 10 · rebalance · shock -20 · run" spellCheck={false} />
      </form>
    </div>
  );
}

function LedgerView({ c }: { c: PanelCtx }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>day</th>
          <th>entry</th>
          <th className="num">amount</th>
        </tr>
      </thead>
      <tbody>
        {c.snap.ledger.map((r, i) => (
          <tr key={i}>
            <td className="muted">d{r.day}</td>
            <td>{r.kind}</td>
            <td className={`num ${r.amount >= 0 ? "green" : "red"}`}>{fmtUsd(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FeedView({ c }: { c: PanelCtx }) {
  const s = c.snap;
  return (
    <div className="feed">
      {s.weights.map((w) => (
        <div key={w.sym} className="feed-row">
          <span className="feed-dot" style={{ background: colorOf(w.sym) }} />
          <span className="feed-sym">{w.sym}</span>
          <span className="feed-px mono">{fmtUsd(w.spot, w.spot < 100 ? 2 : 0)}</span>
          <Sparkline data={s.navHistory.slice(-40)} w={64} h={18} color={colorOf(w.sym)} />
        </div>
      ))}
    </div>
  );
}

function ActivityPanel({ c }: { c: PanelCtx }) {
  return (
    <div className="panel-body">
      <Tabs
        tabs={[
          { id: "console", label: "Console", node: <Console c={c} /> },
          { id: "ledger", label: "Ledger", node: <LedgerView c={c} /> },
          { id: "feed", label: "Feed", node: <FeedView c={c} /> },
        ]}
      />
    </div>
  );
}

/* ════════════════════ registry ════════════════════ */

export interface PanelDef {
  id: string;
  title: string;
  region: "left" | "center" | "right";
  wide?: boolean;
  render: (c: PanelCtx) => JSX.Element;
}

export const PANELS: PanelDef[] = [
  { id: "live", title: "Live Vault (on-chain)", region: "left", render: () => <LiveVaultPanel /> },
  { id: "wallet", title: "Wallet", region: "left", render: (c) => <WalletPanel c={c} /> },
  { id: "ops", title: "Operations", region: "left", render: (c) => <OperationsPanel c={c} /> },
  { id: "tokens", title: "Exposure Universe", region: "left", render: (c) => <TokenSelector c={c} /> },
  { id: "engine", title: "Engine", region: "left", render: (c) => <EngineParams c={c} /> },
  { id: "hero", title: "Performance", region: "center", wide: true, render: (c) => <HeroPanel c={c} /> },
  { id: "capital", title: "Capital → Exposure Compression", region: "center", wide: true, render: (c) => <CapitalEngine c={c} /> },
  { id: "markets", title: "Live Markets · TradingView", region: "center", wide: true, render: (c) => <MarketsPanel syms={c.snap.weights.map((w) => w.sym)} /> },
  { id: "structure", title: "Structure", region: "right", render: (c) => <StructurePanel c={c} /> },
  { id: "risk", title: "Risk", region: "right", render: (c) => <RiskPanel c={c} /> },
  { id: "activity", title: "Activity", region: "right", render: (c) => <ActivityPanel c={c} /> },
];
