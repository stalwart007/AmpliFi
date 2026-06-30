/* risk-engine entrypoint — pull-model HTTP service (POST /evaluate). */
import { createLogger } from "@amplifi/svc-kit";
import { buildServer } from "./server";

export { evaluate } from "./monitor";
export type { Book, RiskLimits, RiskReport, Breach, Severity } from "./monitor";
export { RiskScheduler } from "./scheduler";
export type { ReportSink } from "./scheduler";
export { buildServer } from "./server";

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger("risk-engine");
  const port = Number(process.env.PORT ?? 8802);
  buildServer().listen(port, () => log.info("risk-engine listening", { port }));
}
