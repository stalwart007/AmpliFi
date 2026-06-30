/* =============================================================================
 * AmpliFi terminal — interactive visualization primitives
 * -----------------------------------------------------------------------------
 * Dependency-free SVG charts with real interactivity: a hero time-series chart
 * with a crosshair + live tooltip + metric switcher, and hover-aware donut,
 * heatmap and histogram. Colours come from CSS custom properties on :root.
 * ===========================================================================*/

import { useMemo, useRef, useState } from "react";

const PAD = 6;

function extent(xs: number[], extra?: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (extra !== undefined) {
    lo = Math.min(lo, extra);
    hi = Math.max(hi, extra);
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/* ---- formatting ---- */
export function fmtUsd(n: number, dp = 0): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(dp > 0 ? dp : 1)}k`;
  return `$${n.toFixed(dp)}`;
}
export function fmtNum(n: number, dp = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtPct(n: number, dp = 1): string {
  return `${(n * 100).toFixed(dp)}%`;
}

/* ───────────────────────── HeroChart ──────────────────────────────────────
 * The dashboard centrepiece. Multiple series, one shown at a time via a chip
 * switcher; a crosshair follows the cursor and a tooltip reports every series'
 * value at the hovered step. ─────────────────────────────────────────────── */

export interface HeroSeries {
  key: string;
  label: string;
  color: string;
  data: number[];
  fmt: (n: number) => string;
  baseline?: number;
}

export function HeroChart({ series, marks = [], height = 300 }: { series: HeroSeries[]; marks?: number[]; height?: number }) {
  const [active, setActive] = useState(series[0]?.key ?? "");
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const cur = series.find((s) => s.key === active) ?? series[0];
  const W = 1000;
  const H = height;
  const PADX = 10;
  const PADT = 14;
  const PADB = 10;

  const geom = useMemo(() => {
    if (!cur || cur.data.length < 2) return null;
    const data = cur.data;
    const n = data.length;
    const [lo, hi] = extent(data, cur.baseline);
    const X = (i: number) => PADX + (i * (W - 2 * PADX)) / (n - 1);
    const Y = (v: number) => H - PADB - ((v - lo) * (H - PADT - PADB)) / (hi - lo);
    const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${X(n - 1).toFixed(1)},${H - PADB} L${X(0).toFixed(1)},${H - PADB} Z`;
    return { data, n, lo, hi, X, Y, line, area };
  }, [cur, H]);

  if (!geom || !cur) return <div className="chart-empty">awaiting data…</div>;

  const onMove = (e: React.MouseEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHover(Math.round(frac * (geom.n - 1)));
  };

  const hx = hover !== null ? geom.X(hover) : 0;
  const tipLeft = hover !== null ? `${(geom.X(hover) / W) * 100}%` : "0";
  const last = geom.data[geom.data.length - 1];
  const first = geom.data[0];
  const chg = first !== 0 ? (last - first) / Math.abs(first) : 0;

  return (
    <div className="hero-chart">
      <div className="hero-head">
        <div className="hero-readout">
          <span className="hero-val" style={{ color: cur.color }}>
            {cur.fmt(hover !== null ? geom.data[hover] : last)}
          </span>
          <span className={`hero-chg ${chg >= 0 ? "pos" : "neg"}`}>
            {chg >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(chg), 1)}
          </span>
        </div>
        <div className="hero-chips">
          {series.map((s) => (
            <button key={s.key} className={`hero-chip ${s.key === active ? "on" : ""}`} onClick={() => setActive(s.key)} style={s.key === active ? { borderColor: s.color, color: s.color } : undefined}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hero-plot" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
          <defs>
            <linearGradient id={`grad-${cur.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cur.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={cur.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={PADX} x2={W - PADX} y1={H * g} y2={H * g} className="grid" />
          ))}
          {marks.map((m, i) => (
            <line key={i} x1={geom.X(m)} x2={geom.X(m)} y1={PADT} y2={H - PADB} className="epoch-mark" />
          ))}
          {cur.baseline !== undefined && <line x1={PADX} x2={W - PADX} y1={geom.Y(cur.baseline)} y2={geom.Y(cur.baseline)} className="baseline" />}
          <path d={geom.area} fill={`url(#grad-${cur.key})`} />
          <path d={geom.line} fill="none" stroke={cur.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {hover !== null && (
            <>
              <line x1={hx} x2={hx} y1={PADT} y2={H - PADB} className="crosshair" />
              <circle cx={hx} cy={geom.Y(geom.data[hover])} r={4} fill={cur.color} stroke="var(--bg)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hover !== null && (
          <div className="cross-tip" style={{ left: tipLeft }}>
            <div className="tip-step">step {hover}</div>
            {series.map((s) => (
              <div key={s.key} className="tip-row">
                <span className="tip-dot" style={{ background: s.color }} />
                <span className="tip-label">{s.label}</span>
                <span className="tip-val">{s.data[hover] !== undefined ? s.fmt(s.data[hover]) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Sparkline ──────────────────────────────────────*/
export function Sparkline({ data, w = 120, h = 26, color = "var(--cyan)" }: { data: number[]; w?: number; h?: number; color?: string }) {
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const [lo, hi] = extent(data);
    const sx = (w - PAD * 2) / (data.length - 1);
    const sy = (h - PAD * 2) / (hi - lo);
    return data.map((v, i) => `${i === 0 ? "M" : "L"}${(PAD + i * sx).toFixed(1)},${(h - PAD - (v - lo) * sy).toFixed(1)}`).join(" ");
  }, [data, w, h]);
  return (
    <svg width={w} height={h} className="spark">
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

/* ───────────────────────── DrawdownChart ──────────────────────────────────*/
export function DrawdownChart({ data, w = 520, h = 110 }: { data: number[]; w?: number; h?: number }) {
  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const lo = Math.min(-0.001, ...data);
    const sx = (w - PAD * 2) / (data.length - 1);
    const sy = (h - PAD * 2) / (0 - lo);
    const X = (i: number) => PAD + i * sx;
    const Y = (v: number) => PAD + (0 - v) * sy;
    const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${X(data.length - 1).toFixed(1)},${PAD} L${X(0).toFixed(1)},${PAD} Z`;
    return { area, line };
  }, [data, w, h]);
  if (!geom) return <div className="chart-empty">awaiting data…</div>;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none">
      <path d={geom.area} fill="var(--red)" opacity={0.16} />
      <path d={geom.line} fill="none" stroke="var(--red)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ───────────────────────── Histogram (hover) ──────────────────────────────*/
export function Histogram({ data, bins = 33, w = 520, h = 150, varLine }: { data: number[]; bins?: number; w?: number; h?: number; varLine?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const geom = useMemo(() => {
    if (data.length < 4) return null;
    const [lo, hiV] = extent(data);
    const width = (hiV - lo) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of data) {
      const k = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
      counts[k]++;
    }
    const maxC = Math.max(...counts);
    const bw = (w - PAD * 2) / bins;
    const bars = counts.map((c, i) => {
      const bh = (c / maxC) * (h - PAD * 2);
      const center = lo + (i + 0.5) * width;
      return { x: PAD + i * bw, y: h - PAD - bh, bw: bw - 1, bh, neg: center < 0, count: c, center };
    });
    const vx = varLine !== undefined ? PAD + ((-varLine - lo) / (hiV - lo)) * (w - PAD * 2) : null;
    return { bars, vx };
  }, [data, bins, w, h, varLine]);
  if (!geom) return <div className="chart-empty">awaiting paths…</div>;
  return (
    <div className="hist-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none">
        {geom.bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={Math.max(0.5, b.bw)}
            height={b.bh}
            fill={b.neg ? "var(--red)" : "var(--green)"}
            opacity={hi === null || hi === i ? 0.7 : 0.32}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(null)}
          />
        ))}
        {geom.vx !== null && <line x1={geom.vx} x2={geom.vx} y1={PAD} y2={h - PAD} className="var-line" />}
      </svg>
      {hi !== null && (
        <div className="hist-tip">
          P&L ≈ {fmtUsd(geom.bars[hi].center)} · {geom.bars[hi].count} paths
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Donut (hover) ──────────────────────────────────*/
export function Donut({ slices, size = 176, thickness = 28, defaultCenter }: { slices: { label: string; value: number; color: string; sub?: string }[]; size?: number; thickness?: number; defaultCenter?: { top: string; bottom: string } }) {
  const [hi, setHi] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = size / 2;
  const r = R - thickness;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${(R + rad * Math.cos(ang)).toFixed(2)},${(R + rad * Math.sin(ang)).toFixed(2)}`;
    return { d: `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`, color: s.color };
  });
  const center = hi !== null ? { top: fmtPct(slices[hi].value / total, 1), bottom: slices[hi].label } : (defaultCenter ?? { top: `${slices.length}`, bottom: "legs" });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut">
      {arcs.map((a, i) => (
        <path
          key={i}
          d={a.d}
          fill={a.color}
          opacity={hi === null || hi === i ? 0.9 : 0.4}
          transform={hi === i ? `translate(${size / 2} ${size / 2}) scale(1.04) translate(${-size / 2} ${-size / 2})` : undefined}
          onMouseEnter={() => setHi(i)}
          onMouseLeave={() => setHi(null)}
          style={{ transition: "opacity .12s" }}
        />
      ))}
      <text x={R} y={R - 3} className="donut-center-top" textAnchor="middle">
        {center.top}
      </text>
      <text x={R} y={R + 16} className="donut-center-bot" textAnchor="middle">
        {center.bottom}
      </text>
    </svg>
  );
}

/* ───────────────────────── Heatmap (hover) ────────────────────────────────*/
export function Heatmap({ syms, matrix, size = 230 }: { syms: string[]; matrix: number[][]; size?: number }) {
  const [cell, setCell] = useState<[number, number] | null>(null);
  const n = syms.length;
  if (n === 0) return null;
  const grid = size - 30;
  const c = grid / n;
  const color = (v: number) => {
    const t = (v + 1) / 2;
    const r = Math.round(40 + t * 200);
    const b = Math.round(240 - t * 200);
    const g = Math.round(70 + (1 - Math.abs(v)) * 80);
    return `rgb(${r},${g},${b})`;
  };
  return (
    <div className="heat-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="heatmap">
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <rect
              key={`${i}-${j}`}
              x={30 + j * c}
              y={20 + i * c}
              width={c - 1}
              height={c - 1}
              fill={color(v)}
              opacity={cell === null || (cell[0] === i || cell[1] === j) ? 0.88 : 0.4}
              stroke={cell && cell[0] === i && cell[1] === j ? "var(--text)" : "none"}
              strokeWidth={1}
              onMouseEnter={() => setCell([i, j])}
              onMouseLeave={() => setCell(null)}
            />
          )),
        )}
        {syms.map((s, i) => (
          <text key={`r${i}`} x={26} y={20 + i * c + c / 2 + 3} className="heat-axis" textAnchor="end">
            {s}
          </text>
        ))}
        {syms.map((s, j) => (
          <text key={`c${j}`} x={30 + j * c + c / 2} y={15} className="heat-axis" textAnchor="middle">
            {s}
          </text>
        ))}
      </svg>
      <div className="heat-cap">{cell ? `${syms[cell[0]]} × ${syms[cell[1]]} = ${matrix[cell[0]][cell[1]].toFixed(2)}` : "hover a cell"}</div>
    </div>
  );
}

/* ───────────────────────── Gauge ──────────────────────────────────────────*/
export function Gauge({ value, max, label, unit = "", color = "var(--amber)", size = 124 }: { value: number; max: number; label: string; unit?: string; color?: string; size?: number }) {
  const frac = Math.max(0, Math.min(1, value / (max || 1)));
  const R = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const arc = (from: number, to: number) => {
    const large = to - from > Math.PI ? 1 : 0;
    return `M${cx + R * Math.cos(from)},${cy + R * Math.sin(from)} A${R},${R} 0 ${large} 1 ${cx + R * Math.cos(to)},${cy + R * Math.sin(to)}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size * 0.72}`} className="gauge">
      <path d={arc(Math.PI, Math.PI * 2)} fill="none" stroke="var(--grid)" strokeWidth={8} strokeLinecap="round" />
      <path d={arc(Math.PI, Math.PI + frac * Math.PI)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" style={{ transition: "all .25s" }} />
      <text x={cx} y={cy - 6} className="gauge-val" textAnchor="middle">
        {value < 1000 ? value.toFixed(value < 10 ? 2 : 0) : fmtUsd(value)}
        {unit}
      </text>
      <text x={cx} y={cy + 10} className="gauge-label" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}

/* ───────────────────────── StackedBar / HBars ─────────────────────────────*/
export function StackedBar({ segments, h = 30 }: { segments: { label: string; value: number; color: string }[]; w?: number; h?: number }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="stacked2" style={{ height: h }}>
      {segments.map((s, i) => (
        <div key={i} className="stacked2-seg" style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }} title={`${s.label}: ${fmtUsd(s.value)}`} />
      ))}
    </div>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number; color?: string }[]; w?: number }) {
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar-row">
          <span className="hbar-label">{r.label}</span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "var(--cyan)" }} />
          </div>
          <span className="hbar-val">{fmtPct(r.value, 1)}</span>
        </div>
      ))}
    </div>
  );
}
