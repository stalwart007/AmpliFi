/* risk-engine tests: breach detection, scheduler edge-dedup, and HTTP /evaluate. */
import { evaluate, RiskScheduler, buildServer, type Book } from "../src/index";
import type { Leg } from "@amplifi/quant-core";
import type { AddressInfo } from "node:net";

let passed = 0,
  failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

function makeBook(qtyScale = 1): Book {
  const legs: Leg[] = [
    { underlying: "BTC", type: "call", s: 64000, k: 64000, t: 0.25, vol: 0.55, r: 0.05, b: 0, qty: 1 * qtyScale },
    { underlying: "ETH", type: "call", s: 3400, k: 3400, t: 0.25, vol: 0.66, r: 0.05, b: 0, qty: 10 * qtyScale },
  ];
  return {
    legs,
    underlyings: ["BTC", "ETH"],
    spot0: { BTC: 64000, ETH: 3400 },
    vols: { BTC: 0.55, ETH: 0.66 },
    corr: [
      [1, 0.4],
      [0.4, 1],
    ],
    equity: 1000 * qtyScale,
    navPerShare: 1,
  };
}

console.log("\n── monitor ──");
{
  const book = makeBook();
  const lax = evaluate(book, { maxVar95Frac: 5, maxLeverage: 100, minNavPerShare: 0.1, paths: 4000 });
  check("VaR95 ≥ 0 and ES ≥ VaR", lax.var95 >= 0 && lax.es99 >= lax.var99 - 1e-6);
  check("leverage computed > 0", lax.leverage > 0);
  check("no breaches under lax limits", lax.breaches.length === 0 && lax.worstBreach === "none");

  const strict = evaluate(book, { maxVar95Frac: 0.001, maxLeverage: 0.5, minNavPerShare: 1.5, paths: 4000 });
  check("tight VaR limit breaches", strict.breaches.some((b) => b.code === "VAR95_LIMIT"));
  check("tight leverage limit breaches", strict.breaches.some((b) => b.code === "LEVERAGE_LIMIT"));
  check("NAV floor breach is critical", strict.breaches.some((b) => b.code === "NAV_FLOOR" && b.severity === "critical"));
  check("worstBreach escalates to critical", strict.worstBreach === "critical");

  const empty = evaluate({ ...book, legs: [] }, { maxVar95Frac: 0.5 });
  check("empty book → no VaR, no breach", empty.var95 === 0 && empty.leverage === 0);
}

console.log("\n── scheduler (rising-edge dedup) ──");
{
  let alerts = 0;
  let reports = 0;
  const sched = new RiskScheduler(
    () => makeBook(),
    { maxLeverage: 0.5, paths: 3000 }, // always breached
    (_r, isNew) => {
      reports++;
      if (isNew) alerts++;
    },
  );
  sched.runOnce();
  sched.runOnce();
  sched.runOnce();
  check("reports every tick", reports === 3);
  check("alert fires once on rising edge", alerts === 1, `alerts=${alerts}`);
}

console.log("\n── HTTP /evaluate ──");
{
  const server = buildServer();
  await new Promise<void>((res) => server.listen(0, res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const health: any = await fetch(`${base}/health`).then((r) => r.json());
  check("GET /health", health.service === "risk-engine");

  const body = { ...makeBook(), limits: { maxLeverage: 0.5, paths: 3000 } };
  const res = await fetch(`${base}/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const report: any = await res.json();
  check("POST /evaluate returns report with breach", res.status === 200 && report.breaches.some((b: { code: string }) => b.code === "LEVERAGE_LIMIT"));

  await new Promise<void>((res) => server.close(() => res()));
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
