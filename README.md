# AmpliFi

A leveraged, capped-downside crypto index protocol. A deposit is compressed into
a multiple of synthetic index exposure through a basket of long perpetual options
— amplified upside, with the maximum loss bounded by the premium paid. It pairs an
off-chain deterministic strategy engine ("TimeMachine") with a permissioned
ERC-4626 vault, a private signed-price oracle, and a modular DeFi integration
layer.

> Unaudited. Permissioned (allowlist), for testnet / mainnet-fork use only — not
> for real funds.

## Repository

- `packages/` — TypeScript libraries: `quant-core` (pricing/greeks/IV/SVI/Heston/
  exotics/Monte-Carlo VaR), `strategy-core` (the TimeMachine state machine),
  `portfolio-opt`, `market-data`, `svc-kit` (HTTP + auth + rate-limit + metrics).
- `contracts/` — Solidity (Foundry): `AmplifiGatedVault` (gated ERC-4626),
  `RiskController`, `AllowlistGate`, timelock + multisig governance,
  `PanopticVenueAdapter`, `SignedPriceOracle`, and the `integrations/` adapter
  layer (Aave, ERC-4626/Ethena, Sushi, 0x, EigenLayer, bridge, Pendle) behind
  narrow seams, decoupled from the custody core.
- `services/` — `pricing-api`, `risk-engine`, `keeper` (+ the oracle publisher).
- `apps/terminal` — React dashboard; runs an in-browser simulation, or drives a
  deployed vault on-chain via viem when `VITE_VAULT_ADDRESS` is set.
- `infra/` — Docker, Kubernetes manifests, and a Caddy TLS reverse proxy.

## Quick start

```bash
npm install
npm test                                     # TS suites + solc compile check
npm run dev --workspace @amplifi/terminal    # http://localhost:5173
```

Contracts ([Foundry](https://book.getfoundry.sh/)):

```bash
cd contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.1.0 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge test
```

## Testing against a mainnet fork

Every protocol exists at its real address on a fork, so it's the environment for
exercising the integrations.

```bash
anvil --fork-url $MAINNET_RPC --compute-units-per-second 320   # real contracts, fake money
# in another shell, with the anvil key + protocol addresses in env:
forge script script/DeployTestnet.s.sol:DeployTestnet     --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PK
forge script script/DeployIntegrations.s.sol:DeployIntegrations --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PK
forge script script/DeployOracle.s.sol:DeployOracle       --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PK
```

- Point the terminal at the deployed vault with `VITE_VAULT_ADDRESS` /
  `VITE_RPC_URL` / `VITE_CHAIN_ID` (see `apps/terminal/.env.example`).
- Run the private oracle publisher: `npm run oracle --workspace @amplifi/keeper`
  with `RPC_URL` / `ORACLE_SIGNER_KEY` / `ORACLE_ADDRESS` set.

## License

`UNLICENSED` — see [LICENSE](./LICENSE). Published publicly for transparency; this
is source-available and proprietary, not open-source.
