/* @amplifi/protocol-bindings — typed contract surface + provider-abstracted client. */
export { AMPLIFI_VAULT_ABI, RISK_CONTROLLER_ABI, ERC20_ABI } from "./abi";
export type { VaultFn } from "./abi";
export { VaultClient, toBaseUnits, fromBaseUnits, fromWad } from "./client";
export type { ContractProvider } from "./client";
export { MemoryProvider } from "./memory";
export type { MemoryVaultConfig } from "./memory";
export { createViemProvider } from "./viem";
export type { ViemReadClient, ViemWriteClient, ViemProviderOptions } from "./viem";
export const PROTOCOL_BINDINGS_VERSION = "0.1.0";
