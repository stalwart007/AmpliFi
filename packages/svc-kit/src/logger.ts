/* =============================================================================
 * @amplifi/svc-kit / logger
 * -----------------------------------------------------------------------------
 * Structured JSON-line logger. One object per line keeps logs greppable and
 * ingestible by any log pipeline without a logging dependency.
 * ===========================================================================*/

export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  service: string,
  minLevel: Level = "info",
  sink: (line: string) => void = (l) => console.log(l),
): Logger {
  const base = { service };
  const make = (bindings: Record<string, unknown>): Logger => {
    const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
      if (ORDER[level] < ORDER[minLevel]) return;
      sink(JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...bindings, ...fields }));
    };
    return {
      debug: (m, f) => emit("debug", m, f),
      info: (m, f) => emit("info", m, f),
      warn: (m, f) => emit("warn", m, f),
      error: (m, f) => emit("error", m, f),
      child: (b) => make({ ...bindings, ...b }),
    };
  };
  return make({});
}
