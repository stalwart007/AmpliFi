/* =============================================================================
 * keeper / viemClient
 * -----------------------------------------------------------------------------
 * The LIVE chain client: a viem-backed reader/writer over a deployed
 * AmplifiVault. It reads NAV/supply/halt state via `readContract` and submits
 * the keeper `pokeNav()` via `writeContract`. Construct it from env once the
 * contracts are deployed (RPC_URL, KEEPER_PRIVATE_KEY, VAULT_ADDRESS); until
 * then the keeper runs the deterministic in-memory mirror in `chain.ts`.
 * ===========================================================================*/

import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const VAULT_ABI = [
  { type: "function", name: "navPerShareWad", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositsHalted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "pokeNav", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export interface OnChainVaultState {
  totalAssets: bigint;
  totalSupply: bigint;
  navPerShareWad: bigint;
  depositsHalted: boolean;
}

export interface AsyncChainClient {
  getState(): Promise<OnChainVaultState>;
  pokeNav(): Promise<Hex>;
}

export interface ViemConfig {
  rpcUrl: string;
  privateKey: Hex;
  vault: Address;
}

export class ViemVaultClient implements AsyncChainClient {
  private readonly pub;
  private readonly wallet;
  private readonly vault: Address;

  constructor(cfg: ViemConfig) {
    const account = privateKeyToAccount(cfg.privateKey);
    this.pub = createPublicClient({ chain: baseSepolia, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ account, chain: baseSepolia, transport: http(cfg.rpcUrl) });
    this.vault = cfg.vault;
  }

  async getState(): Promise<OnChainVaultState> {
    const read = (functionName: "totalAssets" | "totalSupply" | "navPerShareWad" | "depositsHalted") =>
      this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName });
    const [totalAssets, totalSupply, navPerShareWad, depositsHalted] = await Promise.all([
      read("totalAssets") as Promise<bigint>,
      read("totalSupply") as Promise<bigint>,
      read("navPerShareWad") as Promise<bigint>,
      read("depositsHalted") as Promise<boolean>,
    ]);
    return { totalAssets, totalSupply, navPerShareWad, depositsHalted };
  }

  async pokeNav(): Promise<Hex> {
    return this.wallet.writeContract({ address: this.vault, abi: VAULT_ABI, functionName: "pokeNav" });
  }
}

/** Build a live client from env, or null if the deployment isn't configured. */
export function viemClientFromEnv(): ViemVaultClient | null {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.KEEPER_PRIVATE_KEY;
  const vault = process.env.VAULT_ADDRESS;
  if (!rpcUrl || !privateKey || !vault) return null;
  return new ViemVaultClient({ rpcUrl, privateKey: privateKey as Hex, vault: vault as Address });
}
