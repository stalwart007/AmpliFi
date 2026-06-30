# Production Readiness — the complete checklist

This is the single source of truth for **everything** required before AmpliFi
could custody real funds on mainnet. It is intentionally exhaustive.

**Read this first:** AmpliFi is currently **testnet-grade and unaudited**. The
dominant gates are deliberately *not* code — an independent audit, a live options
venue, and legal/regulatory clearance. The engineering can be (and largely is)
made solid; that does **not** make the protocol production-ready for real money.

### Legend
- `[x]` done in-repo · `[ ]` doable in code, not yet done · `🔒` external gate
  (requires an auditor / counterparty / lawyer / multi-person org / real money —
  no commit can satisfy it).

---

## A. Smart contracts & security  *(the dominant gate)*

- `🔒` **Independent security audit** by a reputable firm (ideally two), findings
  remediated and **re-audited**, report published. *Non-negotiable. Nothing below
  matters for real funds until this is done.*
- `🔒` **Live options-venue integration** — bind the real Panoptic
  `PanopticPool` + `CollateralTracker` behind `IPanopticPool`, replacing
  `MockPanopticPool`; test against Panoptic's testnet pools, then mainnet. The
  returns engine is currently a mock.
- `🔒` **Bug bounty** (e.g. Immunefi) live before/at launch.
- `🔒` **Economic/risk audit** — independent validation of leverage bounds,
  wind-down thresholds, fee model, and behaviour under historical gap/crash
  scenarios and depeg/oracle-failure cases.
- `[x]` Honest NAV (`idle + venue.markToMarket()`), capped-downside design.
- `[x]` Role-based access control, `ReentrancyGuard`, `Pausable`, deposit caps.
- `[x]` `setVenue` allowlist + asset-match; deposit slippage floor; first-deposit
  inflation guard.
- `[x]` Foundry tests + a vault invariant suite (NAV identity, no over-issuance).
- `[~]` **Invariant/fuzz coverage** — vault invariant suite + fuzz for
  AllowlistGate and RiskController added; WithdrawalQueue/adapter still unit-only.
  Echidna/Halmos campaigns still to add.
- `[x]` **Oracle-hardened venue deployable** — `OracleHardenedVenue` (staleness +
  deviation guards, guardian exit) bindable via `USE_ORACLE_VENUE=true` in the
  deploy. *Production still needs a real oracle + fallback, not the mock feed.*
- `[ ]` **Upgradeability decision** — either a timelocked UUPS proxy *or* a
  documented immutable + migration plan (currently non-proxy).
- `[ ]` **Emergency playbook tested on a fork** — pause/guardian/emergency-exit
  exercised end-to-end (guards exist in code; fork E2E still to write).
- `[x]` Per-epoch / NAV-poke accounting event (`NavPoked`) for off-chain parity.
- `[ ]` Deterministic deploy + **source verification** on the explorer.
- `🔒` Mainnet **governance = timelock + real m-of-n Safe** with independent
  signers (the deploy now wires a timelock + multisig by default, but real
  signers are an org input).

## B. Quant / strategy

- `[x]` Deterministic pricing, IV, SVI, Heston, exotics, full-reval MC VaR/ES.
- `[x]` Strategy state machine: basket, hedge, epoch, wind-down, costs.
- `[ ]` Backtest against **real historical data** (not just synthetic GBM/jumps).
- `🔒` Sign-off that the strategy is economically sound for live capital.

## C. Off-chain services & infrastructure

- `[x]` API-key auth, per-IP rate limiting, JSON access logging (`svc-kit`).
- `[x]` Dockerfiles + `docker-compose` (non-root, healthchecks).
- `[x]` **TLS/HTTPS** + HSTS via the Caddy reverse proxy (`infra/caddy`).
- `[x]` **Secrets management** — k8s Secret wiring (`infra/k8s`) + docs; keys
  injected at runtime, never in images/git. *(KMS + rotation still recommended.)*
- `[x]` **Prometheus metrics** (`/metrics`) + per-request counters/latency.
  *(OpenTelemetry tracing + dashboards/alerting still to add.)*
- `[x]` Readiness (`/ready`) + liveness (`/health`) probes; resource limits in
  the k8s manifests. *(Graceful-shutdown handler still to add.)*
- `[x]` Kubernetes manifests + a tag-triggered image **CD** workflow.
  *(Terraform IaC + canary/blue-green still to add.)*
- `🔒` On-call rotation, SLOs, incident runbooks (org/process).

## D. Keeper (off-chain agent)

- `[x]` **Live chain client** (viem) implemented — reads NAV/state and submits
  `pokeNav` against a deployed vault, env-gated (`RPC_URL`,
  `KEEPER_PRIVATE_KEY`, `VAULT_ADDRESS`); falls back to the in-memory mirror.
  *Goes live once the testnet contracts are deployed.*
- `[ ]` **Redundant keepers** + leader election; liveness alerting.
- `[ ]` Gas strategy + **MEV/private-mempool** submission for wind-down/hedge.
- `[ ]` Parity test: the TS engine vs the on-chain contract (guards mock drift).

## E. Testing & QA

- `[x]` TS check harnesses + Solidity Foundry suite + one vault invariant suite.
- `[ ]` **Migrate to a real runner (vitest) with coverage thresholds** in CI.
- `[ ]` **Fork tests** against forked mainnet/Panoptic; full E2E
  (deposit→exposure→hedge→epoch→withdraw→wind-down).
- `[ ]` Frontend tests (Playwright E2E + component) and a wallet-safety review.
- `[ ]` Load/perf tests for the services.

## F. Frontend

- `[ ]` **Real on-chain wiring** (`readContract`/`writeContract` via viem) —
  currently an in-browser simulation. *Blocked on deploy addresses.*
- `[ ]` Tx lifecycle UX (pending/confirmed/failed), gas estimation, network
  switching, approval hygiene.
- `[ ]` CSP/security headers, accessibility, responsive QA.
- `[ ]` Hosting (IPFS/Arweave or CDN) + ENS; frontend security review.

## G. Process & governance

- `[x]` SECURITY.md, CONTRIBUTING.md, CODEOWNERS, CHANGELOG, Dependabot.
- `[x]` CI: typecheck + lint + tests + Foundry + `npm audit` (critical gate).
- `[ ]` Branch protection + required reviews; meaningful PR history.
- `🔒` **More than one contributor / reviewer** (bus factor); real review trail.
- `[ ]` Release process + semver + tagged releases.

## H. Legal / compliance / business

- `🔒` Legal entity, Terms of Service, Privacy Policy.
- `🔒` Regulatory analysis per jurisdiction (securities / MiCA / derivatives).
- `🔒` Sanctions/OFAC screening & geofencing if required.
- `🔒` Treasury, accounting, and tax handling.

## I. Documentation

- `[x]` README (honest status), ARCHITECTURE, TIMEMACHINE, SECURITY_REVIEW,
  AUDIT_RESPONSE, DEPLOY.
- `[ ]` User docs, integrator/API docs, threat model, ops runbooks.

---

## The bottom line

The four hard gates that make "production-ready for real funds" impossible to
claim today, in priority order:

1. **Independent audit** (+ remediation). 🔒
2. **Live, audited options venue** replacing the mock. 🔒
3. **Legal/regulatory clearance.** 🔒
4. **Real operational org** — multi-sig signers, on-call, monitoring, bug bounty. 🔒

Everything marked `[ ]` is engineering I can keep closing (and am). Everything
marked `🔒` requires people, money, time, and counterparties outside this repo.
Until 1–4 are done, AmpliFi runs on **testnet only**.
