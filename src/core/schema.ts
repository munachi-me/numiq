import type { ColumnSchema, DType, Row } from "./types.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";
import { isIsoDate, isIsoDateTime, isIsoTime } from "../utils/temporal.js";

/**
 * Infer the column type from its values.
 *
 * A string is only reported as `date`/`datetime`/`time` when *every* present value is
 * that shape; a mixed column is `mixed` rather than a guess. Reported types describe the
 * values as stored, so a column of ISO date strings reports `date` while still holding
 * strings — callers wanting `Date` objects must request `schema: { col: "date" }`.
 */
export function inferColumnType(values: readonly unknown[]): DType {
  const present = values.filter(isPresent);
  if (present.length === 0) return "unknown";

  let allBoolean = true;
  let allNumber = true;
  let allInteger = true;
  let allString = true;
  let allDate = true;
  let allDateTime = true;
  let allTime = true;
  let allDateInstance = true;
  let allMidnight = true;

  for (const value of present) {
    const isString = typeof value === "string";
    if (typeof value !== "boolean") allBoolean = false;
    if (typeof value !== "number" || !Number.isFinite(value)) allNumber = false;
    if (typeof value !== "number" || !Number.isInteger(value)) allInteger = false;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) allDateInstance = false;
      else if (value.toISOString().slice(11) !== "00:00:00.000Z") allMidnight = false;
    } else {
      allDateInstance = false;
    }
    if (!isString) {
      allString = false;
      allDate = false;
      allDateTime = false;
      allTime = false;
      continue;
    }
    const text = value as string;
    if (!isIsoDate(text)) allDate = false;
    if (!isIsoDateTime(text)) allDateTime = false;
    if (!isIsoTime(text)) allTime = false;
  }

  // Cast columns hold real `Date` objects; a midnight-only column is a calendar date.
  if (allDateInstance) return allMidnight ? "date" : "datetime";
  if (allBoolean) return "boolean";
  if (allInteger) return "integer";
  if (allNumber) return "number";
  if (allString) {
    if (allDate) return "date";
    if (allDateTime) return "datetime";
    if (allTime) return "time";
    return "string";
  }
  return "mixed";
}

/** Build the schema entry for one column. */
export function describeColumn(name: string, values: readonly unknown[]): ColumnSchema {
  return {
    name,
    type: inferColumnType(values),
    nullable: values.some((value) => !isPresent(value)),
  };
}

/** Count distinct present values in a column. */
export function countUnique(values: readonly unknown[]): number {
  const seen = new Set<string>();
  for (const value of values) if (isPresent(value)) seen.add(stableKey(value));
  return seen.size;
}

/** Return distinct present values in first-seen order. */
export function distinctValues(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const output: unknown[] = [];
  for (const value of values) {
    if (!isPresent(value)) continue;
    const key = stableKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cloneValue(value));
  }
  return output;
}

export type { Row, DType, ColumnSchema };
