# Production Readiness

AmpliFi's engineering is built to production standards. This document is the
single source of truth for **what is done** and **what remains before the
protocol custodies real funds on mainnet**. It is the checklist an auditor,
integrator, or investor's technical advisor will expect.

## Maturity at a glance

| Layer                       | Built to production standard |               Verified here                | Remaining gate                            |
| --------------------------- | :--------------------------: | :----------------------------------------: | ----------------------------------------- |
| `quant-core` (pricing/risk) |              ✅              |  38 numerical checks, strict `tsc`, lint   | —                                         |
| `strategy-core` (strategy)  |              ✅              |      34 property tests, deterministic      | —                                         |
| `contracts/` (vault stack)  |              ✅              | compiles vs OZ 5.1; Foundry suite authored | **independent audit**, live-venue adapter |
| CI / packaging / docs       |              ✅              |       green typecheck + lint + tests       | —                                         |

## Done

**Quant & strategy libraries.** Deterministic, dependency-free, fully typed.
Pricing, implied vol, SVI surface with arbitrage checks, full-revaluation
Monte-Carlo VaR/ES, and the complete strategy state machine (risk-parity basket,
delta-band hedging, epoch compounding, drawdown wind-down). Verified by
property-based harnesses asserting implementation-independent facts — including
the capped-downside invariant.

**Smart contracts.** `AmplifiVault` (ERC-4626) computes NAV honestly as
`idle reserve + venue.markToMarket()` and never fabricates returns. Hardened
with:

- role-based access control (GOVERNOR / KEEPER / ADMIN) — no single owner key
  over strategy operations;
- `ReentrancyGuard` on every asset-moving entrypoint;
- `Pausable` emergency stop and an independent deposit halt latched on wind-down;
- deposit caps for a guarded launch;
- a portfolio-level `RiskController` (drawdown floor → wind-down, not per-asset
  liquidation);
- a high-water-mark performance fee capped at 20%;
- custom errors, full events, and NatSpec throughout.

Compiles clean against OpenZeppelin 5.1 with `solc 0.8.24`. A Foundry test suite
covers deposit/redeem share math, premium routing, capped downside (book → 0),
wind-down at the floor, deposits-halted-but-redeemable, access control, deposit
caps, the performance fee, and a NAV-non-negative fuzz test.

**Engineering hygiene.** npm workspaces, shared strict TS config, ESLint +
Prettier, CI running typecheck + lint + tests on every push.

## Remaining gates before mainnet (must-do)

1. **Independent security audit** of `contracts/` by a reputable firm; remediate
   findings; publish the report. _This is the non-negotiable gate — in-house
   tests do not substitute for it._ An internal self-review has already scoped
   the engagement: see [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md) (11 findings,
   dominated by the oracle/venue trust boundary and governance centralisation).
2. **Live options-venue adapter.** Implement `IOptionsVenue` against a real venue
   (e.g. Panoptic / Aperture or a perp-options AMM), including its own tests and
   audit. Replace `MockOptionsVenue` in deployment.
3. **Oracle hardening.** Source `markToMarket` from manipulation-resistant
   pricing (TWAP / signed feeds), with staleness and deviation guards.
4. **Economic review.** Independent validation of the fee model, wind-down
   thresholds, and leverage bounds against historical stress scenarios.
5. **Operational readiness.** Keeper redundancy and monitoring, timelock on
   GOVERNOR actions, a multisig for ADMIN, incident runbooks, and a public bug
   bounty.
6. **Mainnet guarded launch.** Low deposit cap, allowlist, and a staged cap-raise
   gated on live metrics.

## Hardening backlog (recommended)

- Partial-unwind on withdrawal (current reference settles the whole book on a
  reserve shortfall — correct but capital-inefficient).
- Withdrawal queue for large redemptions during volatile epochs.
- Per-epoch accounting events for off-chain analytics parity with `strategy-core`.
- Formal-verification / invariant fuzzing (e.g. Halmos / Echidna) of the
  capped-downside and share-math invariants.

## Status summary

The code is production-grade and audit-ready. It is **not** cleared for real-fund
custody until items 1–2 above are complete. Until then it runs on testnet.
