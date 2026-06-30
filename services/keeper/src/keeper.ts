/* =============================================================================
 * keeper / agent
 * -----------------------------------------------------------------------------
 * The off-chain agent. It runs the SAME @amplifi/strategy-core state machine the
 * terminal and risk-engine use, and on each cycle it (1) advances the strategy
 * against the market feed, (2) reports the resulting book value to the vault,
 * and (3) pokes NAV so the on-chain RiskController ratchets its high-water mark
 * and winds down on a floor breach. Because the chain mirror and the strategy
 * share one NAV definition, the keeper keeps them exactly in sync.
 * ===========================================================================*/

import {
  createState,
  deploy,
  step,
  DEFAULT_PARAMS,
  type StrategyParams,
  type StrategyState,
  type BasketAsset,
  type CorrelatedGbm,
} from "@amplifi/strategy-core";
import type { ChainClient, VaultState } from "./chain";

export type KeeperActionKind = "deploy" | "step" | "hedge" | "epoch" | "pokeNav" | "windDown" | "halt";

export interface KeeperAction {
  cycle: number;
  day: number;
  kind: KeeperActionKind;
  detail: string;
}

export interface KeeperOptions {
  assets: BasketAsset[];
  market: CorrelatedGbm;
  chain: ChainClient;
  params?: StrategyParams;
  deposit: number;
}

/** Total asset value of the strategy (mark + reserve), = navPerShare · shares. */
function bookValue(s: StrategyState): number {
  return s.navPerShare * s.shares;
}

export class Keeper {
  private state: StrategyState;
  private readonly params: StrategyParams;
  private cycle = 0;
  closed = false;

  constructor(private readonly opts: KeeperOptions) {
    this.params = opts.params ?? DEFAULT_PARAMS;
    this.state = createState(opts.assets);
  }

  /** Deploy the strategy off-chain and seed the vault with the deposit. */
  bootstrap(): KeeperAction[] {
    const dep = deploy(this.state, this.opts.deposit, this.params);
    this.state = dep.state;
    this.opts.chain.deposit(this.opts.deposit);
    this.opts.chain.reportBookMark(bookValue(this.state));
    const legs = dep.events.find((e) => e.kind === "deploy");
    return [
      {
        cycle: 0,
        day: this.state.day,
        kind: "deploy",
        detail: legs && legs.kind === "deploy" ? `${legs.legs} legs · ${legs.realizedLeverage.toFixed(2)}× lev` : "deployed",
      },
    ];
  }

  /** Advance one keeper cycle. Returns the actions taken this cycle. */
  tick(): KeeperAction[] {
    this.cycle++;
    const actions: KeeperAction[] = [];
    if (this.closed) return actions;

    const r = step(this.state, this.params, this.opts.market.next());
    this.state = r.state;
    actions.push({ cycle: this.cycle, day: this.state.day, kind: "step", detail: `NAV ${this.state.navPerShare.toFixed(4)}` });

    for (const e of r.events) {
      if (e.kind === "hedge") actions.push({ cycle: this.cycle, day: e.day, kind: "hedge", detail: `${e.reason} drift ${(e.driftBefore * 100).toFixed(1)}%` });
      else if (e.kind === "epoch") actions.push({ cycle: this.cycle, day: e.day, kind: "epoch", detail: `epoch ${e.epoch} skim ${e.skimmed.toFixed(0)}` });
    }

    // Sync the chain mirror and poke the RiskController.
    this.opts.chain.reportBookMark(bookValue(this.state));
    const poke = this.opts.chain.pokeNav();
    actions.push({ cycle: this.cycle, day: this.state.day, kind: "pokeNav", detail: `nav ${poke.state.navPerShare.toFixed(4)}` });

    if (this.state.closed || poke.woundDown) {
      this.closed = true;
      actions.push({ cycle: this.cycle, day: this.state.day, kind: "windDown", detail: `nav ${this.state.navPerShare.toFixed(4)} · deposits halted` });
    }
    return actions;
  }

  /** Run up to `cycles` ticks (stops early on wind-down). */
  run(cycles: number): KeeperAction[] {
    const log: KeeperAction[] = this.state.deployed ? [] : this.bootstrap();
    for (let i = 0; i < cycles && !this.closed; i++) log.push(...this.tick());
    return log;
  }

  strategyState(): StrategyState {
    return this.state;
  }

  vaultState(): VaultState {
    return this.opts.chain.getState();
  }
}
