/* =============================================================================
 * @amplifi/market-data / types
 * -----------------------------------------------------------------------------
 * The normalised shapes every feed adapter emits, so downstream consumers
 * (pricing-api, risk-engine, keeper, research) are agnostic to the source —
 * synthetic, historical replay, or a live CEX/DEX/oracle connector.
 * ===========================================================================*/

/** A single normalised trade/mark. ts is a unix epoch in milliseconds. */
export interface Tick {
  sym: string;
  ts: number;
  price: number;
}

/** An OHLC bar over a fixed interval. */
export interface Bar {
  sym: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A point-in-time snapshot of every tracked symbol's mark. */
export type Snapshot = Record<string, number>;

/**
 * A pull-based market feed. `next()` advances one step and returns the new
 * snapshot, or null when a finite source is exhausted. `symbols` is the tracked
 * universe in a stable order.
 */
export interface FeedAdapter {
  readonly symbols: string[];
  snapshot(): Snapshot;
  next(): Snapshot | null;
}
