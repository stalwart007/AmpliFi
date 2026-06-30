/* =============================================================================
 * @amplifi/svc-kit / validate
 * -----------------------------------------------------------------------------
 * Minimal, dependency-free input validation for service request bodies. Throws
 * a typed ValidationError (with the offending field) that the HTTP layer maps to
 * a 400. Deliberately small — enough to keep untrusted JSON from reaching the
 * quant core as NaN/undefined, without pulling in a schema library.
 * ===========================================================================*/

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

/** Assert an unknown value is a plain object and return it typed. */
export function asObject(v: unknown, name = "body"): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ValidationError(name, "must be a JSON object");
  }
  return v as Record<string, unknown>;
}

export interface NumOpts {
  min?: number;
  max?: number;
  int?: boolean;
  default?: number;
}

export function num(o: Record<string, unknown>, key: string, opts: NumOpts = {}): number {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.default !== undefined) return opts.default;
    throw new ValidationError(key, "is required");
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(key, "must be a finite number");
  if (opts.int && !Number.isInteger(v)) throw new ValidationError(key, "must be an integer");
  if (opts.min !== undefined && v < opts.min) throw new ValidationError(key, `must be ≥ ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new ValidationError(key, `must be ≤ ${opts.max}`);
  return v;
}

export function str(
  o: Record<string, unknown>,
  key: string,
  opts: { enum?: readonly string[]; default?: string } = {},
): string {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.default !== undefined) return opts.default;
    throw new ValidationError(key, "is required");
  }
  if (typeof v !== "string") throw new ValidationError(key, "must be a string");
  if (opts.enum && !opts.enum.includes(v)) throw new ValidationError(key, `must be one of ${opts.enum.join(", ")}`);
  return v;
}

export function bool(o: Record<string, unknown>, key: string, def?: boolean): boolean {
  const v = o[key];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new ValidationError(key, "is required");
  }
  if (typeof v !== "boolean") throw new ValidationError(key, "must be a boolean");
  return v;
}

export function numArray(
  o: Record<string, unknown>,
  key: string,
  opts: { minLen?: number; maxLen?: number } = {},
): number[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new ValidationError(key, "must be an array of numbers");
  if (opts.minLen !== undefined && v.length < opts.minLen)
    throw new ValidationError(key, `needs ≥ ${opts.minLen} items`);
  if (opts.maxLen !== undefined && v.length > opts.maxLen)
    throw new ValidationError(key, `accepts ≤ ${opts.maxLen} items`);
  return v.map((x, i) => {
    if (typeof x !== "number" || !Number.isFinite(x))
      throw new ValidationError(`${key}[${i}]`, "must be a finite number");
    return x;
  });
}

export function strArray(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new ValidationError(key, "must be an array of strings");
  return v.map((x, i) => {
    if (typeof x !== "string") throw new ValidationError(`${key}[${i}]`, "must be a string");
    return x;
  });
}

/** Validate a square (or rectangular) numeric matrix. */
export function numMatrix(o: Record<string, unknown>, key: string, opts: { square?: number } = {}): number[][] {
  const v = o[key];
  if (!Array.isArray(v)) throw new ValidationError(key, "must be a 2-D array");
  const rows = v.map((row, i) => {
    if (!Array.isArray(row)) throw new ValidationError(`${key}[${i}]`, "must be an array");
    return row.map((x, j) => {
      if (typeof x !== "number" || !Number.isFinite(x))
        throw new ValidationError(`${key}[${i}][${j}]`, "must be finite");
      return x;
    });
  });
  if (opts.square !== undefined) {
    if (rows.length !== opts.square) throw new ValidationError(key, `must have ${opts.square} rows`);
    for (let i = 0; i < rows.length; i++)
      if (rows[i].length !== opts.square) throw new ValidationError(`${key}[${i}]`, `must have ${opts.square} cols`);
  }
  return rows;
}

/** Sub-object accessor (returns {} if absent and not required). */
export function child(o: Record<string, unknown>, key: string, required = false): Record<string, unknown> {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(key, "is required");
    return {};
  }
  return asObject(v, key);
}
