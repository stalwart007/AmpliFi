/* keeper entrypoint — runs the agent against the in-memory vault as a demo. */
import { createLogger } from "@amplifi/svc-kit";
import { flatCorrelationMarket, CorrelatedGbm, type BasketAsset } from "@amplifi/strategy-core";
import { InMemoryVault } from "./chain";
import { Keeper } from "./keeper";

export { Keeper } from "./keeper";
export type { KeeperAction, KeeperOptions, KeeperActionKind } from "./keeper";
export { InMemoryVault } from "./chain";
export type { ChainClient, VaultState, VaultConfig } from "./chain";

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger("keeper");
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
