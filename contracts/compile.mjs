// Standalone solc compile check for the AmpliFi contracts.
// Verifies the suite compiles clean against the installed OpenZeppelin, in lieu
// of Foundry (not present in this environment). Run: node contracts/compile.mjs
import solc from "solc";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SOURCES = [
  "contracts/src/AmplifiVault.sol",
  "contracts/src/AmplifiGatedVault.sol",
  "contracts/src/access/AllowlistGate.sol",
  "contracts/src/RiskController.sol",
  "contracts/src/OracleHardenedVenue.sol",
  "contracts/src/venues/PanopticVenueAdapter.sol",
  "contracts/src/mocks/MockPanopticPool.sol",
  "contracts/src/mocks/MockPriceOracle.sol",
  "contracts/src/governance/AmplifiTimelock.sol",
  "contracts/src/governance/MultisigGuardian.sol",
  "contracts/src/periphery/WithdrawalQueue.sol",
  "contracts/src/mocks/MockOptionsVenue.sol",
  "contracts/src/mocks/MockUSDC.sol",
];

const sources = {};
for (const s of SOURCES) sources[s] = { content: readFileSync(resolve(ROOT, s), "utf8") };

function findImport(path) {
  // Resolve OZ (and any node_modules) imports.
  const candidates = [resolve(ROOT, path), resolve(ROOT, "node_modules", path)];
  for (const c of candidates) if (existsSync(c)) return { contents: readFileSync(c, "utf8") };
  return { error: "File not found: " + path };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (out.errors || []).filter((e) => e.severity === "error");
const warnings = (out.errors || []).filter((e) => e.severity === "warning");

if (warnings.length) console.log(`warnings: ${warnings.length}`);
if (errors.length) {
  console.log("COMPILE FAILED:");
  for (const e of errors) console.log("  " + e.formattedMessage);
  process.exit(1);
}

const contracts = Object.entries(out.contracts || {}).flatMap(([file, cs]) =>
  Object.keys(cs).map((name) => `${name} (${(cs[name].evm.bytecode.object.length / 2) | 0} bytes)`),
);
console.log("COMPILE OK ✓  solc " + solc.version());
for (const c of contracts) console.log("  • " + c);
