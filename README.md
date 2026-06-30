# AmpliFi

A leveraged, capped-downside crypto index protocol. A deposit is compressed into
a multiple of synthetic index exposure through a basket of long perpetual
options — amplified upside, with the maximum loss bounded by the premium.

> ⚠️ **Testnet-grade and unaudited.** Do not use with real funds.

## Stack

- `packages/` — TypeScript libraries: pricing/risk (`quant-core`), the strategy
  engine (`strategy-core`), portfolio optimization, market data, service kit.
- `contracts/` — Solidity: an ERC-4626 vault, risk controller, allowlist gate,
  governance, and an options-venue adapter (Foundry).
- `services/` — off-chain pricing API, risk engine, and keeper.
- `apps/terminal` — React dashboard.

## Quick start

```bash
npm install
npm test            # TypeScript suites + Solidity compile check
npm run dev --workspace @amplifi/terminal   # http://localhost:5173
```

Contracts (needs [Foundry](https://book.getfoundry.sh/)):

```bash
cd contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge test
```

## License

UNLICENSED — see [LICENSE](./LICENSE).
