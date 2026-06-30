/* =============================================================================
 * AmpliFi — application shell
 * -----------------------------------------------------------------------------
 *   Landing  →  Access gate (connect wallet + allowlist)  →  Terminal
 *
 * The terminal is a panel-OS: a Controls / Analytics / Telemetry workspace whose
 * tiles are the panels in panels.tsx, each a live view over the TimeMachine
 * engine (strategy-core + quant-core + portfolio-opt running in the browser).
 * ===========================================================================*/

import { useEffect, useMemo, useState } from "react";
import { useTimeMachine } from "./tm";
import { useWallet, shortAddr } from "./wallet";
import { PANELS, type PanelCtx, type PanelDef } from "./panels";
import { fmtUsd, fmtNum } from "./viz";

type View = "landing" | "gate" | "terminal";

export function App() {
  const [view, setView] = useState<View>("landing");
  // Wallet state lives here so a connection made in the gate persists into the
  // terminal (otherwise each screen's useWallet() would be its own instance).
  const walletApi = useWallet();
  if (view === "landing") return <Landing onLaunch={() => setView("gate")} />;
  if (view === "gate") return <Gate onEnter={() => setView("terminal")} onBack={() => setView("landing")} walletApi={walletApi} />;
  return <Terminal onExit={() => setView("landing")} wallet={walletApi.wallet} />;
}

/* ─────────────────────────────── Landing ───────────────────────────────── */

const TM_CONCEPTS: { n: number; title: string; body: string }[] = [
  { n: 1, title: "Capital Compression", body: "A deposit is not the position — it is the premium budget that finances a multiple of itself in exposure." },
  { n: 2, title: "Exposure Engine", body: "A risk-parity / ERC basket of long perpetual options manufactures dollar-delta notional far above the capital base." },
  { n: 3, title: "Profit Engine", body: "Epoch checkpoints fold realised profit back into the capital base, compounding the compression." },
  { n: 4, title: "Automatic Rebalancing", body: "Delta-band hedging keeps the basket centred; scheduled re-strikes reset the book to ATM." },
  { n: 5, title: "Recursive Growth", body: "As the capital base compounds, the exposure rescales with it — growth feeds the engine that produces growth." },
  { n: 6, title: "Whole-Basket Liquidation", body: "There is no per-asset liquidation. The book winds down only if the entire portfolio breaches its floor." },
  { n: 7, title: "Buffer Layers", body: "A realised reserve is skimmed each epoch and never put at risk, absorbing drawdowns before the floor." },
  { n: 8, title: "Epoch Reset", body: "Each epoch recomputes exposure on the new capital base and re-seeds the high-water mark." },
  { n: 9, title: "Rules-Only Risk", body: "Every action is a deterministic rule a keeper and the UI compute identically — no discretion, no divergence." },
];

function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing">
      <nav className="land-nav">
        <div className="brand">
          <span className="logo">◆</span> AmpliFi
        </div>
        <div className="land-nav-links">
          <a href="#engine">Engine</a>
          <a href="#concepts">TimeMachine</a>
          <a href="#security">Security</a>
          <button className="launch-btn small" onClick={onLaunch}>
            Launch Terminal →
          </button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-glow" />
        <div className="hero-badge">PERMISSIONED · TESTNET-GRADE · AUDIT-PENDING</div>
        <h1>
          Leveraged exposure,
          <br />
          <span className="grad">capped downside.</span>
        </h1>
        <p className="hero-sub">
          AmpliFi compresses a capital deposit into a multiple of synthetic index exposure through a basket of long perpetual options —
          amplifying upside while the maximum loss stays bounded by the premium. Powered by the TimeMachine economic engine.
        </p>
        <div className="hero-cta">
          <button className="launch-btn" onClick={onLaunch}>
            Launch Terminal →
          </button>
          <a className="ghost-btn" href="#concepts">
            How it works
          </a>
        </div>
        <div className="hero-stats">
          <div>
            <b>9</b>
            <span>engine concepts</span>
          </div>
          <div>
            <b>≤ premium</b>
            <span>max loss</span>
          </div>
          <div>
            <b>full-reval</b>
            <span>Monte-Carlo VaR</span>
          </div>
          <div>
            <b>on-chain</b>
            <span>allowlist gating</span>
          </div>
        </div>
      </header>

      <section id="engine" className="land-section">
        <h2>One engine, three surfaces</h2>
        <p className="section-lead">
          The simulator you are about to open, the off-chain keeper, and the on-chain vault all drive the <em>same</em> deterministic
          strategy machine. What you see is what the protocol does.
        </p>
        <div className="feature-grid">
          <Feature icon="◈" title="quant-core" body="Black-Scholes greeks, SVI surface, Heston, barriers, exotics, and full-revaluation Monte-Carlo VaR / ES — dependency-free and deterministic." />
          <Feature icon="⟁" title="strategy-core" body="Capital compression, ERC basket construction, delta-band hedging, epoch compounding, and portfolio-level wind-down as a pure state machine." />
          <Feature icon="⛁" title="contracts" body="ERC-4626 vault minting/burning AFI shares, RiskController, timelock + multisig governance, withdrawal queue, oracle-hardened venue, and an allowlist gate." />
        </div>
      </section>

      <section id="concepts" className="land-section">
        <h2>The TimeMachine engine</h2>
        <p className="section-lead">Nine concepts turn a static deposit into a self-compounding, capped-downside exposure machine.</p>
        <div className="concept-grid">
          {TM_CONCEPTS.map((c) => (
            <div key={c.n} className="concept-card">
              <span className="concept-n">{String(c.n).padStart(2, "0")}</span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="security" className="land-section security">
        <h2>Permissioned by design</h2>
        <p className="section-lead">
          Access is gated to allowlisted operator wallets. Deposits route to the vault and mint AFI shares; withdrawals burn them. Governance
          sits behind a timelock + multisig, and the venue mark is oracle-hardened against manipulation.
        </p>
        <div className="sec-row">
          <span className="pill">allowlist gate</span>
          <span className="pill">timelock governance</span>
          <span className="pill">m-of-n multisig</span>
          <span className="pill">oracle staleness + deviation guards</span>
          <span className="pill">reentrancy-guarded</span>
          <span className="pill">withdrawal queue</span>
        </div>
        <div className="disclaimer">
          Research prototype. The contracts are written to production standards but are <strong>not yet independently audited</strong> — do not
          custody real funds until the external audit and live-venue integration are complete.
        </div>
      </section>

      <footer className="land-foot">
        <span>◆ AmpliFi</span>
        <button className="launch-btn small" onClick={onLaunch}>
          Launch Terminal →
        </button>
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="feature">
      <span className="feature-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

/* ───────────────────────────────── Gate ────────────────────────────────── */

function Gate({ onEnter, onBack, walletApi }: { onEnter: () => void; onBack: () => void; walletApi: ReturnType<typeof useWallet> }) {
  const { wallet, connect, submitAccessCode, signIn } = walletApi;
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (wallet.status === "connected" && wallet.allowed) {
      const t = window.setTimeout(onEnter, 600);
      return () => window.clearTimeout(t);
    }
  }, [wallet.status, wallet.allowed, onEnter]);

  const tryCode = () => {
    if (!submitAccessCode(code)) setErr("Invalid passphrase.");
    else setErr("");
  };

  return (
    <div className="gate">
      <button className="gate-back" onClick={onBack}>
        ← back
      </button>
      <div className="gate-card">
        <div className="brand big">
          <span className="logo">◆</span> AmpliFi
        </div>
        <h2>Operator access</h2>
        <p className="gate-lead">Connect an allowlisted wallet to enter the terminal. This protocol is permissioned.</p>

        {wallet.status === "disconnected" && (
          <div className="gate-denied">
            <button className="launch-btn full" onClick={connect}>
              Connect Wallet
            </button>
            <div className="gate-or">or operator passphrase</div>
            <div className="code-row">
              <input className="io-input" placeholder="operator passphrase" value={code} onChange={(e) => setCode(e.target.value)} type="password" />
              <button className="op-btn primary" onClick={tryCode}>
                Unlock
              </button>
            </div>
            {err && <div className="gate-err">{err}</div>}
          </div>
        )}
        {wallet.status === "connecting" && <div className="gate-status">Requesting accounts…</div>}

        {wallet.status === "unsigned" && (
          <div className="gate-denied">
            <div className="gate-status">
              <span className="dot green" /> {wallet.address ? shortAddr(wallet.address) : ""} · allowlisted
            </div>
            <button className="launch-btn full" onClick={signIn}>
              Sign in with wallet
            </button>
            <div className="gate-hint">{wallet.message}</div>
          </div>
        )}

        {wallet.status === "connected" && wallet.allowed && (
          <div className="gate-ok">
            <span className="dot green" /> {wallet.message}. Entering terminal…
          </div>
        )}

        {wallet.status === "denied" && (
          <div className="gate-denied">
            <div className="gate-status red">
              <span className="dot red" /> {wallet.message}
            </div>
            <div className="code-row">
              <input className="io-input" placeholder="operator passphrase" value={code} onChange={(e) => setCode(e.target.value)} type="password" />
              <button className="op-btn primary" onClick={tryCode}>
                Unlock
              </button>
            </div>
            {err && <div className="gate-err">{err}</div>}
            {!walletApi.hasInjected && <div className="gate-hint">No browser wallet detected — the operator passphrase is amplifi-operator.</div>}
          </div>
        )}

        <div className="gate-foot">
          Multi-wallet connection via <code>RainbowKit</code> + <code>wagmi</code>; allowlisted wallets prove ownership with a sign-in
          signature. Access is enforced on-chain by <code>AllowlistGate</code> — this screen mirrors it.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Terminal ──────────────────────────────── */

function Terminal({ onExit, wallet }: { onExit: () => void; wallet: ReturnType<typeof useWallet>["wallet"] }) {
  const tm = useTimeMachine();
  const [booted, setBooted] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = window.setTimeout(() => setBooted(true), 1300);
    return () => window.clearTimeout(t);
  }, []);

  // spacebar toggles the engine clock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        tm.setRunning(!tm.running);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tm]);

  const ctx: PanelCtx | null = useMemo(() => {
    if (!tm.snap) return null;
    return {
      snap: tm.snap,
      config: tm.config,
      running: tm.running,
      setConfig: tm.setConfig,
      setRunning: tm.setRunning,
      reset: tm.reset,
      redeploy: tm.redeploy,
      command: tm.command,
      addCapital: tm.addCapital,
      redeemShares: tm.redeemShares,
      rebalance: tm.rebalance,
      harvest: tm.harvest,
      shockBasket: tm.shockBasket,
      wallet,
    };
  }, [tm, wallet]);

  if (!booted || !ctx) return <Boot />;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const region = (r: PanelDef["region"]) => PANELS.filter((p) => p.region === r);
  const s = ctx.snap;
  const navPct = (s.navPerShare - 1) * 100;

  return (
    <div className={`terminal ${density}`}>
      <header className="topbar">
        <div className="brand" onClick={onExit} role="button" title="back to landing">
          <span className="logo">◆</span> AmpliFi <span className="tag">Terminal</span>
        </div>
        <div className="kpi-strip">
          <Kpi label="Capital" value={fmtUsd(s.capital)} />
          <Kpi label="Exposure" value={fmtUsd(s.exposure)} tone="cyan" />
          <Kpi label="Leverage" value={`${s.leverage.toFixed(2)}×`} tone="violet" />
          <Kpi label="NAV" value={fmtNum(s.navPerShare, 4)} tone={navPct >= 0 ? "pos" : "neg"} />
          <Kpi label="Return" value={`${navPct >= 0 ? "+" : ""}${navPct.toFixed(1)}%`} tone={navPct >= 0 ? "pos" : "neg"} />
          <Kpi label="Reserve" value={fmtUsd(s.reserve)} tone="green" />
          <Kpi label="VaR95" value={s.risk ? fmtUsd(s.risk.var95) : "—"} tone="neg" />
          <Kpi label="Sharpe" value={fmtNum(s.metrics.sharpe, 2)} />
        </div>
        <div className="topbar-right">
          <span className={`pill ${s.closed ? "red" : tm.running ? "green" : "muted"}`}>{s.closed ? "WOUND DOWN" : tm.running ? `LIVE · d${s.day}` : `PAUSED · d${s.day}`}</span>
          <button className="dense-btn" onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}>
            {density === "comfortable" ? "▦" : "▤"}
          </button>
          <span className="wallet-pill">{wallet.address ? wallet.address.slice(0, 6) + "…" + wallet.address.slice(-4) : "—"}</span>
        </div>
      </header>

      <div className="workspace">
        <Region label="CONTROLS" panels={region("left")} ctx={ctx} collapsed={collapsed} toggle={toggle} />
        <Region label="ANALYTICS" panels={region("center")} ctx={ctx} collapsed={collapsed} toggle={toggle} className="center" />
        <Region label="TELEMETRY" panels={region("right")} ctx={ctx} collapsed={collapsed} toggle={toggle} />
      </div>
    </div>
  );
}

function Region({ label, panels, ctx, collapsed, toggle, className }: { label: string; panels: PanelDef[]; ctx: PanelCtx; collapsed: Set<string>; toggle: (id: string) => void; className?: string }) {
  return (
    <div className={`region ${className ?? ""}`}>
      <div className="region-label">{label}</div>
      {panels.map((p) => (
        <PanelShell key={p.id} def={p} ctx={ctx} collapsed={collapsed.has(p.id)} onToggle={() => toggle(p.id)} />
      ))}
    </div>
  );
}

function PanelShell({ def, ctx, collapsed, onToggle }: { def: PanelDef; ctx: PanelCtx; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className={`panel ${def.wide ? "wide" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="panel-head" onClick={onToggle}>
        <span className="panel-title">{def.title}</span>
        <span className="panel-toggle">{collapsed ? "+" : "–"}</span>
      </div>
      {!collapsed && def.render(ctx)}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Boot() {
  return (
    <div className="boot">
      <div className="boot-logo">◆</div>
      <div className="boot-title">AmpliFi Terminal</div>
      <div className="boot-bar">
        <div className="boot-fill" />
      </div>
      <div className="boot-lines">
        <span>booting quant-core…</span>
        <span>warming strategy-core state machine…</span>
        <span>calibrating risk surface…</span>
      </div>
    </div>
  );
}
