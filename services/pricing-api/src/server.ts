/* =============================================================================
 * pricing-api / server
 * -----------------------------------------------------------------------------
 * Wires the pure handlers to routes on the shared JSON HTTP server.
 * ===========================================================================*/

import { createJsonServer, type Handler } from "@amplifi/svc-kit";
import { healthHandler, priceHandler, ivHandler, surfaceHandler, varHandler } from "./handlers";

export const routes: Record<string, Handler> = {
  "GET /health": healthHandler,
  "POST /price": priceHandler,
  "POST /iv": ivHandler,
  "POST /surface": surfaceHandler,
  "POST /var": varHandler,
};

export function buildServer(allowOrigins?: string[]) {
  return createJsonServer({ routes, allowOrigins });
}
