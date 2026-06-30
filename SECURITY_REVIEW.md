# AmpliFi — Internal Security Review

**Scope:** `contracts/src/` — `AmplifiVault.sol`, `RiskController.sol`,
`interfaces/IOptionsVenue.sol`, and the test/testnet mocks.
**Reviewer:** internal (AmpliFi engineering).
**Date:** 2026-06.
**Method:** manual review + the property/Foundry test suite + the executable
`@amplifi/protocol-bindings` reference of the vault accounting.

> ⚠️ **This is an internal self-review, not an independent audit.** It exists to
> harden the code and scope the external engagement — it does **not** clear the
> protocol for mainnet custody of real funds. The independent audit remains a
> hard gate (see `PRODUCTION_READINESS.md`). Findings here are the author's own
> assessment and may be incomplete; a third-party auditor will find more.

## Severity summary

| #   | Severity | Title                                                        | Status                               |
| --- | -------- | ------------------------------------------------------------ | ------------------------------------ |
| 1   | High     | Venue mark drives NAV with no oracle hardening               | Open — design gate                   |
| 2   | High     | `setVenue` lets governance repoint to a malicious venue      | Mitigate (timelock + allowlist)      |
| 3   | High     | Venue counterparty/freeze risk — no emergency exit           | Open — design gate                   |
| 4   | Medium   | Keeper liveness: NAV poke / wind-down is permissioned        | Mitigate                             |
| 5   | Medium   | ERC-4626 first-depositor inflation attack                    | Mitigate (dead shares / min deposit) |
| 6   | Medium   | Whole-book settlement on any withdrawal shortfall            | Backlog (partial unwind + queue)     |
| 7   | Medium   | Deposit premium routed with `minExposure = 0`                | Mitigate                             |
| 8   | Medium   | Privileged epoch reset can move the high-water mark          | Mitigate (governance controls)       |
| 9   | Low      | Performance-fee crystallisation rounding / HWM post-dilution | Note                                 |
| 10  | Low      | No upgrade path (non-proxy) — no in-place bug fix            | Accepted trade-off                   |
| 11  | Info     | Centralised roles need timelock + multisig                   | Mitigate                             |

## Findings

### 1. (High) Venue mark drives NAV without oracle hardening

`AmplifiVault.totalAssets() = idle + venue.markToMarket()`. The share price, the
performance fee, and the wind-down trigger all derive from a single external
read. A manipulable or mispriced venue mark directly manipulates share price
(mint/redeem arbitrage) and can suppress or trigger wind-down.
**Mitigation:** source the mark from manipulation-resistant pricing (TWAP /
signed feeds), bound per-poke deviation, and add staleness checks. Tracked as
gate #3 in `PRODUCTION_READINESS.md`.

### 2. (High) `setVenue` can repoint to a malicious venue

`setVenue` (GOVERNOR) swaps the venue with no validation. A compromised governor
key could point the vault at a venue that reports an inflated mark or captures
premium routed on the next deposit/`deployIdle`.
**Mitigation:** put GOVERNOR behind a **timelock + multisig**, add a venue
allowlist with a delay on additions, and emit/monitor `VenueUpdated`.

### 3. (High) Venue counterparty / freeze risk — no emergency exit

Premium is transferred to the venue; if the venue is exploited, paused, or
becomes insolvent, `settle()` may not return funds and depositor capital is
stuck. There is no vault-side emergency path independent of the venue.
**Mitigation:** require the venue adapter to support non-custodial settlement /
withdrawal guarantees, add a guardian-triggered emergency mode, and cap
per-venue exposure. This is inherent to the integration and part of the
live-venue gate.

### 4. (Medium) Keeper liveness for NAV poke / wind-down

`pokeNav` is KEEPER-only. If the keeper stalls, the high-water mark and the
floor breach are not evaluated, delaying wind-down precisely when it matters.
**Mitigation:** run redundant keepers with monitoring (already a readiness
item), and/or allow a permissionless `pokeNav` (state-changing only via the
RiskController, which is safe to call by anyone) or an incentivised poke.

### 5. (Medium) ERC-4626 first-depositor inflation attack

OZ v5 ERC-4626 mitigates with virtual shares/assets, but a large first deposit
paired with a direct `asset` transfer can still skew the exchange rate for a
griefer.
**Mitigation:** mint a small amount of dead shares at deployment (seed the
vault), set a minimum first deposit, or raise `_decimalsOffset()`.

### 6. (Medium) Whole-book settlement on any withdrawal shortfall

`_withdraw` calls `venue.settle()` (liquidating the entire book) whenever idle
reserve is short. One large redemption crystallises every holder's mark-to-market
and is capital-inefficient.
**Mitigation:** partial unwind of only the needed slice; add a withdrawal queue
for large redemptions during volatile epochs. (Backlog in `PRODUCTION_READINESS.md`.)

### 7. (Medium) Deposit premium routed with `minExposure = 0`

`_deposit` calls `venue.openExposure(premium, 0)` — no slippage floor on the
exposure manufactured for a depositor.
**Mitigation:** compute a `minExposure` off-chain and thread it through, or set a
conservative on-chain floor relative to premium.

### 8. (Medium) Privileged epoch reset moves the high-water mark

`RiskController.resetEpoch(navWad)` (GOVERNOR) re-seeds the HWM. A careless or
malicious value could relax the wind-down floor or wrongly reset performance-fee
accounting.
**Mitigation:** constrain `resetEpoch` (only after a latched wind-down, HWM
re-seeded from the live NAV, not an arbitrary argument), behind the timelock.

### 9. (Low) Performance-fee rounding & HWM after dilution

`_crystalliseFee` mints fee shares via `previewDeposit(feeAssets)` and sets
`lastFeeNavWad` to the pre-dilution NAV. Minting dilutes NAV slightly, so the
next high-water reference is marginally optimistic; rounding favours/penalises by
≤ 1 wei-share.
**Mitigation:** recompute `lastFeeNavWad` post-mint, and add invariant tests
asserting the fee never exceeds `perfFeeBps` of the realised gain.

### 10. (Low) No upgrade path

Contracts are non-proxy (smaller attack surface, no admin-upgrade rug vector),
but there is no in-place bug-fix path; a flaw requires a migration.
**Accepted trade-off** for the reference design; revisit with a governance-gated,
timelocked proxy if needed.

### 11. (Informational) Centralised roles

GOVERNOR and KEEPER are EOAs in the demo deploy script.
**Mitigation:** GOVERNOR → timelock + multisig; KEEPER → dedicated keys with
monitoring; document the trust model for depositors.

## What the test suite already proves

The Foundry suite (and the TS property tests that mirror it) cover: deposit/redeem
share math, premium routing, **capped downside** (book → 0 never goes negative),
wind-down at the floor, deposits-halted-but-redeemable, access control, deposit
caps, the performance fee, and a NAV-non-negative fuzz test. Reentrancy is
guarded on every asset-moving entrypoint; emergency pause and the deposit halt
are present.

## Remediation update (this build)

Three contracts have been added to address the governance and withdrawal findings
(all compile clean against OpenZeppelin 5.1, with a Foundry suite):

- **`governance/AmplifiTimelock.sol`** (OZ `TimelockController` wrapper) — holds the
  vault/RiskController `GOVERNOR_ROLE`, so `setVenue` (#2) and `resetEpoch` (#8)
  and every fee/policy change must be queued and can only execute after a delay,
  giving depositors a window to exit. **Addresses #2, #8.**
- **`governance/MultisigGuardian.sol`** — an m-of-n multisig that holds the
  timelock's PROPOSER role, so no single key controls governance. **Addresses #11.**
- **`periphery/WithdrawalQueue.sol`** — FIFO escrow-and-process queue so a large
  redemption no longer forces a whole-book liquidation; the keeper drains it as
  liquidity allows and holders claim settled assets. **Addresses #6.**

A further contract addresses the oracle/venue trust boundary:

- **`OracleHardenedVenue.sol`** + **`IPriceOracle.sol`** — the book is marked only
  off a **validated cached price**. `syncPrice` enforces a staleness bound and a
  per-update deviation bound before caching, so a single manipulated block cannot
  jump NAV (it is rejected, or at most moves by the bounded deviation). A GUARDIAN
  can `setPaused` and `emergencyWithdraw`, providing a vault-side exit independent
  of the venue. **Addresses #1 (oracle hardening) and #3 (emergency exit).**

These are reference wiring (the deployment must grant roles to the
timelock/multisig, route large redemptions through the queue, and bind a real
oracle + live-venue adapter behind `IPriceOracle`/`IOptionsVenue`); the audit
must still confirm the integration end-to-end. The remaining gate is the live
options-venue integration plus the independent audit itself.

## Conclusion

The contracts are written to production standards and the **capped-downside
invariant holds**. The dominant residual risks are the **oracle/venue trust
boundary** (findings 1–3) and **governance centralisation** (2, 8, 11) — both
inherent to wiring a live options venue and both explicitly gated behind the
independent audit + live-venue integration in `PRODUCTION_READINESS.md`. Do not
custody real funds until those are closed and the external audit is complete.
