/* keeper entrypoint — runs the agent against the in-memory vault as a demo. */
import { createLogger } from "@amplifi/svc-kit";
import { flatCorrelationMarket, CorrelatedGbm, type BasketAsset } from "@amplifi/strategy-core";
import { InMemoryVault } from "./chain";
import { Keeper } from "./keeper";
import { viemClientFromEnv } from "./viemClient";

export { Keeper } from "./keeper";
export type { KeeperAction, KeeperOptions, KeeperActionKind } from "./keeper";
export { InMemoryVault } from "./chain";
export type { ChainClient, VaultState, VaultConfig } from "./chain";
export { ViemVaultClient, viemClientFromEnv } from "./viemClient";
export type { AsyncChainClient, OnChainVaultState } from "./viemClient";

/** Live loop against a deployed vault: read state, poke NAV on an interval. */
async function runLive(intervalMs = 60_000): Promise<void> {
  const log = createLogger("keeper");
  const client = viemClientFromEnv()!;
  log.info("keeper live mode", { vault: process.env.VAULT_ADDRESS, intervalMs });
  for (;;) {
    try {
      const before = await client.getState();
      const tx = await client.pokeNav();
      const after = await client.getState();
      log.info("pokeNav", { tx, navWad: after.navPerShareWad.toString(), halted: after.depositsHalted, prevNavWad: before.navPerShareWad.toString() });
    } catch (err) {
      log.error("poke failed", { err: String(err) });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger("keeper");
  if (viemClientFromEnv()) {
    // Deployed contracts configured via env → drive the real chain.
    void runLive(Number(process.env.KEEPER_INTERVAL_MS ?? 60_000));
  } else {
    // No deployment configured → run the deterministic in-memory demo.
    const assets: BasketAsset[] = [
      { sym: "BTC", spot: 64000, vol: 0.55, active: true },
      { sym: "ETH", spot: 3400, vol: 0.66, active: true },
      { sym: "SOL", spot: 150, vol: 0.92, active: true },
    ];
    const market = new CorrelatedGbm({ BTC: 64000, ETH: 3400, SOL: 150 }, flatCorrelationMarket(assets, 0.4, 0.3, 1, 1n));
    const keeper = new Keeper({ assets, market, chain: new InMemoryVault({ floorBps: 4000 }), deposit: 1000 });
    for (const a of keeper.run(120)) log.info("action", { ...a });
    log.info("final", { vault: keeper.vaultState(), nav: keeper.strategyState().navPerShare });
  }
}
