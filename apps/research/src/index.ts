/* =============================================================================
 * research — backtest CLI
 * -----------------------------------------------------------------------------
 * `npm run dev -w @amplifi/research` runs the scenario suite and a transaction-
 * cost sweep, printing tables. Pure terminal output — no dependencies.
 * ===========================================================================*/

import { runBacktest, sweep } from "./backtest";
import { SCENARIOS } from "./scenarios";
import { formatTable } from "./report";
import { runStressSuite } from "./stress";

export { runBacktest, sweep } from "./backtest";
export type { Scenario, BacktestResult } from "./backtest";
export { SCENARIOS } from "./scenarios";
export { formatTable } from "./report";
export { monteCarloStress, runStressSuite, STRESS_SUITE } from "./stress";
export type { StressResult } from "./stress";

function main(): void {
  console.log("\nAmpliFi — backtest scenario suite\n");
  console.log(formatTable(SCENARIOS.map(runBacktest)));

  console.log("\nTransaction-cost sweep (calm-bull, costBps ∈ {0,15,40,80}):\n");
  const base = SCENARIOS[0];
  console.log(formatTable(sweep(base, "costBps", [0, 15, 40, 80])));

  console.log("\nMonte-Carlo stress suite (48 seeds each):\n");
  const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
  const padL = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);
  console.log([pad("regime", 24), padL("wind-down%", 12), padL("NAV p5", 9), padL("NAV p50", 9), padL("NAV p95", 9)].join(" "));
  for (const r of runStressSuite(48)) {
    console.log(
      [
        pad(r.name, 24),
        padL((r.windDownRate * 100).toFixed(0) + "%", 12),
        padL(r.navP5.toFixed(3), 9),
        padL(r.navP50.toFixed(3), 9),
        padL(r.navP95.toFixed(3), 9),
      ].join(" "),
    );
  }
  console.log("");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
