/* risk-engine HTTP: POST /evaluate a book + limits → a RiskReport (pull model). */
import { createJsonServer, securityFromEnv, asObject, num, strArray, numMatrix, child, ok, type Handler, type Ctx, type Reply } from "@amplifi/svc-kit";
import { evaluate, type Book, type RiskLimits } from "./monitor";
import type { Leg } from "@amplifi/quant-core";

function parseBook(ctx: Ctx): { book: Book; limits: RiskLimits } {
  const b = asObject(ctx.body);
  const underlyings = strArray(b, "underlyings");
  const rawLegs = Array.isArray(b["legs"]) ? (b["legs"] as unknown[]) : [];
  const legs: Leg[] = rawLegs.map((leg, i) => {
    const o = asObject(leg, `legs[${i}]`);
    return {
      underlying: String(o["underlying"]),
      type: o["type"] === "put" ? "put" : "call",
      s: num(o, "s", { min: 0 }),
      k: num(o, "k", { min: 0 }),
      t: num(o, "t", { min: 0 }),
      vol: num(o, "vol", { min: 0 }),
      r: num(o, "r", { default: 0.05 }),
      b: num(o, "b", { default: 0 }),
      qty: num(o, "qty"),
    };
  });
  const spot0Obj = child(b, "spot0", true);
  const volsObj = child(b, "vols", true);
  const spot0: Record<string, number> = {};
  const vols: Record<string, number> = {};
  for (const u of underlyings) {
    spot0[u] = num(spot0Obj, u, { min: 0 });
    vols[u] = num(volsObj, u, { min: 0 });
  }
  const corr = b["corr"] ? numMatrix(b, "corr", { square: underlyings.length }) : undefined;
  const book: Book = {
    legs,
    underlyings,
    spot0,
    vols,
    corr,
    equity: num(b, "equity", { min: 0 }),
    navPerShare: num(b, "navPerShare", { default: 1 }),
  };
  const lim = child(b, "limits");
  const limits: RiskLimits = {
    maxVar95Frac: lim["maxVar95Frac"] !== undefined ? num(lim, "maxVar95Frac", { min: 0 }) : undefined,
    maxEs99Frac: lim["maxEs99Frac"] !== undefined ? num(lim, "maxEs99Frac", { min: 0 }) : undefined,
    maxLeverage: lim["maxLeverage"] !== undefined ? num(lim, "maxLeverage", { min: 0 }) : undefined,
    minNavPerShare: lim["minNavPerShare"] !== undefined ? num(lim, "minNavPerShare", { min: 0 }) : undefined,
    paths: lim["paths"] !== undefined ? num(lim, "paths", { min: 100, max: 500000, int: true }) : undefined,
  };
  return { book, limits };
}

export const evaluateHandler: Handler = (ctx: Ctx): Reply => {
  const { book, limits } = parseBook(ctx);
  return ok(evaluate(book, limits));
};

export function buildServer(allowOrigins?: string[]) {
  return createJsonServer({
    routes: {
      "GET /health": () => ok({ ok: true, service: "risk-engine", version: "0.1.0" }),
      "POST /evaluate": evaluateHandler,
    },
    allowOrigins,
    ...securityFromEnv(),
  });
}
