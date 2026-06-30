# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/). The project is
pre-1.0 and **unaudited / testnet-grade**.

## [Unreleased]

### Added
- Permissioned `AmplifiGatedVault` + `AllowlistGate` (direct / Merkle / EIP-712
  signed-pass admission) and a `PanopticVenueAdapter` against an `IPanopticPool`
  seam (reference binding to Panoptic v1-core).
- Base Sepolia deploy script (`script/DeployTestnet.s.sol`) and `DEPLOY.md`.
- Interactive React terminal: landing page, RainbowKit/wagmi/viem wallet connect
  with sign-in signature, live TradingView market charts, and the TimeMachine
  dashboard driving the real TS engine in-browser.

### Changed
- Hardened `AmplifiVault`: `setVenue` now requires an allowlisted venue with a
  matching asset (finding #2); deposits enforce a `minExposureBps` slippage floor
  instead of `0` (finding #7); first-deposit minimum mitigates the ERC-4626
  inflation attack (finding #5).
- Documentation reframed from "production-grade" to an honest **testnet-grade /
  audit-pending** status; removed brittle, inconsistent hard-coded test counts.

### Known gaps (see SECURITY_REVIEW.md / PRODUCTION_READINESS.md)
- No independent audit. NAV is sourced from a **mock** options venue. The live
  Panoptic binding, a monitored keeper, and timelock/multisig governance custody
  are required before any mainnet consideration.
