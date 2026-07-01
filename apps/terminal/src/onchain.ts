/* =============================================================================
 * AmpliFi terminal — on-chain layer
 * -----------------------------------------------------------------------------
 * viem read/write against a deployed AmplifiGatedVault. When the app is
 * configured with live addresses (VITE_VAULT_ADDRESS / VITE_RPC_URL /
 * VITE_CHAIN_ID) it drives the real contracts (fork, testnet, …); otherwise the
 * terminal runs the in-browser TimeMachine simulation. Writes go through the
 * connected injected wallet; reads use a public RPC client.
 * ===========================================================================*/

import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from "viem";

export const VAULT_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pokeNav", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "navPerShareWad", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "depositsHalted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export interface OnchainConfig {
  vault: Address;
  rpcUrl: string;
  chainId: number;
}

/** Read live config from Vite env; null → run the in-browser simulation. */
export function onchainConfig(): OnchainConfig | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const vault = env.VITE_VAULT_ADDRESS;
  if (!vault) return null;
  return { vault: vault as Address, rpcUrl: env.VITE_RPC_URL ?? "http://127.0.0.1:8545", chainId: Number(env.VITE_CHAIN_ID ?? 1) };
}

function publicClient(cfg: OnchainConfig) {
  return createPublicClient({ transport: http(cfg.rpcUrl) });
}
function walletClient() {
  if (!window.ethereum) throw new Error("no injected wallet");
  return createWalletClient({ transport: custom(window.ethereum as never) });
}

export interface LiveVaultState {
  totalAssets: bigint;
  totalSupply: bigint;
  navPerShareWad: bigint;
  shares: bigint;
  asset: Address;
  depositsHalted: boolean;
  assetDecimals: number;
  assetBalance: bigint;
  allowance: bigint;
}

export async function readVault(cfg: OnchainConfig, account: Address): Promise<LiveVaultState> {
  const pub = publicClient(cfg);
  const call = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address: cfg.vault, abi: VAULT_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [totalAssets, totalSupply, navPerShareWad, shares, asset, depositsHalted] = await Promise.all([
    call<bigint>("totalAssets"),
    call<bigint>("totalSupply"),
    call<bigint>("navPerShareWad"),
    call<bigint>("balanceOf", [account]),
    call<Address>("asset"),
    call<boolean>("depositsHalted"),
  ]);
  const erc = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address: asset, abi: ERC20_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [assetDecimals, assetBalance, allowance] = await Promise.all([
    erc<number>("decimals"),
    erc<bigint>("balanceOf", [account]),
    erc<bigint>("allowance", [account, cfg.vault]),
  ]);
  return { totalAssets, totalSupply, navPerShareWad, shares, asset, depositsHalted, assetDecimals, assetBalance, allowance };
}

/** Approve (if needed) then deposit `assets` into the vault. Returns tx hashes. */
export async function depositOnchain(cfg: OnchainConfig, account: Address, asset: Address, assets: bigint, currentAllowance: bigint): Promise<Hex> {
  const wallet = walletClient();
  if (currentAllowance < assets) {
    const approveHash = await wallet.writeContract({ account, chain: null, address: asset, abi: ERC20_ABI, functionName: "approve", args: [cfg.vault, assets] });
    await publicClient(cfg).waitForTransactionReceipt({ hash: approveHash });
  }
  return wallet.writeContract({ account, chain: null, address: cfg.vault, abi: VAULT_ABI, functionName: "deposit", args: [assets, account] });
}

export async function redeemOnchain(cfg: OnchainConfig, account: Address, shares: bigint): Promise<Hex> {
  return walletClient().writeContract({ account, chain: null, address: cfg.vault, abi: VAULT_ABI, functionName: "redeem", args: [shares, account, account] });
}

export async function pokeNavOnchain(cfg: OnchainConfig, account: Address): Promise<Hex> {
  return walletClient().writeContract({ account, chain: null, address: cfg.vault, abi: VAULT_ABI, functionName: "pokeNav", args: [] });
}
