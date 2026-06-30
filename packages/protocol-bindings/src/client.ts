/* =============================================================================
 * @amplifi/protocol-bindings / client
 * -----------------------------------------------------------------------------
 * A provider-abstracted, typed client for the AmplifiVault. The keeper and UI
 * talk to THIS, not to a specific transport. `ContractProvider` is the seam a
 * viem `PublicClient`/`WalletClient` satisfies in production; the bundled
 * `MemoryProvider` satisfies it for tests and offline runs. Switching from mock
 * to mainnet is a provider swap — no call-site changes.
 *
 * Unit handling is explicit: on-chain amounts are integer base units (USDC = 6
 * decimals); NAV is a 1e18 wad. The client converts to/from human numbers at the
 * boundary so callers never juggle decimals.
 * ===========================================================================*/

import { AMPLIFI_VAULT_ABI } from "./abi";

export interface ContractProvider {
  read(address: string, abi: readonly unknown[], fn: string, args?: readonly unknown[]): Promise<unknown>;
  write(address: string, abi: readonly unknown[], fn: string, args?: readonly unknown[]): Promise<string>;
}

const WAD = 10n ** 18n;

export function toBaseUnits(human: number, decimals: number): bigint {
  // Round to the nearest base unit to avoid float drift on the boundary.
  return BigInt(Math.round(human * 10 ** decimals));
}
export function fromBaseUnits(units: bigint, decimals: number): number {
  return Number(units) / 10 ** decimals;
}
export function fromWad(wad: bigint): number {
  return Number(wad) / Number(WAD);
}

export class VaultClient {
  constructor(
    private readonly provider: ContractProvider,
    private readonly address: string,
    private readonly decimals = 6,
  ) {}

  private read<T>(fn: string, args: readonly unknown[] = []): Promise<T> {
    return this.provider.read(this.address, AMPLIFI_VAULT_ABI, fn, args) as Promise<T>;
  }

  async totalAssets(): Promise<number> {
    return fromBaseUnits(await this.read<bigint>("totalAssets"), this.decimals);
  }
  async totalSupply(): Promise<number> {
    return fromBaseUnits(await this.read<bigint>("totalSupply"), this.decimals);
  }
  async navPerShare(): Promise<number> {
    return fromWad(await this.read<bigint>("navPerShareWad"));
  }
  async depositsHalted(): Promise<boolean> {
    return this.read<boolean>("depositsHalted");
  }
  async shareBalance(owner: string): Promise<number> {
    return fromBaseUnits(await this.read<bigint>("balanceOf", [owner]), this.decimals);
  }

  /** Deposit `assets` (human units) for `receiver`; returns the tx hash. */
  deposit(assets: number, receiver: string): Promise<string> {
    return this.provider.write(this.address, AMPLIFI_VAULT_ABI, "deposit", [
      toBaseUnits(assets, this.decimals),
      receiver,
    ]);
  }
  redeem(shares: number, receiver: string, owner: string): Promise<string> {
    return this.provider.write(this.address, AMPLIFI_VAULT_ABI, "redeem", [
      toBaseUnits(shares, this.decimals),
      receiver,
      owner,
    ]);
  }
  pokeNav(): Promise<string> {
    return this.provider.write(this.address, AMPLIFI_VAULT_ABI, "pokeNav", []);
  }
}
