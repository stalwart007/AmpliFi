/* =============================================================================
 * @amplifi/protocol-bindings / memory
 * -----------------------------------------------------------------------------
 * An in-memory ContractProvider that faithfully reproduces AmplifiVault's
 * accounting in integer base units / wad. It lets VaultClient (and therefore the
 * keeper) run end-to-end with zero infrastructure, and serves as the executable
 * reference the Foundry tests cross-check. A viem provider replaces it 1:1 in
 * production.
 * ===========================================================================*/

import type { ContractProvider } from "./client";

const WAD = 10n ** 18n;
const BPS = 10_000n;

export interface MemoryVaultConfig {
  decimals?: number;
  floorBps?: number;
}

export class MemoryProvider implements ContractProvider {
  private reserve = 0n; // base units
  private bookMark = 0n; // base units (venue mark)
  private supply = 0n; // share base units
  private hwmWad = WAD;
  private halted = false;
  private wound = false;
  readonly decimals: number;
  private readonly floorBps: bigint;

  constructor(
    readonly address: string,
    cfg: MemoryVaultConfig = {},
  ) {
    this.decimals = cfg.decimals ?? 6;
    this.floorBps = BigInt(cfg.floorBps ?? 4000);
  }

  private navWad(): bigint {
    if (this.supply === 0n) return WAD;
    return ((this.reserve + this.bookMark) * WAD) / this.supply;
  }

  /** Test/keeper hook: set the venue book mark (what the vault reads on-chain). */
  setBookMark(human: number): void {
    this.bookMark = BigInt(Math.round(human * 10 ** this.decimals));
  }

  async read(_address: string, _abi: readonly unknown[], fn: string, args: readonly unknown[] = []): Promise<unknown> {
    switch (fn) {
      case "totalAssets":
        return this.reserve + this.bookMark;
      case "totalSupply":
        return this.supply;
      case "navPerShareWad":
        return this.navWad();
      case "depositsHalted":
        return this.halted;
      case "balanceOf":
        return this.supply; // single-holder mock
      case "asset":
        return "0x0000000000000000000000000000000000000001";
      default:
        throw new Error(`MemoryProvider: unhandled read ${fn}(${args.length})`);
    }
  }

  async write(_address: string, _abi: readonly unknown[], fn: string, args: readonly unknown[] = []): Promise<string> {
    switch (fn) {
      case "deposit": {
        if (this.halted) throw new Error("deposits halted");
        const assets = args[0] as bigint;
        const navBefore = this.navWad();
        const shares = this.supply === 0n ? assets : (assets * WAD) / navBefore;
        this.supply += shares;
        this.bookMark += assets;
        return "0xdeposit";
      }
      case "redeem": {
        const shares = args[0] as bigint;
        const assetsOut = (shares * (this.reserve + this.bookMark)) / (this.supply === 0n ? 1n : this.supply);
        this.supply -= shares;
        // pay from reserve first, then book
        const fromReserve = assetsOut <= this.reserve ? assetsOut : this.reserve;
        this.reserve -= fromReserve;
        this.bookMark -= assetsOut - fromReserve;
        return "0xredeem";
      }
      case "pokeNav": {
        if (this.wound) return "0xpoke";
        const nav = this.navWad();
        if (nav > this.hwmWad) this.hwmWad = nav;
        const floorNav = (this.hwmWad * this.floorBps) / BPS;
        if (nav < floorNav) {
          this.wound = true;
          this.halted = true;
          this.reserve += this.bookMark;
          this.bookMark = 0n;
        }
        return "0xpoke";
      }
      default:
        throw new Error(`MemoryProvider: unhandled write ${fn}`);
    }
  }
}
