/* keeper tests: bootstrap, chain↔strategy NAV sync, wind-down propagation, determinism. */
import { flatCorrelationMarket, CorrelatedGbm, type BasketAsset, type MarketConfig } from "@amplifi/strategy-core";
import { InMemoryVault } from "../src/chain";
import { Keeper } from "../src/keeper";

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

const mkAssets = (): BasketAsset[] => [
  { sym: "BTC", spot: 64000, vol: 0.55, active: true },
  { sym: "ETH", spot: 3400, vol: 0.66, active: true },
  { sym: "SOL", spot: 150, vol: 0.92, active: true },
];
const spots = { BTC: 64000, ETH: 3400, SOL: 150 };

function calmMarket(seed: bigint): CorrelatedGbm {
  const cfg: MarketConfig = flatCorrelationMarket(mkAssets(), 0.35, 0.4, 1, seed);
  for (const s of cfg.symbols) cfg.vol[s] = 0.08; // low diffusion → no wind-down
  return new CorrelatedGbm(spots, cfg);
}

console.log("\n── bootstrap + chain/strategy NAV sync ──");
{
  const chain = new InMemoryVault({ floorBps: 4000 });
  const keeper = new Keeper({ assets: mkAssets(), market: calmMarket(7n), chain, deposit: 1000 });
  const log = keeper.run(0); // bootstrap only
  check("bootstrap emits a deploy action", log.some((a) => a.kind === "deploy"));
  check("vault minted shares ≈ deposit", Math.abs(chain.getState().totalSupply - 1000) < 1e-9);
  check("vault NAV starts ≈ 1", Math.abs(chain.getState().navPerShare - 1) < 1e-6);

  let maxDiff = 0;
  for (let i = 0; i < 80 && !keeper.closed; i++) {
    keeper.tick();
    maxDiff = Math.max(maxDiff, Math.abs(keeper.vaultState().navPerShare - keeper.strategyState().navPerShare));
  }
  check("chain NAV tracks strategy NAV every cycle", maxDiff < 1e-9, `maxDiff=${maxDiff}`);
  check("calm market did not wind down", !keeper.closed && !keeper.vaultState().woundDown);
  console.log(`     after 80 cycles: NAV=${keeper.strategyState().navPerShare.toFixed(4)} epoch=${keeper.strategyState().epoch}`);
}

console.log("\n── wind-down propagation ──");
{
  const chain = new InMemoryVault({ floorBps: 4000 });
  const cfg = flatCorrelationMarket(mkAssets(), 0.5, -0.2, 1, 3n);
  cfg.jump = { intensityPerYear: 120, meanLog: -0.12, volLog: 0.08 }; // brutal crash regime
  const keeper = new Keeper({ assets: mkAssets(), market: new CorrelatedGbm(spots, cfg), chain, deposit: 1000 });
  const log = keeper.run(150);
  check("keeper latched closed", keeper.closed);
  check("vault wound down + deposits halted", chain.getState().woundDown && chain.getState().depositsHalted);
  check("a windDown action was logged", log.some((a) => a.kind === "windDown"));
  let threw = false;
  try {
    chain.deposit(100);
  } catch {
    threw = true;
  }
  check("deposits revert after wind-down", threw);
  // Governor reopens a fresh epoch.
  chain.resetEpoch();
  check("resetEpoch reopens deposits", !chain.getState().woundDown && !chain.getState().depositsHalted && chain.getState().epoch === 2);
}

console.log("\n── determinism ──");
{
  const runOnce = (seed: bigint) => {
    const k = new Keeper({ assets: mkAssets(), market: calmMarket(seed), chain: new InMemoryVault({ floorBps: 4000 }), deposit: 1000 });
    k.run(60);
    return { nav: k.strategyState().navPerShare, vnav: k.vaultState().navPerShare };
  };
  const a = runOnce(42n);
  const b = runOnce(42n);
  check("same seed ⇒ identical strategy + vault NAV", a.nav === b.nav && a.vnav === b.vnav);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
