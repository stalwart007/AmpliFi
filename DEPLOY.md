# Deploying AmpliFi

> **Mainnet is gated.** This document deploys to a **testnet** only. The vault
> custodies funds and has **not had an independent audit**, and the on-chain
> Panoptic binding here uses `MockPanopticPool`, not the real protocol. Deploying
> this to mainnet with real funds would put user money at irreversible risk. The
> mainnet checklist at the bottom is the work that must happen first.

## 1. Frontend wallet modal (RainbowKit + wagmi)

The terminal now connects real wallets through the RainbowKit modal.

```bash
cd /Users/ashish/amplifi
npm install            # pulls wagmi, viem, @tanstack/react-query, @rainbow-me/rainbowkit
npm run dev --workspace @amplifi/terminal
```

WalletConnect (mobile wallets) needs a free project id from
<https://cloud.reown.com>. Create `apps/terminal/.env`:

```
VITE_WC_PROJECT_ID=your_project_id_here
```

Without it, browser-extension wallets (MetaMask, Rabby, Coinbase, Brave, …) still
work via EIP-6963 — only the WalletConnect/mobile options are disabled.

To let your own wallet past the permissioning gate, add its address (lower-cased)
to `ALLOWLIST` in `apps/terminal/src/wallet.ts`, or use the operator passphrase.

## 2. Testnet contract deployment (Base Sepolia)

Run these on **your machine** (the contracts are verified to compile; this step
needs a funded key, which must never be pasted anywhere but your own shell).

**a. Install Foundry** (once):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**b. Vendor the libraries** into `lib/`. The repo isn't a git repository, so
`forge install` (git submodules) won't work — use plain `git clone` instead.
`foundry.toml` is preconfigured with `via_ir` and the matching remappings
(`forge-std` + OpenZeppelin v5.1.0):

```bash
cd /Users/ashish/amplifi/contracts
mkdir -p lib
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.1.0 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts

forge build      # compiles all contracts + scripts
forge test       # runs the full suite (vault, gate, Panoptic adapter, governance)
```

**c. Fund a throwaway key** with Base Sepolia ETH
(<https://www.alchemy.com/faucets/base-sepolia>) and deploy:

```bash
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export PK=0xYOUR_TESTNET_PRIVATE_KEY      # throwaway, testnet ETH only — never a real key
# optional: GOVERNOR, KEEPER, TREASURY, PANOPTIC_TOKENID, LEVERAGE_X

forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PK
```

Tip: do a dry run first (no `--broadcast`) to simulate locally and see every
contract get deployed and wired without spending gas:

```bash
forge script script/DeployTestnet.s.sol:DeployTestnet
```

The deployed addresses print in the broadcast/dry-run logs.

This deploys and wires the full permissioned stack:

- `MockUSDC` — testnet stablecoin
- `RiskController` — high-water mark + floor breach (wind-down at −60%)
- `AllowlistGate` — operator allowlist (governor + keeper pre-allowed)
- `MockPanopticPool` + `PanopticVenueAdapter` — the long-perpetual-options venue
- `AmplifiGatedVault` — the gated ERC-4626 AFI vault, repointed at the adapter

The deployed addresses are printed in the broadcast logs. Point the frontend at
them by replacing `VAULT_ADDRESS` / `AFI_TOKEN_ADDRESS` in
`apps/terminal/src/wallet.ts` and wiring `viem` `readContract`/`writeContract`
calls (next step — not yet built).

## 3. Verifying

```bash
node contracts/compile.mjs     # solc compile check (pure JS, no Foundry needed)
forge test                     # full Foundry suite incl. the Panoptic adapter
npm test                       # TS package suites
```

## Mainnet checklist (do NOT skip)

Mainnet deployment is deliberately **not** scripted here. Before it is even
considered, all of the following must be true:

1. **Independent audit** of `AmplifiVault` / `AmplifiGatedVault`,
   `RiskController`, `AllowlistGate`, `WithdrawalQueue`, the governance
   contracts, and the Panoptic adapter — findings remediated and re-reviewed.
2. **Real Panoptic integration** — bind the live `PanopticPool` +
   `CollateralTracker` (panoptic-labs/panoptic-v1-core) behind `IPanopticPool`,
   replacing `MockPanopticPool`, and test against a Panoptic testnet pool.
3. **Real USDC** address and decimals wired in; remove all `Mock*` contracts.
4. **GOVERNOR → timelock + multisig**; **KEEPER** on dedicated, monitored keys.
5. A **live, redundant keeper** running `pokeNav` / hedging, with alerting.
6. **Guarded launch**: low deposit cap, allowlist on, gradual relaxation.
7. Bug bounty + monitoring + an incident runbook.

See `PRODUCTION_READINESS.md` and `SECURITY_REVIEW.md` for the full gate.
