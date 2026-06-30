/* =============================================================================
 * @amplifi/svc-kit / http
 * -----------------------------------------------------------------------------
 * A tiny JSON HTTP server over node:http — no framework. Provides routing, a
 * bounded JSON body parser (kills trivial memory-exhaustion DoS), an origin
 * allowlist for CORS, optional API-key auth, optional per-IP rate limiting,
 * per-request structured access logging, and uniform error mapping
 * (ValidationError → 400). Handlers are plain functions of a parsed context
 * returning { status, body }, which makes them unit-testable without a socket.
 * ===========================================================================*/

import { createServer, type Server } from "node:http";
import { ValidationError } from "./validate";

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface Reply {
  status: number;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

export interface AccessLogLine {
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string;
}

export interface ServerOptions {
  routes: Record<string, Handler>; // keyed by "METHOD /path"
  allowOrigins?: string[]; // CORS allowlist; default localhost dev
  maxBodyBytes?: number; // default 256 KB
  onError?: (err: unknown, ctx: Partial<Ctx>) => void;
  /**
   * If set, every request must present a matching key via `Authorization:
   * Bearer <key>` or the `x-api-key` header — except `publicPaths`. Empty/unset
   * disables auth (dev default).
   */
  apiKeys?: string[];
  publicPaths?: string[]; // paths exempt from auth, e.g. ["/health"]
  /** Per-IP fixed-window rate limit. Unset disables limiting. */
  rateLimit?: { windowMs: number; max: number };
  /** Per-request access log sink (wire your logger here). */
  log?: (line: AccessLogLine) => void;
}

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function createJsonServer(opts: ServerOptions): Server {
  const allow = new Set(opts.allowOrigins ?? DEFAULT_ORIGINS);
  const maxBody = opts.maxBodyBytes ?? 256 * 1024;
  const keys = new Set(opts.apiKeys ?? []);
  const publicPaths = new Set(opts.publicPaths ?? ["/health"]);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const clientIp = (req: import("node:http").IncomingMessage): string => {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
    return req.socket.remoteAddress ?? "unknown";
  };

  const presentedKey = (req: import("node:http").IncomingMessage): string | null => {
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
    const xk = req.headers["x-api-key"];
    if (typeof xk === "string") return xk.trim();
    return null;
  };

  const overLimit = (ip: string): boolean => {
    if (!opts.rateLimit) return false;
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || now >= b.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + opts.rateLimit.windowMs });
      return false;
    }
    b.count += 1;
    return b.count > opts.rateLimit.max;
  };

  return createServer((req, res) => {
    const started = Date.now();
    const ip = clientIp(req);
    const origin = req.headers.origin;
    const corsOrigin = origin && allow.has(origin) ? origin : null;
    const url = new URL(req.url ?? "/", "http://localhost");

    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        ...(corsOrigin ? { "access-control-allow-origin": corsOrigin } : {}),
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-api-key",
      });
      res.end(payload);
      opts.log?.({ method: req.method ?? "GET", path: url.pathname, status, ms: Date.now() - started, ip });
    };

    if (req.method === "OPTIONS") return send(204, {});

    // Rate limit before doing any work.
    if (overLimit(ip)) return send(429, { error: "rate limit exceeded" });

    // API-key auth (skips public paths). Disabled when no keys configured.
    if (keys.size > 0 && !publicPaths.has(url.pathname)) {
      const k = presentedKey(req);
      if (!k || !keys.has(k)) return send(401, { error: "unauthorized" });
    }

    const key = `${req.method} ${url.pathname}`;
    const handler = opts.routes[key];
    if (!handler) return send(404, { error: "not found", path: url.pathname });

    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBody) {
        aborted = true;
        send(413, { error: "request body too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", async () => {
      if (aborted) return;
      let body: unknown = undefined;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: "invalid JSON body" });
        }
      }
      const ctx: Ctx = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body };
      try {
        const reply = await handler(ctx);
        send(reply.status, reply.body);
      } catch (err) {
        if (err instanceof ValidationError) return send(400, { error: err.message, field: err.field });
        opts.onError?.(err, ctx);
        send(500, { error: "internal error" });
      }
    });
  });
}

/** Convenience for handlers. */
export const ok = (body: unknown): Reply => ({ status: 200, body });

/**
 * Build security options from environment, so a service enables auth / rate
 * limiting / access logging without code changes:
 *   AMPLIFI_API_KEYS        comma-separated keys (auth off if empty)
 *   AMPLIFI_RATE_MAX        max requests per window per IP (off if 0/unset)
 *   AMPLIFI_RATE_WINDOW_MS  window length (default 60_000)
 * Defaults are safe for local dev (auth + rate-limit off, JSON access log on).
 */
export function securityFromEnv(): Pick<ServerOptions, "apiKeys" | "rateLimit" | "publicPaths" | "log"> {
  const apiKeys = (process.env.AMPLIFI_API_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const max = Number(process.env.AMPLIFI_RATE_MAX ?? "0");
  const windowMs = Number(process.env.AMPLIFI_RATE_WINDOW_MS ?? "60000");
  return {
    apiKeys: apiKeys.length > 0 ? apiKeys : undefined,
    rateLimit: max > 0 ? { max, windowMs } : undefined,
    publicPaths: ["/health"],
    log: (l) => console.log(JSON.stringify({ t: new Date().toISOString(), ...l })),
  };
}
