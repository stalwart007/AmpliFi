/* protocol-bindings tests: ABI shape, unit conversions, and VaultClient end-to-end. */
import {
  AMPLIFI_VAULT_ABI,
  VaultClient,
  MemoryProvider,
  toBaseUnits,
  fromBaseUnits,
  fromWad,
  createViemProvider,
} from "../src/index";

let passed = 0,
  failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  ✗ ${name}  ${detail}`);
  }
}
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("\n── ABI + unit conversions ──");
{
  const names: string[] = AMPLIFI_VAULT_ABI.filter((e) => e.type === "function").map((e) => e.name);
  check(
    "ABI exposes deposit/redeem/pokeNav/navPerShareWad",
    ["deposit", "redeem", "pokeNav", "navPerShareWad"].every((n) => names.includes(n)),
  );
  check("toBaseUnits(1.5, 6) = 1_500_000", toBaseUnits(1.5, 6) === 1_500_000n);
  check("fromBaseUnits round-trips", fromBaseUnits(toBaseUnits(1234.56, 6), 6) === 1234.56);
  check("fromWad(1e18) = 1", fromWad(10n ** 18n) === 1);
}

console.log("\n── VaultClient over MemoryProvider ──");
{
  const provider = new MemoryProvider("0xVault", { decimals: 6, floorBps: 4000 });
  const vault = new VaultClient(provider, "0xVault", 6);

  check("genesis NAV ≈ 1", close(await vault.navPerShare(), 1, 1e-9));

  await vault.deposit(1000, "0xAlice");
  check("supply minted ≈ deposit", close(await vault.totalSupply(), 1000, 1e-6));
  check("totalAssets ≈ deposit", close(await vault.totalAssets(), 1000, 1e-6));
  check("NAV stays ≈ 1 after first deposit", close(await vault.navPerShare(), 1, 1e-9));

  // Simulate a +50% venue gain → NAV rises.
  provider.setBookMark(1500);
  check("NAV reflects venue gain (≈1.5)", close(await vault.navPerShare(), 1.5, 1e-6));
  check("deposits not halted while healthy", (await vault.depositsHalted()) === false);

  // Crash the book → pokeNav winds down.
  provider.setBookMark(200); // −80% from the 1.5 high
  await vault.pokeNav();
  check("wind-down halts deposits after floor breach", (await vault.depositsHalted()) === true);
  let threw = false;
  try {
    await vault.deposit(100, "0xBob");
  } catch {
    threw = true;
  }
  check("deposit reverts after wind-down", threw);
}

console.log("\n── determinism / parity with vault semantics ──");
{
  const run = () => {
    const p = new MemoryProvider("0xV", { floorBps: 4000 });
    const v = new VaultClient(p, "0xV", 6);
    return (async () => {
      await v.deposit(1000, "0xA");
      p.setBookMark(1300);
      await v.pokeNav();
      return v.navPerShare();
    })();
  };
  const a = await run();
  const b = await run();
  check("identical inputs ⇒ identical NAV", a === b);
}

console.log("\n── viem provider (recording client) ──");
{
  const reads: { fn: string; args: readonly unknown[] }[] = [];
  const writes: { fn: string; args: readonly unknown[] }[] = [];
  const pub = {
    async readContract(a: { functionName: string; args?: readonly unknown[] }) {
      reads.push({ fn: a.functionName, args: a.args ?? [] });
      if (a.functionName === "navPerShareWad") return 10n ** 18n;
      if (a.functionName === "totalSupply") return 1000n * 10n ** 6n;
      return 0n;
    },
  };
  const wallet = {
    async writeContract(a: { functionName: string; args?: readonly unknown[] }) {
      writes.push({ fn: a.functionName, args: a.args ?? [] });
      return "0xabc" as `0x${string}`;
    },
  };
  const provider = createViemProvider(pub, wallet, { account: "0xAccount" });
  const vault = new VaultClient(provider, "0xVault", 6);

  check(
    "read forwards to viem readContract",
    close(await vault.navPerShare(), 1, 1e-9) && reads.some((r) => r.fn === "navPerShareWad"),
  );
  check("totalSupply scaled from base units", close(await vault.totalSupply(), 1000, 1e-6));
  const hash = await vault.deposit(500, "0xAlice");
  check("write returns tx hash", hash === "0xabc");
  check(
    "deposit forwards scaled args",
    writes.some((w) => w.fn === "deposit" && w.args[0] === toBaseUnits(500, 6) && w.args[1] === "0xAlice"),
  );
  await vault.pokeNav();
  check(
    "pokeNav forwards to writeContract",
    writes.some((w) => w.fn === "pokeNav"),
  );
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
