/* =============================================================================
 * @amplifi/svc-kit / http
 * -----------------------------------------------------------------------------
 * A tiny JSON HTTP server over node:http — no framework. Provides routing, a
 * bounded JSON body parser (kills trivial memory-exhaustion DoS), an origin
 * allowlist for CORS, and uniform error mapping (ValidationError → 400). Handlers
 * are plain functions of a parsed context returning { status, body }, which makes
 * them unit-testable without opening a socket.
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

export interface ServerOptions {
  routes: Record<string, Handler>; // keyed by "METHOD /path"
  allowOrigins?: string[]; // CORS allowlist; default localhost dev
  maxBodyBytes?: number; // default 256 KB
  onError?: (err: unknown, ctx: Partial<Ctx>) => void;
}

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function createJsonServer(opts: ServerOptions): Server {
  const allow = new Set(opts.allowOrigins ?? DEFAULT_ORIGINS);
  const maxBody = opts.maxBodyBytes ?? 256 * 1024;

  return createServer((req, res) => {
    const origin = req.headers.origin;
    const corsOrigin = origin && allow.has(origin) ? origin : null;
    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        ...(corsOrigin ? { "access-control-allow-origin": corsOrigin } : {}),
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end(payload);
    };

    if (req.method === "OPTIONS") return send(204, {});

    const url = new URL(req.url ?? "/", "http://localhost");
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
