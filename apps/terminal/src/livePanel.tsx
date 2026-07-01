/* =============================================================================
 * AmpliFi terminal — Live Vault panel
 * -----------------------------------------------------------------------------
 * When VITE_VAULT_ADDRESS is configured, this panel talks to the real deployed
 * vault (fork/testnet) via onchain.ts: live NAV/shares/assets, and real
 * deposit / redeem / poke through the connected wallet. Without config it stays
 * out of the way and the terminal runs the in-browser simulation.
 * ===========================================================================*/

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { onchainConfig, readVault, depositOnchain, redeemOnchain, pokeNavOnchain, type LiveVaultState } from "./onchain";
import { fmtNum } from "./viz";

export function LiveVaultPanel() {
  const cfg = onchainConfig();
  const { address } = useAccount();
  const [state, setState] = useState<LiveVaultState | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!cfg || !address) return;
    try {
      setState(await readVault(cfg, address as `0x${string}`));
      setErr("");
    } catch (e) {
      setErr(String((e as Error).message ?? e).slice(0, 120));
    }
  }, [cfg, address]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!cfg) {
    return <div className="panel-body muted pad">Simulation mode — set VITE_VAULT_ADDRESS to drive a deployed vault.</div>;
  }
  if (!address) {
    return <div className="panel-body muted pad">Connect a wallet to use the live vault.</div>;
  }

  const dec = state?.assetDecimals ?? 6;
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr("");
    try {
      await fn();
      await refresh();
      setAmt("");
    } catch (e) {
      setErr(String((e as Error).message ?? e).slice(0, 160));
    } finally {
      setBusy("");
    }
  };

  const deposit = () =>
    run("deposit", () => depositOnchain(cfg, address as `0x${string}`, state!.asset, parseUnits(amt || "0", dec), state!.allowance));
  const redeem = () => run("redeem", () => redeemOnchain(cfg, address as `0x${string}`, parseUnits(amt || "0", dec)));
  const poke = () => run("poke", () => pokeNavOnchain(cfg, address as `0x${string}`));

  return (
    <div className="panel-body">
      <div className="live-badge">
        <span className="dot green" /> LIVE · chain {cfg.chainId} · vault {cfg.vault.slice(0, 6)}…{cfg.vault.slice(-4)}
      </div>
      {state && (
        <div className="stat-row tight">
          <div className="stat">
            <div className="stat-label">Total assets</div>
            <div className="stat-value cyan">{fmtNum(Number(formatUnits(state.totalAssets, dec)), 2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">NAV / share</div>
            <div className="stat-value">{fmtNum(Number(formatUnits(state.navPerShareWad, 18)), 4)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Your AFI</div>
            <div className="stat-value">{fmtNum(Number(formatUnits(state.shares, dec)), 2)}</div>
          </div>
        </div>
      )}
      <div className="io-row">
        <input className="io-input" placeholder="amount" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" />
        <button className="op-btn primary" onClick={deposit} disabled={!!busy || !amt}>
          {busy === "deposit" ? "…" : "Deposit"}
        </button>
        <button className="op-btn" onClick={redeem} disabled={!!busy || !amt}>
          {busy === "redeem" ? "…" : "Redeem"}
        </button>
      </div>
      <button className="op-btn" onClick={poke} disabled={!!busy}>
        {busy === "poke" ? "…" : "⌁ pokeNav (keeper)"}
      </button>
      {state?.depositsHalted && <div className="io-warn">deposits halted (wound down)</div>}
      {err && <div className="gate-err">{err}</div>}
    </div>
  );
}
