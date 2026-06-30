/* =============================================================================
 * @amplifi/protocol-bindings / viem
 * -----------------------------------------------------------------------------
 * A `ContractProvider` backed by viem. The structural client interfaces below
 * are exactly the `readContract` / `writeContract` surfaces of a viem
 * `PublicClient` / `WalletClient`, so a real viem client satisfies them with no
 * adapter — this keeps the package free of a hard viem runtime dependency while
 * remaining drop-in compatible. Wiring the keeper to a live chain is then just:
 *
 *   const provider = createViemProvider(publicClient, walletClient, { account, chain });
 *   const vault = new VaultClient(provider, VAULT_ADDRESS);
 *
 * and every keeper call (deposit, pokeNav, redeem) flows to the real contracts.
 * ===========================================================================*/

import type { ContractProvider } from "./client";

type Hex = `0x${string}`;

export interface ViemReadClient {
  readContract(args: {
    address: Hex;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export interface ViemWriteClient {
  writeContract(args: {
    address: Hex;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    account?: unknown;
    chain?: unknown;
  }): Promise<Hex>;
}

export interface ViemProviderOptions {
  account?: unknown; // viem Account or address; required for writes
  chain?: unknown;
}

/** Build a ContractProvider from viem public + wallet clients. */
export function createViemProvider(
  pub: ViemReadClient,
  wallet: ViemWriteClient,
  opts: ViemProviderOptions = {},
): ContractProvider {
  return {
    read: (address, abi, fn, args = []) => pub.readContract({ address: address as Hex, abi, functionName: fn, args }),
    write: (address, abi, fn, args = []) =>
      wallet.writeContract({
        address: address as Hex,
        abi,
        functionName: fn,
        args,
        account: opts.account,
        chain: opts.chain,
      }),
  };
}
