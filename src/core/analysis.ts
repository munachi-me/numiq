/**
 * Sampling strategies and time-oriented derivations added in 1.2.0.
 *
 * `prepare.ts` already draws a simple random sample; this module adds the two designs
 * that need structure — stratified and systematic — plus percentage change and cohort
 * analysis, which both work over an ordered series.
 *
 * Every random draw accepts a `seed`, and a seeded draw is reproducible across runs and
 * across machines: the generator is `mulberry32`, the same one `sampleRows` uses, so a
 * seed means the same thing everywhere in the library.
 */
import { ValidationError } from "../errors/index.js";
import { periodLabel, periodStart, toTime } from "./timeseries.js";
import { mulberry32 } from "./prepare.js";
import type { Row } from "./types.js";
import type { SampleOptions } from "./prepare.js";
import type { PreparedTable } from "./prepare.js";
import type { TimeInterval } from "./timeseries.js";

function randomFor(seed: number | undefined): () => number {
  return seed === undefined ? Math.random : mulberry32(seed);
}

function copyRow(row: Row, columns: readonly string[]): Row {
  const copy: Row = {};
  for (const column of columns) copy[column] = row[column];
  return copy;
}

/** Group row indices by the joined values of `columns`, preserving first-appearance order. */
function strataGroups(rows: readonly Row[], columns: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as Row;
    const key = JSON.stringify(columns.map((column) => row[column] ?? null));
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [index]);
    else bucket.push(index);
  }
  return groups;
}

/**
 * Draw `size` rows proportionally from each stratum.
 *
 * Allocation is largest-remainder: each stratum gets `floor(size * share)` and the rows
 * left over by rounding go to the strata with the largest fractional parts. That keeps
 * the total exactly `size` while staying as close to proportional as integers allow.
 *
 * A stratum with rows but a rounded allocation of zero is given one row, because dropping
 * a stratum entirely would silently remove a category from the sample. When the strata are
 * too small to honour both rules, the sample can therefore exceed `size`; the result is
 * never smaller than requested.
 */
export function stratifiedSample(
  rows: readonly Row[],
  columns: readonly string[],
  size: number,
  strata: readonly string[],
  options: SampleOptions = {},
): PreparedTable {
  if (!Number.isInteger(size) || size < 0) {
    throw new ValidationError(`stratifiedSample expects a non-negative integer size, received ${String(size)}.`);
  }
  if (strata.length === 0) {
    throw new ValidationError("stratifiedSample needs at least one strata column.");
  }
  if (size === 0) return { rows: [], columns: [...columns] };
  if (rows.length === 0) {
    throw new ValidationError("stratifiedSample cannot draw rows from an empty dataset.");
  }
  if (size > rows.length) {
    throw new ValidationError(
      `stratifiedSample cannot draw ${size} rows from ${rows.length}; a stratified sample draws without replacement.`,
    );
  }

  const random = randomFor(options.seed);
  const groups = [...strataGroups(rows, strata).values()];
  const total = rows.length;

  const exact = groups.map((group) => (size * group.length) / total);
  const allocation = exact.map((value) => Math.floor(value));
  let assigned = allocation.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  let cursor = 0;
  while (assigned < size && byRemainder.length > 0) {
    const target = byRemainder[cursor % byRemainder.length] as { index: number };
    allocation[target.index] = (allocation[target.index] ?? 0) + 1;
    assigned += 1;
    cursor += 1;
  }

  const picked: Row[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const members = groups[groupIndex] as number[];
    const take = Math.min(Math.max(allocation[groupIndex] ?? 0, 1), members.length);
    const shuffled = [...members];
    // Partial Fisher-Yates: only the first `take` positions need to be decided.
    for (let position = 0; position < take; position += 1) {
      const swapWith = position + Math.floor(random() * (shuffled.length - position));
      const held = shuffled[position] as number;
      shuffled[position] = shuffled[swapWith] as number;
      shuffled[swapWith] = held;
    }
    for (let position = 0; position < take; position += 1) {
      const row = rows[shuffled[position] as number];
      if (row !== undefined) picked.push(copyRow(row, columns));
    }
  }

  return { rows: picked, columns: [...columns] };
}

/**
 * Systematic sample: a random start in `[0, interval)`, then every `interval`-th row.
 *
 * Always takes exactly `floor(n / interval)` rows. Fixing the count matters: taking every
 * `interval`-th row from a random start otherwise yields one extra row whenever the start
 * is small enough that a final row still fits, so the sample size would depend on the
 * draw. Every selected row is exactly `interval` apart and no partial final cycle is used.
 * One pass, no shuffle, so it is cheap on a very large dataset.
 *
 * **Limitation:** if the data are periodic with a period that divides `interval`, the
 * sample can be systematically unrepresentative. A stratified or random sample is safer
 * when that is possible.
 */
export function systematicSample(
  rows: readonly Row[],
  columns: readonly string[],
  interval: number,
  options: SampleOptions = {},
): PreparedTable {
  if (!Number.isInteger(interval) || interval < 1) {
    throw new ValidationError(
      `systematicSample expects an integer interval of at least 1, received ${String(interval)}.`,
    );
  }
  const random = randomFor(options.seed);
  const start = Math.floor(random() * interval);
  const count = Math.floor(rows.length / interval);
  const picked: Row[] = [];
  for (let taken = 0; taken < count; taken += 1) {
    // `start + taken*interval` is always in range: start < interval and
    // count*interval <= rows.length, so the last index is below rows.length.
    const row = rows[start + taken * interval];
    if (row !== undefined) picked.push(copyRow(row, columns));
  }
  return { rows: picked, columns: [...columns] };
}

/**
 * Percentage change from the previous value: `(x[i] - x[i-1]) / |x[i-1]| * 100`.
 *
 * `null` where the previous value is missing or zero. The denominator is absolute so a
 * change from `-100` to `-50` reads as `+50%` rather than flipping sign, and the first row
 * has no predecessor and is `null`.
 */
export function percentChange(values: readonly unknown[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index === 0) {
      out.push(null);
      continue;
    }
    const current = values[index];
    const previous = values[index - 1];
    if (
      typeof current !== "number" ||
      !Number.isFinite(current) ||
      typeof previous !== "number" ||
      !Number.isFinite(previous) ||
      previous === 0
    ) {
      out.push(null);
      continue;
    }
    out.push(((current - previous) / Math.abs(previous)) * 100);
  }
  return out;
}

/** One aggregate requested by a cohort analysis. */
export interface CohortMetric {
  /** Numeric column to aggregate. */
  readonly column: string;
  /** `sum`, `mean`, `count`, `min`, or `max`. */
  readonly operation: "sum" | "mean" | "count" | "min" | "max";
  /** Output column name. Defaults to `${column}_${operation}`. */
  readonly name?: string;
}

/** Options for `cohortAnalysis`. */
export interface CohortOptions {
  /** Column whose value identifies the cohort a row belongs to. */
  readonly cohort: string;
  /** Time column used to derive the period. */
  readonly time: string;
  /** Period granularity. Default `month`. */
  readonly interval?: TimeInterval;
  /** Aggregates to compute per cohort-period cell. */
  readonly metrics: readonly CohortMetric[];
}

/**
 * Aggregate rows into cohort × period cells.
 *
 * Output columns are `cohort`, `period`, `rows`, then one column per metric. Cells appear
 * in first-appearance order of cohort, then ascending period, so the output is
 * deterministic and ready to pivot.
 *
 * A time value that cannot be parsed throws rather than being dropped: silently
 * discarding rows would move revenue or counts between periods without telling anyone,
 * and a cohort table that quietly omits data is worse than one that refuses to build.
 * `rows` in each cell reports how many rows contributed to it.
 */
export function cohortAnalysis(rows: readonly Row[], options: CohortOptions): PreparedTable {
  const { cohort, time, metrics } = options;
  const interval = options.interval ?? "month";

  if (metrics.length === 0) {
    throw new ValidationError("cohortAnalysis needs at least one metric.");
  }
  for (const metric of metrics) {
    if (!["sum", "mean", "count", "min", "max"].includes(metric.operation)) {
      throw new ValidationError(`cohortAnalysis does not support operation "${String(metric.operation)}".`);
    }
  }

  const outputColumns = [
    cohort,
    "period",
    "rows",
    ...metrics.map((metric) => metric.name ?? `${metric.column}_${metric.operation}`),
  ];

  interface Cell {
    cohort: unknown;
    period: Date;
    values: Map<string, unknown[]>;
    rows: number;
  }

  const cells = new Map<string, Cell>();
  const cohortOrder: unknown[] = [];

  for (const row of rows) {
    const date = toTime(row[time], `cohortAnalysis time column "${time}"`);
    if (date === null) continue;
    const start = periodStart(date, interval);
    const cohortValue = row[cohort] ?? null;
    const key = `${JSON.stringify(cohortValue)}|${start.getTime()}`;

    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { cohort: cohortValue, period: start, values: new Map(), rows: 0 };
      cells.set(key, cell);
      if (!cohortOrder.some((seen) => seen === cohortValue)) cohortOrder.push(cohortValue);
    }
    cell.rows += 1;
    for (const metric of metrics) {
      const name = metric.name ?? `${metric.column}_${metric.operation}`;
      const bucket = cell.values.get(name);
      const value = row[metric.column];
      if (bucket === undefined) cell.values.set(name, [value]);
      else bucket.push(value);
    }
  }

  const ordered = [...cells.values()].sort((a, b) => {
    const cohortDelta = cohortOrder.indexOf(a.cohort) - cohortOrder.indexOf(b.cohort);
    return cohortDelta !== 0 ? cohortDelta : a.period.getTime() - b.period.getTime();
  });

  const outRows: Row[] = ordered.map((cell) => {
    const out: Row = { [cohort]: cell.cohort, period: periodLabel(cell.period, interval), rows: cell.rows };
    for (const metric of metrics) {
      const name = metric.name ?? `${metric.column}_${metric.operation}`;
      out[name] = aggregateValues(cell.values.get(name) ?? [], metric.operation);
    }
    return out;
  });

  return { rows: outRows, columns: outputColumns };
}

/** Aggregate one cell's raw values, ignoring missing and non-numeric cells for numeric operations. */
function aggregateValues(values: readonly unknown[], operation: CohortMetric["operation"]): number | null {
  if (operation === "count") return values.length;
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  switch (operation) {
    case "sum":
      return numbers.reduce((sum, value) => sum + value, 0);
    case "mean":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    default:
      return null;
  }
}
