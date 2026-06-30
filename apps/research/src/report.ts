/* Plain-text table formatting for backtest results — readable in any terminal. */
import type { BacktestResult } from "./backtest";

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

export function formatTable(results: BacktestResult[]): string {
  const cols = [
    ["scenario", 22],
    ["finalNAV", 9],
    ["CAGR%", 8],
    ["Sharpe", 7],
    ["Sortino", 8],
    ["maxDD%", 8],
    ["Calmar", 7],
    ["rolls", 6],
    ["cost", 7],
    ["status", 8],
  ] as const;
  const head = cols.map(([h, w]) => pad(h, w)).join(" ");
  const sep = cols.map(([, w]) => "─".repeat(w)).join(" ");
  const rows = results.map((r) => {
    const p = r.report;
    return [
      pad(r.scenario, 22),
      padL(p.finalNav.toFixed(3), 9),
      padL((p.cagr * 100).toFixed(1), 8),
      padL(Number.isFinite(p.sharpe) ? p.sharpe.toFixed(2) : "∞", 7),
      padL(Number.isFinite(p.sortino) ? p.sortino.toFixed(2) : "∞", 8),
      padL((p.maxDrawdown * 100).toFixed(1), 8),
      padL(Number.isFinite(p.calmar) ? p.calmar.toFixed(2) : "∞", 7),
      padL(String(p.restrikes), 6),
      padL(p.totalCost.toFixed(1), 7),
      pad(r.closed ? "WOUND" : "open", 8),
    ].join(" ");
  });
  return [head, sep, ...rows].join("\n");
}
