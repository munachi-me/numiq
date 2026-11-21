/**
 * Time-series operations: ordering by time, period extraction, and resampling.
 *
 * All calendar arithmetic is done in UTC. A `Date` carries an instant, not a calendar
 * date, so bucketing in local time would move rows between buckets depending on where the
 * code runs. Keeping to UTC makes a bucket boundary mean the same thing everywhere.
 *
 * Strings are accepted only in the ISO forms that `utils/temporal` validates. A value that
 * is present but not a recognised date is an error rather than a silently skipped row.
 */
import type { Row } from "./types.js";
import type { PreparedTable } from "./prepare.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent } from "../utils/values.js";
import { compareValues } from "../utils/compare.js";
import { isIsoDate, isIsoDateTime } from "../utils/temporal.js";

/** Calendar intervals a time column can be bucketed into. */
export type TimeInterval = "hour" | "day" | "week" | "month" | "quarter" | "year";

/** Aggregation applied to a column when several rows share a bucket. */
export type ResampleAggregation = "sum" | "mean" | "median" | "min" | "max" | "count" | "first" | "last";

/** Options for `sortByTime`. */
export interface SortByTimeOptions {
  /** Sort direction. Defaults to `"asc"`, oldest first. */
  readonly direction?: "asc" | "desc";
}

/** Options for `resample`. */
export interface ResampleOptions {
  /** Bucket width. Required, so the alignment of a bucket is always stated. */
  readonly every: TimeInterval;
  /** Column name to bucket by. */
  readonly timeColumn: string;
  /** Aggregations per output column, keyed by source column. */
  readonly aggregate: Readonly<Record<string, ResampleAggregation>>;
  /** Name of the bucket column. Defaults to `"period"`. */
  readonly label?: string;
  /** What to do with a row whose time is missing. Defaults to `"drop"`. */
  readonly onMissingTime?: "drop" | "error";
}

/** A resampled table plus how many rows it consumed and dropped. */
export interface ResampleResult extends PreparedTable {
  /** Rows that landed in a bucket. */
  readonly bucketed: number;
  /** Rows skipped because their time was missing. */
  readonly dropped: number;
}

const INTERVALS: ReadonlySet<string> = new Set(["hour", "day", "week", "month", "quarter", "year"]);
const AGGREGATIONS: ReadonlySet<string> = new Set(["sum", "mean", "median", "min", "max", "count", "first", "last"]);

/**
 * Convert a cell to a `Date`, or `null` when it is missing.
 *
 * Throws when the value is present but not a date or a recognised ISO string, so a
 * malformed timestamp cannot quietly become a null.
 */
export function toTime(value: unknown, context: string): Date | null {
  if (!isPresent(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ValidationError(`${context}: received an invalid Date.`);
    return value;
  }
  if (typeof value === "string") {
    if (isIsoDateTime(value)) return new Date(value.replace(" ", "T"));
    if (isIsoDate(value)) return new Date(`${value}T00:00:00.000Z`);
    throw new ValidationError(
      `${context}: "${value}" is not an ISO date or date-time. Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.`,
    );
  }
  throw new ValidationError(
    `${context}: expected a Date or an ISO date string, received ${typeof value} (${String(value)}).`,
  );
}

function requireColumn(columns: readonly string[], column: string, method: string): void {
  if (!columns.includes(column)) {
    const error = new ColumnNotFoundError(column, columns);
    error.message = `${method}: ${error.message}`;
    throw error;
  }
}

function assertInterval(value: unknown, method: string): TimeInterval {
  if (typeof value !== "string" || !INTERVALS.has(value)) {
    throw new ValidationError(
      `${method}: interval must be one of hour, day, week, month, quarter, year; received "${String(value)}".`,
    );
  }
  return value as TimeInterval;
}

/**
 * Start of the interval containing `date`, in UTC.
 *
 * Weeks start on Monday, matching ISO-8601. Quarters start on the first day of months 1,
 * 4, 7, and 10.
 */
export function periodStart(date: Date, interval: TimeInterval): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (interval) {
    case "hour":
      return new Date(Date.UTC(year, month, day, date.getUTCHours()));
    case "day":
      return new Date(Date.UTC(year, month, day));
    case "week": {
      // getUTCDay: Sunday is 0. Shift so Monday is the first day of the week.
      const weekday = (date.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(year, month, day - weekday));
    }
    case "month":
      return new Date(Date.UTC(year, month, 1));
    case "quarter":
      return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(year, 0, 1));
  }
}

/**
 * Label for a bucket, derived from its start.
 *
 * The label names the bucket's first instant, so labels never overlap:
 * `2026` (year), `2026-Q4` (quarter), `2026-11` (month), `2026-11-16` (day, and also the
 * Monday that begins a week), and `2026-11-16T14:00` (hour). Day and week share a shape
 * because a week label is the date its bucket begins; the interval is known from the call.
 */
export function periodLabel(start: Date, interval: TimeInterval): string {
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  const hour = String(start.getUTCHours()).padStart(2, "0");

  if (interval === "year") return String(year);
  if (interval === "quarter") return `${year}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
  if (interval === "month") return `${year}-${month}`;
  if (interval === "hour") return `${year}-${month}-${day}T${hour}:00`;
  return `${year}-${month}-${day}`;
}

/**
 * A dataset sorted by a time column.
 *
 * Rows with a missing time sort last in both directions, matching `Dataset.sort`. Ties
 * keep their input order, so the sort is stable and reproducible.
 */
export function sortByTime(
  rows: readonly Row[],
  columns: readonly string[],
  timeColumn: string,
  options: SortByTimeOptions = {},
): PreparedTable {
  requireColumn(columns, timeColumn, "sortByTime");
  const direction = options.direction ?? "asc";
  if (direction !== "asc" && direction !== "desc") {
    throw new ValidationError(`sortByTime: direction must be "asc" or "desc", received "${String(direction)}".`);
  }

  const indexed = rows.map((row, index) => {
    const time = toTime(row[timeColumn], `sortByTime: row ${index}, column "${timeColumn}"`);
    return { row, index, time };
  });

  indexed.sort((left, right) => {
    if (left.time === null || right.time === null) {
      if (left.time === null && right.time === null) return left.index - right.index;
      return left.time === null ? 1 : -1;
    }
    const comparison = compareValues(left.time, right.time);
    if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    return left.index - right.index;
  });

  return {
    rows: indexed.map((entry) => {
      const next: Row = {};
      for (const column of columns) next[column] = cloneValue(entry.row[column]);
      return next;
    }),
    columns: [...columns],
  };
}

/**
 * A dataset with a column holding each row's bucket label.
 *
 * The label comes from `periodLabel`, so it matches what `resample` would group by. A row
 * with a missing time gets `null`: it belongs to no bucket, and inventing one would place
 * it somewhere the data does not support.
 */
export function extractPeriod(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  timeColumn: string,
  interval: TimeInterval,
): PreparedTable {
  requireColumn(columns, timeColumn, "extractPeriod");
  assertInterval(interval, "extractPeriod");
  if (typeof name !== "string" || name.length === 0) {
    throw new ValidationError("extractPeriod expects a non-empty column name.");
  }
  if (columns.includes(name)) {
    throw new ValidationError(`extractPeriod: column "${name}" already exists. Choose a new name.`);
  }

  const out = rows.map((row, index) => {
    const next: Row = {};
    for (const column of columns) next[column] = cloneValue(row[column]);
    const time = toTime(row[timeColumn], `extractPeriod: row ${index}, column "${timeColumn}"`);
    next[name] = time === null ? null : periodLabel(periodStart(time, interval), interval);
    return next;
  });
  return { rows: out, columns: [...columns, name] };
}

/** Combine present values under one aggregation. */
function combine(values: readonly unknown[], aggregation: ResampleAggregation): unknown {
  if (aggregation === "count") return values.filter((value) => isPresent(value)).length;
  if (aggregation === "first") return values.length === 0 ? null : cloneValue(values[0] ?? null);
  if (aggregation === "last") return values.length === 0 ? null : cloneValue(values[values.length - 1] ?? null);

  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  }
  if (numbers.length === 0) return null;
  if (aggregation === "sum") return numbers.reduce((total, value) => total + value, 0);
  if (aggregation === "mean") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (aggregation === "min") return numbers.reduce((lowest, value) => (value < lowest ? value : lowest));
  if (aggregation === "max") return numbers.reduce((highest, value) => (value > highest ? value : highest));
  const sorted = [...numbers].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

/**
 * Group rows into fixed calendar buckets and aggregate each bucket.
 *
 * Buckets are UTC calendar intervals starting at `periodStart`, and the output holds one
 * row per non-empty bucket in ascending time order. An empty bucket produces no row: a
 * resample summarises observations, and inventing a zero row for a period with no data
 * would assert something the input never said.
 *
 * A row whose time is missing is dropped by default and counted in `dropped`; pass
 * `onMissingTime: "error"` to reject it instead. A row whose time is present but invalid
 * always throws, because that is a data error rather than an absence.
 */
export function resample(rows: readonly Row[], columns: readonly string[], options: ResampleOptions): ResampleResult {
  if (options === null || typeof options !== "object") {
    throw new ValidationError("resample expects an options object.");
  }
  const interval = assertInterval(options.every, "resample");
  requireColumn(columns, options.timeColumn, "resample");
  const label = options.label ?? "period";
  const onMissingTime = options.onMissingTime ?? "drop";
  if (onMissingTime !== "drop" && onMissingTime !== "error") {
    throw new ValidationError(
      `resample: onMissingTime must be "drop" or "error", received "${String(options.onMissingTime)}".`,
    );
  }
  if (options.aggregate === null || typeof options.aggregate !== "object" || Array.isArray(options.aggregate)) {
    throw new ValidationError("resample expects aggregate to map source columns to aggregations.");
  }
  const targets = Object.keys(options.aggregate);
  if (targets.length === 0) throw new ValidationError("resample expects at least one aggregate column.");
  for (const target of targets) {
    requireColumn(columns, target, "resample");
    const aggregation = options.aggregate[target];
    if (typeof aggregation !== "string" || !AGGREGATIONS.has(aggregation)) {
      throw new ValidationError(
        `resample: unsupported aggregation "${String(aggregation)}" for "${target}". ` +
          "Use sum, mean, median, min, max, count, first, or last.",
      );
    }
  }
  if (label === options.timeColumn) {
    throw new ValidationError("resample: the label column cannot replace the time column it buckets.");
  }

  const buckets = new Map<string, { start: Date; rows: Row[] }>();
  let dropped = 0;

  for (const [index, row] of rows.entries()) {
    const time = toTime(row[options.timeColumn], `resample: row ${index}, column "${options.timeColumn}"`);
    if (time === null) {
      if (onMissingTime === "error") {
        throw new ValidationError(
          `resample: row ${index} has a missing value in "${options.timeColumn}". ` +
            'Set onMissingTime to "drop" to skip such rows.',
        );
      }
      dropped += 1;
      continue;
    }
    const start = periodStart(time, interval);
    const key = start.toISOString();
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { start, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(row);
  }

  const ordered = [...buckets.values()].sort((left, right) => left.start.getTime() - right.start.getTime());
  const outColumns = [label, ...targets];
  const out: Row[] = ordered.map((bucket) => {
    const next: Row = { [label]: periodLabel(bucket.start, interval) };
    for (const target of targets) {
      const values = bucket.rows.map((row) => row[target]);
      next[target] = combine(values, options.aggregate[target] as ResampleAggregation);
    }
    return next;
  });

  return {
    rows: out,
    columns: outColumns,
    bucketed: rows.length - dropped,
    dropped,
  };
}

/** Distinct bucket labels for a time column, in ascending order. Useful for inspection. */
export function periodBuckets(
  rows: readonly Row[],
  columns: readonly string[],
  timeColumn: string,
  interval: TimeInterval,
): string[] {
  requireColumn(columns, timeColumn, "periodBuckets");
  assertInterval(interval, "periodBuckets");
  const seen = new Map<string, Date>();
  for (const [index, row] of rows.entries()) {
    const time = toTime(row[timeColumn], `periodBuckets: row ${index}, column "${timeColumn}"`);
    if (time === null) continue;
    const start = periodStart(time, interval);
    seen.set(periodLabel(start, interval), start);
  }
  return [...seen.entries()].sort((left, right) => left[1].getTime() - right[1].getTime()).map(([label]) => label);
}
