/* market-data tests: synthetic determinism, replay, CSV, and estimators. */
import {
  SyntheticFeed,
  ReplayFeed,
  parseWideCsv,
  ticksToBars,
  realizedVol,
  ewmaVol,
  correlationMatrix,
  logReturns,
} from "../src/index";

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
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const cfg = {
  symbols: ["BTC", "ETH"],
  spot0: { BTC: 64000, ETH: 3400 },
  drift: { BTC: 0.2, ETH: 0.2 },
  vol: { BTC: 0.5, ETH: 0.6 },
  corr: [
    [1, 0.5],
    [0.5, 1],
  ],
  stepDays: 1,
};

console.log("\n── synthetic feed ──");
{
  const a = new SyntheticFeed({ ...cfg, seed: 7n });
  const b = new SyntheticFeed({ ...cfg, seed: 7n });
  let same = true;
  let moved = false;
  for (let i = 0; i < 50; i++) {
    const x = a.next();
    const y = b.next();
    if (x.BTC !== y.BTC || x.ETH !== y.ETH) same = false;
    if (x.BTC !== 64000) moved = true;
  }
  check("same seed ⇒ identical path", same);
  check("prices actually evolve", moved);
  check("snapshot returns latest marks", a.snapshot().BTC > 0);
}

console.log("\n── replay + CSV ──");
{
  const csv = "ts,BTC,ETH\n1000,64000,3400\n2000,65000,3500\n3000,63000,3300";
  const parsed = parseWideCsv(csv);
  check("CSV parses symbols + rows", parsed.symbols.join(",") === "BTC,ETH" && parsed.rows.length === 3);
  const feed = ReplayFeed.fromCsv(csv);
  check("replay starts at first frame", feed.snapshot().BTC === 64000);
  const f2 = feed.next();
  check("replay advances", f2?.BTC === 65000);
  feed.next();
  check("replay returns null past the end", feed.next() === null);

  let threw = false;
  try {
    parseWideCsv("price,BTC\n1,2");
  } catch {
    threw = true;
  }
  check("CSV without ts header rejected", threw);

  const bars = ticksToBars(
    [
      { sym: "BTC", ts: 0, price: 100 },
      { sym: "BTC", ts: 10, price: 110 },
      { sym: "BTC", ts: 20, price: 90 },
      { sym: "BTC", ts: 1001, price: 95 },
    ],
    1000,
  );
  check(
    "ticksToBars buckets OHLC",
    bars.length === 2 && bars[0].high === 110 && bars[0].low === 90 && bars[0].close === 90,
  );
}

console.log("\n── estimators ──");
{
  // Construct a series with a known constant daily log-return → vol is analytic.
  const dailyRet = 0.02;
  const prices = [100];
  for (let i = 0; i < 64; i++) prices.push(prices[prices.length - 1] * Math.exp(dailyRet));
  check("log returns recovered", close(logReturns(prices)[0], dailyRet, 1e-12));
  // Constant returns ⇒ zero variance ⇒ zero realized vol.
  check("constant returns ⇒ ~0 realized vol", close(realizedVol(prices, 365), 0, 1e-9));

  // A noisy series: realized vol should be positive and EWMA finite.
  const noisy = [100];
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < 500; i++) noisy.push(noisy[noisy.length - 1] * Math.exp(0.03 * rand()));
  check("noisy series ⇒ positive realized vol", realizedVol(noisy, 365) > 0);
  check("EWMA vol finite & positive", ewmaVol(noisy, 0.94, 365) > 0 && Number.isFinite(ewmaVol(noisy)));

  // Two perfectly co-moving series ⇒ correlation ≈ 1.
  const a = noisy;
  const b = noisy.map((p) => p * 2);
  const corr = correlationMatrix({ A: a, B: b }, ["A", "B"]);
  check("identical-shape series ⇒ corr ≈ 1", close(corr[0][1], 1, 1e-9), `got ${corr[0][1]}`);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
