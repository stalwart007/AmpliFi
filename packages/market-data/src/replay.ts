/* =============================================================================
 * @amplifi/market-data / replay
 * -----------------------------------------------------------------------------
 * Replays recorded history through the FeedAdapter interface so a backtest runs
 * the exact code path a live deployment would, just fed from a file instead of a
 * socket. Includes a tolerant CSV parser (ts + one column per symbol).
 * ===========================================================================*/

import type { Bar, FeedAdapter, Snapshot } from "./types";

/** Parse a wide CSV: header `ts,BTC,ETH,...`; rows of unix-ms + close prices. */
export function parseWideCsv(csv: string): {
  symbols: string[];
  rows: { ts: number; prices: Record<string, number> }[];
} {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV needs a header and at least one row");
  const header = lines[0].split(",").map((h) => h.trim());
  if (header[0].toLowerCase() !== "ts") throw new Error("first column must be 'ts'");
  const symbols = header.slice(1);
  const rows = lines.slice(1).map((line, idx) => {
    const cells = line.split(",");
    if (cells.length !== header.length) throw new Error(`row ${idx + 1}: expected ${header.length} columns`);
    const ts = Number(cells[0]);
    if (!Number.isFinite(ts)) throw new Error(`row ${idx + 1}: bad ts`);
    const prices: Record<string, number> = {};
    symbols.forEach((s, i) => {
      const v = Number(cells[i + 1]);
      if (!Number.isFinite(v)) throw new Error(`row ${idx + 1}: bad price for ${s}`);
      prices[s] = v;
    });
    return { ts, prices };
  });
  return { symbols, rows };
}

/** A finite feed that walks recorded snapshots in order. */
export class ReplayFeed implements FeedAdapter {
  readonly symbols: string[];
  private cursor = 0;
  constructor(
    symbols: string[],
    private readonly frames: { ts: number; prices: Snapshot }[],
  ) {
    if (frames.length === 0) throw new Error("ReplayFeed needs ≥1 frame");
    this.symbols = [...symbols];
  }

  static fromCsv(csv: string): ReplayFeed {
    const { symbols, rows } = parseWideCsv(csv);
    return new ReplayFeed(
      symbols,
      rows.map((r) => ({ ts: r.ts, prices: r.prices })),
    );
  }

  snapshot(): Snapshot {
    return { ...this.frames[Math.min(this.cursor, this.frames.length - 1)].prices };
  }

  next(): Snapshot | null {
    if (this.cursor >= this.frames.length - 1) return null;
    this.cursor += 1;
    return { ...this.frames[this.cursor].prices };
  }

  reset(): void {
    this.cursor = 0;
  }
}

/** Aggregate a stream of intraday ticks into OHLC bars of `bucketMs`. */
export function ticksToBars(ticks: { sym: string; ts: number; price: number }[], bucketMs: number): Bar[] {
  const bars = new Map<string, Bar>();
  const out: Bar[] = [];
  for (const t of ticks) {
    const bucket = Math.floor(t.ts / bucketMs) * bucketMs;
    const key = `${t.sym}@${bucket}`;
    const existing = bars.get(key);
    if (!existing) {
      const bar: Bar = { sym: t.sym, ts: bucket, open: t.price, high: t.price, low: t.price, close: t.price };
      bars.set(key, bar);
      out.push(bar);
    } else {
      existing.high = Math.max(existing.high, t.price);
      existing.low = Math.min(existing.low, t.price);
      existing.close = t.price;
    }
  }
  return out;
}
