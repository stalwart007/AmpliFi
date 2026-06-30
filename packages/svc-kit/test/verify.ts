/* svc-kit verification: validation rules + a live HTTP round-trip. */
import { num, str, numArray, numMatrix, asObject, ValidationError, createJsonServer, ok } from "../src/index";
import type { AddressInfo } from "node:net";

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
function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof ValidationError;
  }
}

console.log("\n── validation ──");
{
  const o = {
    a: 5,
    s: "call",
    arr: [1, 2, 3],
    m: [
      [1, 0],
      [0, 1],
    ],
  };
  check("num passes in range", num(o, "a", { min: 0, max: 10 }) === 5);
  check(
    "num rejects out of range",
    throws(() => num(o, "a", { max: 4 })),
  );
  check(
    "num rejects missing (no default)",
    throws(() => num(o, "missing")),
  );
  check("num default applies", num(o, "missing", { default: 7 }) === 7);
  check(
    "num rejects non-int when int",
    throws(() => num({ x: 1.5 }, "x", { int: true })),
  );
  check("str enum passes", str(o, "s", { enum: ["call", "put"] }) === "call");
  check(
    "str enum rejects",
    throws(() => str({ s: "x" }, "s", { enum: ["call", "put"] })),
  );
  check("numArray validates", numArray(o, "arr", { minLen: 2 }).length === 3);
  check(
    "numArray rejects short",
    throws(() => numArray(o, "arr", { minLen: 9 })),
  );
  check("numMatrix square ok", numMatrix(o, "m", { square: 2 }).length === 2);
  check(
    "numMatrix rejects wrong size",
    throws(() => numMatrix(o, "m", { square: 3 })),
  );
  check(
    "asObject rejects array",
    throws(() => asObject([1, 2])),
  );
}

console.log("\n── live HTTP server ──");
{
  const server = createJsonServer({
    routes: {
      "GET /health": () => ok({ ok: true }),
      "POST /echo": (ctx) => {
        const b = asObject(ctx.body);
        return ok({ doubled: num(b, "n") * 2 });
      },
    },
  });
  await new Promise<void>((res) => server.listen(0, res));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const health = (await fetch(`${base}/health`).then((r) => r.json())) as any;
  check("GET /health → ok", health.ok === true);

  const echo = await fetch(`${base}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: 21 }),
  });
  const echoBody = (await echo.json()) as any;
  check("POST /echo doubles input", echo.status === 200 && echoBody.doubled === 42);

  const bad = await fetch(`${base}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const badBody = (await bad.json()) as any;
  check("validation error → 400 + field", bad.status === 400 && badBody.field === "n");

  const notFound = await fetch(`${base}/nope`);
  check("unknown route → 404", notFound.status === 404);

  const malformed = await fetch(`${base}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  check("malformed JSON → 400", malformed.status === 400);

  await new Promise<void>((res) => server.close(() => res()));
}

console.log(`\n──────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`  FAILURES: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(`  ALL GREEN ✓`);
