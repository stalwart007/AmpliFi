/* pricing-api entrypoint. `node --import tsx src/index.ts` or `npm run dev`. */
import { createLogger } from "@amplifi/svc-kit";
import { buildServer } from "./server";

const log = createLogger("pricing-api");
const port = Number(process.env.PORT ?? 8801);
const allow = (process.env.ALLOW_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim());

buildServer(allow).listen(port, () => {
  log.info("pricing-api listening", { port, routes: ["/health", "/price", "/iv", "/surface", "/var"] });
});
