# Contributing to AmpliFi

Thanks for your interest. AmpliFi is an unaudited, testnet-grade research
protocol; contributions that improve correctness, test coverage, and
production-readiness are especially welcome.

## Development setup

```bash
npm install                 # workspace install (Node 18+)
npm run typecheck
npm run lint
npm test                    # TS suites + solc contract compile

# contracts (Foundry)
cd contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.1.0 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge build && forge test
```

## Ground rules

- **Determinism.** `packages/quant-core` and `packages/strategy-core` must stay
  pure and deterministic — same inputs, same outputs. No I/O, no globals.
- **No fabricated returns.** On-chain NAV is always `idle + venue.markToMarket()`.
  Don't add code paths that invent yield.
- **Honesty in docs.** Don't label unaudited or mock-backed code "production
  ready." Match claims to reality (see the status table in the README).
- **Tests with changes.** Add or update tests; keep `npm test` and `forge test`
  green. Quant changes should include a numerical check or property test.
- **Strict types.** TypeScript runs in `strict` mode; avoid `any`.

## Pull requests

1. Branch from `main`, keep PRs focused.
2. Ensure `npm run typecheck`, `npm run lint`, `npm test`, and `forge test` pass.
3. Describe the change and its risk surface; reference any `SECURITY_REVIEW.md`
   finding it addresses.
4. Security-sensitive changes (contracts, keeper, NAV) get extra review — see
   `SECURITY.md`.

## Commit style

Conventional, imperative summaries (`fix: …`, `feat: …`, `docs: …`). Keep history
meaningful — avoid squashing everything into one opaque commit.
