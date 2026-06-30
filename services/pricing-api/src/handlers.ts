/* =============================================================================
 * pricing-api / handlers
 * -----------------------------------------------------------------------------
 * Pure request handlers over @amplifi/quant-core. Each takes a parsed JSON body,
 * validates it, and returns a { status, body } reply — so they unit-test without
 * a socket. The thin server in server.ts maps routes to these.
 * ===========================================================================*/

import { priceGreeks, impliedVol, VolSurface, monteCarloVar, linalg, type OptionType, type SviParams } from "@amplifi/quant-core";
import { asObject, num, str, strArray, numArray, numMatrix, child, ok, type Reply, type Ctx } from "@amplifi/svc-kit";

const TYPE = ["call", "put"] as const;

/** POST /price → full greek vector for one option. */
export function priceHandler(ctx: Ctx): Reply {
  const b = asObject(ctx.body);
  const s = num(b, "s", { min: 0 });
  const k = num(b, "k", { min: 0 });
  const t = num(b, "t", { min: 0 });
  const vol = num(b, "vol", { min: 0 });
  const r = num(b, "r", { default: 0 });
  const carry = num(b, "b", { default: r });
  const type = str(b, "type", { enum: TYPE }) as OptionType;
  const g = priceGreeks({ s, k, t, vol, r, b: carry, type });
  return ok({ inputs: { s, k, t, vol, r, b: carry, type }, greeks: g });
}

/** POST /iv → implied volatility from a market price. */
export function ivHandler(ctx: Ctx): Reply {
  const b = asObject(ctx.body);
  const target = num(b, "target", { min: 0 });
  const s = num(b, "s", { min: 0 });
  const k = num(b, "k", { min: 0 });
  const t = num(b, "t", { min: 0 });
  const r = num(b, "r", { default: 0 });
  const carry = num(b, "b", { default: r });
  const type = str(b, "type", { enum: TYPE }) as OptionType;
  const res = impliedVol({ target, s, k, t, r, b: carry, type });
  return ok({ vol: res.vol, converged: res.converged, iterations: res.iterations, residual: res.residual });
}

/** POST /surface → sample a SVI surface on a (logMoneyness × expiry) grid + audit. */
export function surfaceHandler(ctx: Ctx): Reply {
  const b = asObject(ctx.body);
  const rawSlices = b["slices"];
  if (!Array.isArray(rawSlices) || rawSlices.length === 0) {
    return { status: 400, body: { error: "slices: must be a non-empty array", field: "slices" } };
  }
  const slices = rawSlices.map((sl, i) => {
    const o = asObject(sl, `slices[${i}]`);
    const expiry = num(o, "expiry", { min: 0 });
    const p = child(o, "params", true);
    const params: SviParams = {
      a: num(p, "a"),
      b: num(p, "b"),
      rho: num(p, "rho", { min: -1, max: 1 }),
      m: num(p, "m"),
      zeta: num(p, "zeta", { min: 0 }),
    };
    return { expiry, params };
  });
  const ks = numArray(b, "ks", { minLen: 1 });
  const expiries = numArray(b, "expiries", { minLen: 1 });
  const surf = new VolSurface(slices);
  const grid = expiries.map((tt) => ks.map((kk) => surf.vol(kk, tt)));
  return ok({ ks, expiries, vols: grid, audit: surf.audit(), calendarOk: surf.calendarOk() });
}

/** POST /var → full-revaluation Monte-Carlo VaR/ES over a book. */
export function varHandler(ctx: Ctx): Reply {
  const b = asObject(ctx.body);
  const underlyings = strArray(b, "underlyings");
  const n = underlyings.length;
  if (n === 0) return { status: 400, body: { error: "underlyings: at least one", field: "underlyings" } };

  const rawLegs = b["legs"];
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
    return { status: 400, body: { error: "legs: must be a non-empty array", field: "legs" } };
  }
  const legs = rawLegs.map((leg, i) => {
    const o = asObject(leg, `legs[${i}]`);
    return {
      underlying: str(o, "underlying"),
      type: str(o, "type", { enum: TYPE }) as OptionType,
      s: num(o, "s", { min: 0 }),
      k: num(o, "k", { min: 0 }),
      t: num(o, "t", { min: 0 }),
      vol: num(o, "vol", { min: 0 }),
      r: num(o, "r", { default: 0 }),
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
  const cov = linalg.fromRows(numMatrix(b, "cov", { square: n }));
  const cfg = child(b, "config");
  const res = monteCarloVar(legs, underlyings, spot0, vols, cov, {
    paths: num(cfg, "paths", { default: 20000, min: 100, max: 500000, int: true }),
    horizonYears: num(cfg, "horizonYears", { default: 1 / 365, min: 0 }),
    antithetic: cfg["antithetic"] === undefined ? true : Boolean(cfg["antithetic"]),
    levels: [0.95, 0.99],
  });
  return ok({
    base: res.base,
    meanPnl: res.meanPnl,
    stdPnl: res.stdPnl,
    worst: res.worst,
    best: res.best,
    tail: res.tail,
  });
}

export const healthHandler = (): Reply => ok({ ok: true, service: "pricing-api", version: "0.1.0" });
