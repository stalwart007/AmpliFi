/* =============================================================================
 * keeper / oracleSigner
 * -----------------------------------------------------------------------------
 * The PRIVATE side of the SignedPriceOracle. Your proprietary pricing model runs
 * here, off-chain, and never leaves this process. This module only takes the
 * model's *output* (a price), signs it with the oracle signer key via EIP-712,
 * and submits the signed value on-chain. On-chain, a transparent verifier checks
 * the signature — so the chain proves HOW a price is accepted while your model
 * (the WHY) stays confidential.
 *
 * Keep the signer key and the `PriceModel` implementation out of the repo /
 * public artifacts (env + a private module). This is privacy, not obscurity: the
 * verifier contract is fully readable; only your alpha is hidden.
 * ===========================================================================*/

import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ORACLE_ABI = [
  {
    type: "function",
    name: "submitPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "price", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Your PRIVATE pricing model. Returns a price scaled by the oracle's decimals.
 *  Implement this off-chain (and keep it out of the public repo). */
export type PriceModel = () => Promise<bigint> | bigint;

export interface OracleSignerConfig {
  rpcUrl: string;
  signerKey: Hex; // the oracle signer's private key (secret)
  oracle: Address; // SignedPriceOracle address
  chain: Chain; // viem chain (must match the deployment's chainId)
}

export class OracleSigner {
  private readonly pub;
  private readonly wallet;
  private readonly account;
  private readonly oracle: Address;

  constructor(cfg: OracleSignerConfig) {
    this.account = privateKeyToAccount(cfg.signerKey);
    this.pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
    this.oracle = cfg.oracle;
  }

  /** Sign the given price (from your private model) and publish it on-chain. */
  async publish(price: bigint): Promise<Hex> {
    const nonce = (await this.pub.readContract({ address: this.oracle, abi: ORACLE_ABI, functionName: "nonce" })) as bigint;
    const next = nonce + 1n;
    // Stamp with the CHAIN's latest block time (not the local wall clock), so it
    // is never ahead of `block.timestamp` — critical on forks whose clock lags.
    const timestamp = (await this.pub.getBlock()).timestamp;

    const signature = await this.wallet.signTypedData({
      account: this.account,
      domain: {
        name: "AmpliFiSignedOracle",
        version: "1",
        chainId: this.wallet.chain!.id,
        verifyingContract: this.oracle,
      },
      types: {
        PriceUpdate: [
          { name: "price", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "PriceUpdate",
      message: { price, timestamp, nonce: next },
    });

    return this.wallet.writeContract({
      address: this.oracle,
      abi: ORACLE_ABI,
      functionName: "submitPrice",
      args: [price, timestamp, next, signature],
    });
  }

  /** Run a private model and publish its result. */
  async publishFrom(model: PriceModel): Promise<Hex> {
    return this.publish(await model());
  }
}
