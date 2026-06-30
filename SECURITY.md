# Security Policy

See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md)

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Preferred: GitHub Security Advisories (the "Report a vulnerability" button under
  the repo's **Security** tab).
- Or email the maintainer (replace with a monitored address before any public or
  testnet launch): `security@example.com`.

Include: affected component/commit, a description, and a proof-of-concept if
possible. We aim to acknowledge within 72 hours.

## Scope

In scope: the Solidity contracts in `contracts/src`, the off-chain keeper/risk
logic, and anything that affects fund safety or NAV integrity.

Out of scope (known/accepted): the `Mock*` contracts (test-only), the in-browser
simulation in `apps/terminal`, and the items already disclosed as open in
`SECURITY_REVIEW.md`.

## Bug bounty

No formal bounty program yet. A program should be established before mainnet.
