/* =============================================================================
 * @amplifi/svc-kit / metrics
 * -----------------------------------------------------------------------------
 * A tiny, dependency-free Prometheus-text metrics registry: counters and a
 * sum/count summary for latencies. No client library — we render the exposition
 * format directly so `GET /metrics` can be scraped by Prometheus.
 * ===========================================================================*/

function labelKey(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return name;
  const inner = entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, "")}"`).join(",");
  return `${name}{${inner}}`;
}

export class Metrics {
  private counters = new Map<string, number>();
  private sums = new Map<string, number>(); // summary _sum
  private counts = new Map<string, number>(); // summary _count
  private help = new Map<string, string>();

  /** Increment a counter series. */
  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const k = labelKey(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  /** Observe a value into a sum/count summary (e.g. request duration ms). */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const ks = labelKey(`${name}_sum`, labels);
    const kc = labelKey(`${name}_count`, labels);
    this.sums.set(ks, (this.sums.get(ks) ?? 0) + value);
    this.counts.set(kc, (this.counts.get(kc) ?? 0) + 1);
  }

  setHelp(name: string, help: string): void {
    this.help.set(name, help);
  }

  /** Render the Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    for (const [name, help] of this.help) lines.push(`# HELP ${name} ${help}`);
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.sums) lines.push(`${k} ${v}`);
    for (const [k, v] of this.counts) lines.push(`${k} ${v}`);
    return lines.join("\n") + "\n";
  }
}
