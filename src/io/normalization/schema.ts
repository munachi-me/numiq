import type { ColumnType, ColumnTypeSpec } from "../../core/types.js";
import { ValidationError } from "../../errors/index.js";
import { parseIsoDate, parseIsoDateTime, isIsoTime } from "../../utils/temporal.js";
import { normalizeCell } from "./values.js";
import type { NormalizationPolicy } from "../../core/types.js";

/** A `schema` entry, normalised to a descriptor. */
export interface ColumnCast {
  type: ColumnType;
  format?: string;
}

const ALIASES: Record<string, ColumnType> = {
  string: "string",
  text: "string",
  number: "number",
  float: "number",
  decimal: "number",
  integer: "integer",
  int: "integer",
  boolean: "boolean",
  bool: "boolean",
  date: "date",
  datetime: "datetime",
  time: "time",
};

/** Resolve a type name or descriptor into a `ColumnCast`. Throws on unknown types. */
export function resolveCast(entry: ColumnType | ColumnTypeSpec, column: string): ColumnCast {
  if (typeof entry === "string") {
    const type = ALIASES[entry.toLowerCase()];
    if (!type) throw new ValidationError(`Unknown type "${entry}" for column "${column}".`);
    return { type };
  }
  if (entry === null || typeof entry !== "object" || typeof entry.type !== "string") {
    throw new ValidationError(`Schema entry for "${column}" must be a type name or { type, format }.`);
  }
  const unknownKeys = Object.keys(entry).filter((key) => key !== "type" && key !== "format");
  if (unknownKeys.length > 0) {
    throw new ValidationError(`Unsupported schema option(s) for "${column}": ${unknownKeys.join(", ")}.`);
  }
  const type = ALIASES[entry.type.toLowerCase()];
  if (!type) throw new ValidationError(`Unknown type "${entry.type}" for column "${column}".`);
  return entry.format === undefined ? { type } : { type, format: entry.format };
}

/** A cast failure, carrying enough context for a precise error message. */
export class CastFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastFailure";
  }
}

/**
 * Cast one already-normalized cell to an explicit column type.
 *
 * `Date` objects are produced only for `date` and `datetime`; `time` stays a canonical
 * `HH:MM:SS(.SSS)` string because a time has no calendar anchor.
 */
export function castCell(value: unknown, cast: ColumnCast): unknown {
  if (value === null || value === undefined) return null;

  switch (cast.type) {
    case "string": {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "object") throw new CastFailure("cannot convert an object to string");
      return String(value);
    }
    case "number":
    case "integer": {
      const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
      if (!Number.isFinite(numeric)) throw new CastFailure(`"${String(value)}" is not a valid ${cast.type}`);
      if (cast.type === "integer" && !Number.isInteger(numeric)) {
        throw new CastFailure(`"${String(value)}" is not an integer`);
      }
      return numeric;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        throw new CastFailure(`"${String(value)}" is not a boolean`);
      }
      const text = String(value).trim().toLowerCase();
      if (text === "true" || text === "1") return true;
      if (text === "false" || text === "0") return false;
      throw new CastFailure(`"${String(value)}" is not a boolean`);
    }
    case "date": {
      if (value instanceof Date)
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
      if (typeof value !== "string") throw new CastFailure("expected an ISO date string");
      try {
        const parsed = parseIsoDate(value.trim());
        return parsed;
      } catch {
        throw new CastFailure(`"${value}" is not an ISO date (expected YYYY-MM-DD)`);
      }
    }
    case "datetime": {
      if (value instanceof Date) return new Date(value.getTime());
      if (typeof value !== "string") throw new CastFailure("expected an ISO date-time string");
      try {
        return parseIsoDateTime(value.trim());
      } catch {
        throw new CastFailure(`"${value}" is not an ISO date-time`);
      }
    }
    case "time": {
      if (value instanceof Date) return value.toISOString().slice(11, 19);
      const text = String(value).trim();
      if (!isIsoTime(text)) throw new CastFailure(`"${text}" is not a wall-clock time (expected HH:MM:SS)`);
      return text.length === 5 ? `${text}:00` : text;
    }
    default:
      throw new CastFailure(`unsupported type ${String(cast.type)}`);
  }
}

/** Normalize a raw cell and, when a cast is present, convert it to the target type. */
export function normalizeAndCast(
  input: unknown,
  policy: NormalizationPolicy,
  cast: ColumnCast | undefined,
): { value: unknown; issue?: "unsafe-integer" } {
  const normalized = normalizeCell(input, policy);
  if (normalized.value === null) return { value: null };
  if (cast === undefined) return normalized;
  return { value: castCell(normalized.value, cast) };
}
