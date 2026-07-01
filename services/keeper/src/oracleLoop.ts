/* =============================================================================
 * keeper / oracleLoop — runnable price publisher
 * -----------------------------------------------------------------------------
 * Publishes signed prices to a deployed SignedPriceOracle on an interval. Your
 * PRIVATE model replaces `referenceModel` below (keep the real one out of the
 * repo — import it from a private module or compute it here off-chain). Only the
 * signed *result* is submitted on-chain.
 *
 *   RPC_URL            node RPC (e.g. http://127.0.0.1:8545 for the fork)
 *   ORACLE_SIGNER_KEY  the signer private key (must match the oracle's signer)
 *   ORACLE_ADDRESS     deployed SignedPriceOracle address
 *   ORACLE_INTERVAL_MS publish cadence (default 15000)
 *
 *   npm run oracle --workspace @amplifi/keeper
 * ===========================================================================*/

import { mainnet } from "viem/chains";
import type { Hex } from "viem";
import { OracleSigner, type PriceModel } from "./oracleSigner";

/** PLACEHOLDER for your private pricing model — swap for the real one.
 *  Returns a price scaled by the oracle's decimals (8 here). */
const referenceModel: PriceModel = () => {
  const base = 2000;
  const jitter = (Math.random() - 0.5) * 20; // ±$10 wobble
  return BigInt(Math.round((base + jitter) * 1e8));
};

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL;
  const signerKey = process.env.ORACLE_SIGNER_KEY as Hex | undefined;
  const oracle = process.env.ORACLE_ADDRESS as `0x${string}` | undefined;
  if (!rpcUrl || !signerKey || !oracle) {
    console.error("set RPC_URL, ORACLE_SIGNER_KEY, ORACLE_ADDRESS");
    process.exit(1);
    return;
  }
  const signer = new OracleSigner({ rpcUrl, signerKey, oracle, chain: mainnet });
  const interval = Number(process.env.ORACLE_INTERVAL_MS ?? 15000);
  console.log(`oracle publisher → ${oracle} every ${interval}ms`);

  for (;;) {
    try {
      const price = await referenceModel();
      const tx = await signer.publish(price);
      console.log(`published ${price.toString()} (1e8)  tx=${tx}`);
    } catch (err) {
      console.error("publish failed:", String(err).slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
