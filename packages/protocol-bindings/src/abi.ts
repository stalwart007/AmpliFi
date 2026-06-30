/* =============================================================================
 * @amplifi/protocol-bindings / abi
 * -----------------------------------------------------------------------------
 * Typed ABI fragments for the AmpliFi contracts. Kept as `as const` so a viem
 * client (or any ABI-aware tool) gets full type inference, and so the typed
 * client below can reference function names without stringly-typed drift.
 *
 * These mirror the Solidity in `contracts/` — keep them in sync (a production
 * setup would codegen these from the compiled artifacts; this hand-written set
 * is the same shape that step produces).
 * ===========================================================================*/

export const AMPLIFI_VAULT_ABI = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "navPerShareWad", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositsHalted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "pokeNav", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "event",
    name: "WoundDown",
    inputs: [
      { name: "navWad", type: "uint256", indexed: false },
      { name: "proceeds", type: "uint256", indexed: false },
    ],
  },
] as const;

export const RISK_CONTROLLER_ABI = [
  { type: "function", name: "floorBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "highWaterNavWad", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "woundDown", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "floorNavWad", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** Names of the functions the keeper/UI call, for drift-proof references. */
export type VaultFn = (typeof AMPLIFI_VAULT_ABI)[number] extends { name: infer N } ? N : never;
