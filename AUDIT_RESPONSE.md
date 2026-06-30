# Audit Response

Response to the external readiness review. Each item is marked **Fixed**,
**Mitigated**, **Deferred** (with reason), or **External** (cannot be solved by a
code change). The honest headline is unchanged: this is **testnet-grade and
unaudited**; the items below improve it but do not make it production-ready.

## On-chain / contracts

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| Mock-only venue | Returns engine is a mock | **External / Deferred** | A real venue requires Panoptic's live `PanopticPool`/`CollateralTracker`. The `PanopticVenueAdapter` + `IPanopticPool` seam is in place; binding live pools + audit is the remaining work. Disclosed prominently in README/PRODUCTION_READINESS. |
| #7 `openExposure(premium, 0)` | No slippage floor | **Fixed** | `AmplifiVault._deposit` now passes `minExposure = premium · minExposureBps/1e4` (default 1×, governance-settable). |
| #2 `setVenue` no validation | Repoint-to-malicious-venue vector | **Fixed** | `setVenue` now requires the target to be pre-allowlisted (`allowVenue`, GOVERNOR/timelock) **and** to share the vault's settlement asset. |
| #5 first-depositor inflation | No mitigation | **Fixed** | `minFirstDeposit` (≥ 1 whole asset unit, settable) blocks dust-seeding; combined with OZ v5 virtual shares. |
| Mitigations not wired | Timelock/Multisig/Queue/Oracle standalone | **Partially fixed** | `AmplifiGatedVault` (allowlist-gated deposits) and the hardened `setVenue`/slippage are now in the live vault path; `DeployTestnet` wires gate + adapter + roles. Timelock/multisig **custody** wiring is a deployment step (governor → timelock) documented in DEPLOY.md, not yet the default. |
| 3 High still open | oracle mark, venue repoint, venue freeze | **Partially fixed / External** | Repoint closed (#2). `OracleHardenedVenue` provides staleness+deviation guards and a guardian exit for the oracle/freeze risks; binding it (or Panoptic's oracle-free pricing) live remains audit-gated. |
| No upgrade path | non-proxy | **Accepted** | Deliberate (smaller attack surface); revisit with a timelocked proxy if needed. |
| Centralised EOAs | roles are EOAs in scripts | **Deferred** | DEPLOY.md mainnet checklist requires governor → timelock + multisig before launch. |
| Never audited | — | **External** | Must engage an independent firm. Hard gate. |

New: a **Foundry invariant suite** (`test/VaultInvariant.t.sol`) fuzzes
deposit/redeem/mark sequences and asserts the NAV identity, positive share price,
and no share over-issuance (capped-downside). Addresses "no invariant/fuzz tests."

## Testing

- **Inconsistent/self-reported counts** — **Fixed.** Removed the hard-coded
  "206/193/…" numbers from the README and badge; the suite (`npm test` /
  `forge test`) is the single source of truth.
- **Home-grown harness** — **Deferred.** The `tsx` check harness remains; moving
  to vitest is tracked but not yet done.
- **Mock vs contract drift / fork tests** — **Deferred.** Needs a fork-test
  harness against a deployed testnet; planned after the testnet deploy.

## Build & packaging

- **Build junk committed** (`vite.config.ts.timestamp-*.mjs`) — **Fixed.**
  Gitignored; remove from history with the `git rm` in the PR/commit.
- **Nested `packages/quant-core/package-lock.json`** — **Fixed.** Removed.
- **Packages don't emit JS/d.ts** — **Fixed.** `npm run build` now emits JS +
  `.d.ts` to `dist/` for all six packages (`tsconfig.build.json`), and
  `publishConfig` points the published `main`/`types`/`exports` at `dist`. The
  in-repo dev/test path still resolves `src`, so nothing breaks.

## Services & ops

- **No auth/rate-limit/logging; no Dockerfiles** — **Fixed.** `svc-kit` gained
  optional API-key auth, per-IP rate limiting, and JSON access logging
  (`securityFromEnv()`, env-driven, off by default for dev); `pricing-api` and
  `risk-engine` are wired to it. Added a Dockerfile per service + a
  `docker-compose.yml` (non-root, healthchecks).
- **Keeper has no live chain client** — **Deferred.** The viem provider is a
  reference stub; wiring it to the deployed testnet vault is the planned
  follow-up (needs the live contract addresses first).
- **Governance centralised by default** — **Fixed.** `DeployTestnet` now deploys
  the multisig + timelock and hands the vault's & RiskController's GOVERNOR/admin
  roles to the timelock, dropping the deployer's privileges, by default
  (`DECENTRALIZE=false` to opt out for local iteration).

## Repo hygiene & process

- **Missing SECURITY/CONTRIBUTING/CODEOWNERS/CHANGELOG/Dependabot** — **Fixed.**
  All added.
- **Lint covered only `packages/`** — **Fixed.** Now `packages services apps`;
  `no-explicit-any` raised from `off` to `warn` (surfaced, not silenced).
- **No `npm audit` in CI** — **Fixed.** Critical-severity vulns now **fail** CI
  (hard gate); high/moderate are advisory. (The current highs are transitive in
  the WalletConnect/Reown wallet-UI deps, fixable only upstream — gating on them
  would be permanent red noise.) CI Foundry job also fixed to vendor forge-std + OZ.
- **License contradiction** — **Fixed.** LICENSE clarifies the repo is public for
  transparency but source-available/proprietary (consistent with `UNLICENSED`).
- **Single squashed commit / bus factor 1** — **External.** Process/people, not a
  code change.

## Documentation framing

- **"✅ production-grade" overselling** — **Fixed.** README now leads with a
  testnet-grade / audit-pending banner and an honest status table.
