/* pricing-api end-to-end test: spins the real server and hits every route. */
import { buildServer } from "../src/server";
import { price } from "@amplifi/quant-core";
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

const server = buildServer();
await new Promise<void>((res) => server.listen(0, res));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

console.log("\n── pricing-api routes ──");
{
  const health: any = await fetch(`${base}/health`).then((r) => r.json());
  check("GET /health", health.ok === true && health.service === "pricing-api");

  const pr = await post("/price", { s: 64000, k: 64000, t: 30 / 365, vol: 0.55, r: 0.05, b: 0, type: "call" });
  const pb: any = await pr.json();
  check("POST /price returns greeks", pr.status === 200 && pb.greeks.price > 0 && Math.abs(pb.greeks.delta - 0.5) < 0.15);

  // IV round-trip through the API: price → /iv → recovers vol.
  const mkt = price({ s: 64000, k: 66000, t: 0.3, vol: 0.7, r: 0.05, b: 0, type: "call" });
  const iv: any = await post("/iv", { target: mkt, s: 64000, k: 66000, t: 0.3, r: 0.05, b: 0, type: "call" }).then((r) => r.json());
  check("POST /iv recovers σ=0.7", iv.converged && Math.abs(iv.vol - 0.7) < 1e-3, `got ${iv.vol}`);

  const surf: any = await post("/surface", {
    slices: [
      { expiry: 7 / 365, params: { a: 0.02, b: 0.1, rho: -0.3, m: 0, zeta: 0.12 } },
      { expiry: 30 / 365, params: { a: 0.04, b: 0.1, rho: -0.3, m: 0, zeta: 0.15 } },
    ],
    ks: [-0.1, 0, 0.1],
    expiries: [14 / 365],
  }).then((r) => r.json());
  check("POST /surface returns a vol grid", Array.isArray(surf.vols) && surf.vols[0].length === 3 && surf.vols[0][1] > 0);

  const varRes = await post("/var", {
    underlyings: ["BTC", "ETH"],
    legs: [
      { underlying: "BTC", type: "call", s: 64000, k: 64000, t: 0.25, vol: 0.55, r: 0.05, b: 0, qty: 1 },
      { underlying: "ETH", type: "call", s: 3400, k: 3400, t: 0.25, vol: 0.66, r: 0.05, b: 0, qty: 5 },
    ],
    spot0: { BTC: 64000, ETH: 3400 },
    vols: { BTC: 0.55, ETH: 0.66 },
    cov: [
      [0.3025, 0.18],
      [0.18, 0.4356],
    ],
    config: { paths: 5000, horizonYears: 5 / 365 },
  });
  const vb: any = await varRes.json();
  check("POST /var returns VaR/ES", varRes.status === 200 && vb.tail["0.9500"].var >= 0 && vb.tail["0.9900"].es >= vb.tail["0.9900"].var - 1e-6);

  // Validation: bad option type → 400 with field.
  const badType = await post("/price", { s: 100, k: 100, t: 1, vol: 0.2, r: 0, type: "banana" });
  const btb: any = await badType.json();
  check("invalid type → 400 + field", badType.status === 400 && btb.field === "type");

  // Missing required field.
  const missing = await post("/price", { s: 100, k: 100, t: 1, r: 0, type: "call" });
  check("missing vol → 400", missing.status === 400);
}

await new Promise<void>((res) => server.close(() => res()));

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
