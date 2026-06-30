/* =============================================================================
 * AmpliFi terminal — wallet + access control (wagmi + RainbowKit)
 * -----------------------------------------------------------------------------
 * Real, multi-wallet connection through the RainbowKit modal (injected wallets
 * via EIP-6963, WalletConnect mobile wallets, Coinbase Wallet), backed by wagmi
 * + viem. Account and chain state are reactive; allowlisted wallets prove key
 * ownership with a sign-in signature before entering.
 *
 * Access control: the protocol is permissioned. A wallet enters only if it is on
 * the allowlist (mirrored here as `ALLOWLIST`, enforced on-chain by
 * `AllowlistGate`) AND signs in — or the operator supplies the access passphrase
 * (a keyless bypass for development). The contract is the real boundary.
 * ===========================================================================*/

import { useCallback, useEffect, useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/** The protocol vault — the on-chain address deposits route to. */
export const VAULT_ADDRESS = "0xA11C5fA11c5FA11c5fa11C5fA11c5Fa11c5Fa11C";
export const AFI_TOKEN_ADDRESS = "0xAF1f0a4De5cF1B8C2a9E7D03b4E5F6071829CdEf";
export const CHAIN = { id: 8453, name: "Base" };

/** Allowlisted operator wallets (lower-cased). Mirrors `AllowlistGate`. */
export const ALLOWLIST = new Set<string>([
  "0x1d3f9c2a7b6e4f8051c2a3b4d5e6f7081920a3b4",
  "0x9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6",
]);

/** FNV-1a 32-bit — a tiny non-cryptographic digest for the demo passphrase gate. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const ACCESS_DIGEST = fnv1a("amplifi-operator");
export function checkAccessCode(code: string): boolean {
  return fnv1a(code.trim()) === ACCESS_DIGEST;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export type WalletStatus = "disconnected" | "connecting" | "unsigned" | "connected" | "denied";
export interface WalletState {
  status: WalletStatus;
  address: string | null;
  isDemo: boolean; // retained for UI compatibility; always false with a real wallet
  allowed: boolean;
  chainId: number;
  message: string;
}

export function useWallet() {
  const { address, isConnected, isConnecting, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [codeGranted, setCodeGranted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [note, setNote] = useState("");

  const addr = address ?? null;
  const onList = !!addr && ALLOWLIST.has(addr.toLowerCase());

  // A new account must re-prove ownership.
  useEffect(() => {
    setSignedIn(false);
  }, [addr]);

  let status: WalletStatus;
  let allowed = false;
  let message = note;
  if (codeGranted) {
    status = "connected";
    allowed = true;
    message = "Operator passphrase accepted";
  } else if (isConnecting) {
    status = "connecting";
  } else if (!isConnected || !addr) {
    status = "disconnected";
  } else if (!onList) {
    status = "denied";
    message = "Wallet not on the operator allowlist. Use the access passphrase to proceed.";
  } else if (!signedIn) {
    status = "unsigned";
    message = note || "Sign the verification message to enter.";
  } else {
    status = "connected";
    allowed = true;
    message = "Signed in";
  }

  const wallet: WalletState = { status, address: addr, isDemo: false, allowed, chainId: chainId ?? 0, message };

  const connect = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  /** Prove control of the connected key with a personal_sign signature. */
  const signIn = useCallback(async () => {
    if (!addr) return;
    try {
      const nonce = Math.random().toString(36).slice(2, 10);
      await signMessageAsync({ message: `Sign in to AmpliFi\nOperator: ${addr}\nChain: ${chainId ?? 0}\nNonce: ${nonce}` });
      setSignedIn(true);
      setNote("");
    } catch {
      setNote("Signature rejected — sign in to continue.");
    }
  }, [addr, chainId, signMessageAsync]);

  /** Operator passphrase bypass (keyless dev login). */
  const submitAccessCode = useCallback((code: string): boolean => {
    const ok = checkAccessCode(code);
    setCodeGranted(ok);
    return ok;
  }, []);

  const doDisconnect = useCallback(() => {
    disconnect();
    setCodeGranted(false);
    setSignedIn(false);
  }, [disconnect]);

  return { wallet, connect, disconnect: doDisconnect, submitAccessCode, signIn, hasInjected: true };
}
