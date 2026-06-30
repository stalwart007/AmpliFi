/* =============================================================================
 * risk-engine / scheduler
 * -----------------------------------------------------------------------------
 * Periodically pulls the current book from a provider, runs the monitor, and
 * forwards the report to a sink (log / pager / webhook). De-duplicates alerts so
 * a sustained breach pages once on rising edge, not every tick.
 * ===========================================================================*/

import { evaluate, type Book, type RiskLimits, type RiskReport } from "./monitor";

export type ReportSink = (report: RiskReport, isNewAlert: boolean) => void;

export class RiskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBreachCodes = new Set<string>();

  constructor(
    private readonly provideBook: () => Book,
    private readonly limits: RiskLimits,
    private readonly sink: ReportSink,
  ) {}

  /** Evaluate once now; returns the report and forwards it to the sink. */
  runOnce(): RiskReport {
    const report = evaluate(this.provideBook(), this.limits);
    const codes = new Set(report.breaches.map((b) => b.code));
    const isNewAlert = report.breaches.some((b) => !this.lastBreachCodes.has(b.code));
    this.lastBreachCodes = codes;
    this.sink(report, isNewAlert);
    return report;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
