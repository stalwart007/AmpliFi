/* =============================================================================
 * AmpliFi terminal — wagmi + RainbowKit configuration
 * -----------------------------------------------------------------------------
 * The wallet stack: wagmi (account/connection state) + viem (transport) +
 * RainbowKit (the connect modal: injected wallets via EIP-6963, plus
 * WalletConnect mobile wallets and Coinbase Wallet).
 *
 * WalletConnect needs a free project id from https://cloud.reown.com — set it as
 * VITE_WC_PROJECT_ID in a .env file. Without it, injected browser wallets still
 * work; only the WalletConnect/mobile options are disabled.
 * ===========================================================================*/

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, mainnet, baseSepolia } from "wagmi/chains";

const PROJECT_ID =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_WC_PROJECT_ID) || "amplifi_dev_placeholder";

export const wagmiConfig = getDefaultConfig({
  appName: "AmpliFi",
  projectId: PROJECT_ID,
  chains: [base, mainnet, baseSepolia],
  ssr: false,
});
