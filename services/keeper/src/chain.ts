/* =============================================================================
 * keeper / chain
 * -----------------------------------------------------------------------------
 * The chain abstraction the keeper writes through. `ChainClient` mirrors the
 * AmplifiVault's keeper-facing surface; `InMemoryVault` is a faithful, fully
 * deterministic mock of that contract's accounting so the keeper can be tested
 * end-to-end without a node. A production deployment swaps in a viem-backed
 * client implementing the same interface (see @amplifi/protocol-bindings on the
 * roadmap) — the keeper logic does not change.
 *
 * Accounting mirrors the Solidity vault: NAV = idle reserve + book mark, shares
 * are minted on deposit at the current price, and a floor breach latches a
 * wind-down that settles the book to the reserve.
 * ===========================================================================*/

export interface VaultState {
  totalAssets: number; // idle reserve + book mark
  totalSupply: number; // shares outstanding
  navPerShare: number; // totalAssets / totalSupply (1 at genesis)
  depositsHalted: boolean;
  woundDown: boolean;
  epoch: number;
}

export interface ChainClient {
  getState(): VaultState;
  /** Deposit `assets`; returns shares minted. Reverts (throws) if halted. */
  deposit(assets: number): number;
  /** Report the latest book mark to the vault; returns the resulting state. */
  reportBookMark(bookMark: number): VaultState;
  /** Keeper poke: ratchet HWM, crystallise, and wind down if past the floor. */
  pokeNav(): { woundDown: boolean; state: VaultState };
  /** Governor action after a wind-down. */
  resetEpoch(): void;
}

export interface VaultConfig {
  floorBps: number; // wind-down floor in bps of HWM (e.g. 4000 = −60%)
}

/** Deterministic in-memory mirror of AmplifiVault accounting. */
export class InMemoryVault implements ChainClient {
  private reserve = 0;
  private bookMark = 0;
  private supply = 0;
  private hwmNav = 1;
  private halted = false;
  private wound = false;
  private epoch = 1;
  constructor(private readonly cfg: VaultConfig) {}

  private nav(): number {
    return this.supply === 0 ? 1 : (this.reserve + this.bookMark) / this.supply;
  }

  getState(): VaultState {
    return {
      totalAssets: this.reserve + this.bookMark,
      totalSupply: this.supply,
      navPerShare: this.nav(),
      depositsHalted: this.halted,
      woundDown: this.wound,
      epoch: this.epoch,
    };
  }

  deposit(assets: number): number {
    if (this.halted) throw new Error("deposits halted (wound down)");
    if (assets <= 0) throw new Error("deposit must be positive");
    const navBefore = this.nav();
    const shares = this.supply === 0 ? assets : assets / navBefore;
    this.supply += shares;
    this.bookMark += assets; // premium routed to the venue → book value
    return shares;
  }

  reportBookMark(bookMark: number): VaultState {
    this.bookMark = Math.max(bookMark, 0); // long-option book is floored at 0
    return this.getState();
  }

  pokeNav(): { woundDown: boolean; state: VaultState } {
    if (this.wound) return { woundDown: true, state: this.getState() };
    const nav = this.nav();
    if (nav > this.hwmNav) this.hwmNav = nav;
    const floorNav = (this.hwmNav * this.cfg.floorBps) / 10_000;
    if (nav < floorNav) {
      this.wound = true;
      this.halted = true;
      this.reserve += this.bookMark; // settle book to reserve
      this.bookMark = 0;
    }
    return { woundDown: this.wound, state: this.getState() };
  }

  resetEpoch(): void {
    this.wound = false;
    this.halted = false;
    this.hwmNav = this.nav();
    this.epoch += 1;
  }
}
