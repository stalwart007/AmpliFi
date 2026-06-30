/* =============================================================================
 * pricing-api / server
 * -----------------------------------------------------------------------------
 * Wires the pure handlers to routes on the shared JSON HTTP server.
 * ===========================================================================*/

import { createJsonServer, securityFromEnv, type Handler } from "@amplifi/svc-kit";
import { healthHandler, priceHandler, ivHandler, surfaceHandler, varHandler } from "./handlers";

export const routes: Record<string, Handler> = {
  "GET /health": healthHandler,
  "POST /price": priceHandler,
  "POST /iv": ivHandler,
  "POST /surface": surfaceHandler,
  "POST /var": varHandler,
};

export function buildServer(allowOrigins?: string[]) {
  // securityFromEnv() wires API-key auth + rate limiting + access logging when
  // the corresponding env vars are set; off by default for local dev/tests.
  return createJsonServer({ routes, allowOrigins, ...securityFromEnv() });
}
