/**
 * Window functions: values that depend on a row's position among its neighbours.
 *
 * Every function here requires an explicit `orderBy`, because a window result is only
 * meaningful relative to a stated order. Passing the order in rather than reading the
 * dataset's current row order means the caller cannot get a different answer by sorting
 * first: the same `orderBy` always produces the same result.
 *
 * Rows are partitioned by zero or more columns before the order is applied, so a window
 * never sees across a partition boundary. Missing ordering values sort last in both
 * directions, matching `Dataset.sort`.
 */
import type { Row } from "./types.js";
import type { PreparedTable } from "./prepare.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";
import { compareValues } from "../utils/compare.js";

/** Direction for a single ordering key. */
export type WindowDirection = "asc" | "desc";

/**
 * One ordering key.
 *
 * A bare column name sorts ascending. The object form allows a direction, and repeating
 * keys are compared left to right, so the last key decides ties among the earlier ones.
 */
export type WindowOrderKey = string | { column: string; direction?: WindowDirection };

/** Options shared by every window function. */
export interface WindowOptions {
  /** Columns that define independent groups. A window never spans a partition. */
  readonly partitionBy?: string | readonly string[];
  /** Ordering keys. Required: without an order there is no "previous" row. */
  readonly orderBy: WindowOrderKey | readonly WindowOrderKey[];
}

/** A window function that returns one value per input row. */
export type WindowFn = (context: WindowRowContext) => unknown;

/** Context handed to a custom window function. */
export interface WindowRowContext {
  /** Row position within its partition, starting at 1. */
  readonly rowNumber: number;
  /** Zero-based position within the whole input, for diagnostics. */
  readonly index: number;
  /** The row itself. */
  readonly row: Row;
  /** Position of this row's partition in first-appearance order, starting at 0. */
  readonly partition: number;
  /** Rows in this partition, already ordered. */
  readonly rows: readonly Row[];
}

/** Options for `windowColumn`. */
export interface WindowColumnOptions extends WindowOptions {
  /** Rows produced for every input row. */
  readonly fn: WindowFn;
}

/** Options for the offset functions `lag` and `lead`. */
export interface OffsetOptions extends WindowOptions {
  /** How many rows to look back (or forward). Defaults to 1. */
  readonly offset?: number;
  /** Value for rows with no counterpart. Defaults to `null`. */
  readonly fill?: unknown;
}

/** Options for the running functions `cumSum` and `cumMean`. */
export interface CumulativeOptions extends WindowOptions {
  /** Skip missing values instead of emitting `null` for that row. Defaults to false. */
  readonly ignoreMissing?: boolean;
}

/** Options for the moving functions (`rolling*`). */
export interface RollingOptions extends WindowOptions {
  /**
   * Rows in the window, including the current one. Must be at least 1.
   *
   * The window is trailing and aligned so it ends at the current row: for `window: 3`
   * the third row averages rows 1-3. A row with fewer than `window` predecessors emits
   * `null` unless `minPeriods` allows a shorter window.
   */
  readonly window: number;
  /**
   * Fewest present values required to emit a result. Defaults to `window`, so a short
   * leading window emits `null` rather than an average of fewer rows than requested.
   */
  readonly minPeriods?: number;
  /**
   * Emit `null` instead of a number for rows where fewer than `minPeriods` observations
   * are present. `minPeriods` cannot exceed `window`, so this never widens the window.
   */
  readonly ignoreMissing?: boolean;
}

/** A ranking position for one row. Ties share a rank. */
export interface RankedRow {
  /** Original zero-based input position. */
  readonly index: number;
  readonly rank: number;
}

interface ResolvedOrder {
  readonly column: string;
  readonly factor: 1 | -1;
}

const DIRECTIONS: ReadonlySet<string> = new Set(["asc", "desc"]);

function toArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) throw new ValidationError("Expected a column name or an array of names.");
  return value;
}

function requireColumns(columns: readonly string[], requested: readonly string[], method: string): void {
  for (const column of requested) {
    if (!columns.includes(column)) {
      const error = new ColumnNotFoundError(column, columns);
      error.message = `${method}: ${error.message}`;
      throw error;
    }
  }
}

function resolveOrder(
  orderBy: WindowOrderKey | readonly WindowOrderKey[],
  columns: readonly string[],
  method: string,
): ResolvedOrder[] {
  if (orderBy === undefined || orderBy === null) {
    throw new ValidationError(
      `${method} requires an explicit orderBy: window results are defined relative to an order, ` +
        "so the order must be stated rather than inherited from the current row order.",
    );
  }
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy as WindowOrderKey];
  if (keys.length === 0) {
    throw new ValidationError(`${method} requires at least one orderBy key.`);
  }
  return keys.map((key) => {
    if (typeof key === "string") {
      requireColumns(columns, [key], method);
      return { column: key, factor: 1 } as const;
    }
    if (typeof key !== "object" || key === null || typeof key.column !== "string") {
      throw new ValidationError(`${method}: an orderBy key must be a column name or { column, direction }.`);
    }
    requireColumns(columns, [key.column], method);
    const direction = key.direction ?? "asc";
    if (!DIRECTIONS.has(direction)) {
      throw new ValidationError(`${method}: direction must be "asc" or "desc", received "${String(direction)}".`);
    }
    return { column: key.column, factor: direction === "asc" ? 1 : -1 } as const;
  });
}

/**
 * Group row indices into partitions, preserving first-appearance order.
 *
 * Partition keys use `stableKey` so `1` and `"1"` are different partitions, matching how
 * joins compare keys.
 */
function partitionIndices(rows: readonly Row[], partitionBy: readonly string[]): number[][] {
  if (partitionBy.length === 0) {
    return [rows.map((_, index) => index)];
  }
  const groups = new Map<string, number[]>();
  const order: string[] = [];
  for (const [index, row] of rows.entries()) {
    const key = partitionBy.map((column) => stableKey(row[column])).join("\u0000");
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(index);
  }
  return order.map((key) => groups.get(key) as number[]);
}

/**
 * Order indices within a partition.
 *
 * Missing values sort last in both directions and keep their input order among
 * themselves; ties on every key also keep input order, so the result is deterministic
 * and does not depend on the sort implementation.
 */
function orderIndices(rows: readonly Row[], indices: readonly number[], order: readonly ResolvedOrder[]): number[] {
  return [...indices].sort((leftIndex, rightIndex) => {
    for (const key of order) {
      const leftValue = rows[leftIndex]?.[key.column];
      const rightValue = rows[rightIndex]?.[key.column];
      const leftMissing = !isPresent(leftValue);
      const rightMissing = !isPresent(rightValue);
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) continue;
        return leftMissing ? 1 : -1;
      }
      const comparison = compareValues(leftValue, rightValue);
      if (comparison !== 0) return comparison * key.factor;
    }
    return leftIndex - rightIndex;
  });
}

/** Numeric view of a cell, or `null` when the cell is not a finite number. */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Build an output table with one appended column. */
function withColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  values: readonly unknown[],
): PreparedTable {
  const out = rows.map((row, index) => {
    const next: Row = {};
    for (const column of columns) next[column] = cloneValue(row[column]);
    next[name] = cloneValue(values[index] ?? null);
    return next;
  });
  return { rows: out, columns: [...columns, name] };
}

function assertColumnName(columns: readonly string[], name: string, method: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new ValidationError(`${method} expects a non-empty column name.`);
  }
  if (columns.includes(name)) {
    throw new ValidationError(
      `${method}: column "${name}" already exists. Window results are appended, so choose a new name.`,
    );
  }
}

/** Validate shared window options and return the resolved plan. */
function plan(
  rows: readonly Row[],
  columns: readonly string[],
  options: WindowOptions,
  method: string,
): { partitions: number[][]; ordered: number[][]; partitionsByIndex: number[]; positionInPartition: number[] } {
  if (options === null || typeof options !== "object") {
    throw new ValidationError(`${method} expects an options object.`);
  }
  const partitionBy = toArray(options.partitionBy);
  requireColumns(columns, partitionBy, method);
  const order = resolveOrder(options.orderBy, columns, method);

  const partitions = partitionIndices(rows, partitionBy);
  const ordered = partitions.map((indices) => orderIndices(rows, indices, order));

  const partitionsByIndex = new Array<number>(rows.length).fill(0);
  const positionInPartition = new Array<number>(rows.length).fill(0);
  ordered.forEach((indices, partitionIndex) => {
    indices.forEach((index, position) => {
      partitionsByIndex[index] = partitionIndex;
      positionInPartition[index] = position;
    });
  });

  return { partitions, ordered, partitionsByIndex, positionInPartition };
}

/**
 * A dataset column computed from each row's ordered position.
 *
 * `fn` receives the row, its 1-based position within its partition, and the ordered rows
 * of that partition. The callback form is the escape hatch for a window that the named
 * helpers do not cover; prefer the named helpers where one fits.
 */
export function windowColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  options: WindowColumnOptions,
): PreparedTable {
  assertColumnName(columns, name, "windowColumn");
  if (typeof options?.fn !== "function") {
    throw new ValidationError("windowColumn expects a fn callback.");
  }
  const { ordered, partitionsByIndex, positionInPartition } = plan(rows, columns, options, "windowColumn");

  const values = new Array<unknown>(rows.length);
  for (const [index, row] of rows.entries()) {
    const partition = partitionsByIndex[index] ?? 0;
    const partitionRows = (ordered[partition] ?? []).map((position) => rows[position] as Row);
    values[index] = options.fn({
      row,
      index,
      partition,
      rowNumber: (positionInPartition[index] ?? 0) + 1,
      rows: partitionRows,
    });
  }
  return withColumn(rows, columns, name, values);
}

/**
 * 1-based position of each row within its partition.
 *
 * Every row gets a distinct number, so ties in the ordering are broken by input order.
 * Use `rank` when tied rows should share a position.
 */
export function rowNumber(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  options: WindowOptions,
): PreparedTable {
  assertColumnName(columns, name, "rowNumber");
  const { positionInPartition } = plan(rows, columns, options, "rowNumber");
  const values = rows.map((_, index) => (positionInPartition[index] ?? 0) + 1);
  return withColumn(rows, columns, name, values);
}

/** Rank with gaps: tied rows share a rank, and the next rank skips the tie count. */
export function rank(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  options: WindowOptions,
): PreparedTable {
  return rankedColumn(rows, columns, name, options, "rank");
}

/** Rank without gaps: tied rows share a rank, and the next rank is the next integer. */
export function denseRank(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  options: WindowOptions,
): PreparedTable {
  return rankedColumn(rows, columns, name, options, "denseRank");
}

function rankedColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  options: WindowOptions,
  method: "rank" | "denseRank",
): PreparedTable {
  assertColumnName(columns, name, method);
  const { ordered } = plan(rows, columns, options, method);
  const resolvedOrder = resolveOrder(options.orderBy, columns, method);
  const values = new Array<unknown>(rows.length);

  for (const indices of ordered) {
    let currentRank = 0;
    let denseRankValue = 0;
    let previous: Row | null = null;
    for (const [position, index] of indices.entries()) {
      const row = rows[index] as Row;
      const tied = previous !== null && sameOrderValues(previous, row, resolvedOrder);
      if (!tied) {
        currentRank = position + 1;
        denseRankValue += 1;
      }
      values[index] = method === "rank" ? currentRank : denseRankValue;
      previous = row;
    }
  }
  return withColumn(rows, columns, name, values);
}

/** True when two rows have equal values on every ordering key, treating missing as equal. */
function sameOrderValues(left: Row, right: Row, order: readonly ResolvedOrder[]): boolean {
  for (const key of order) {
    const leftValue = left[key.column];
    const rightValue = right[key.column];
    const leftMissing = !isPresent(leftValue);
    const rightMissing = !isPresent(rightValue);
    if (leftMissing || rightMissing) {
      if (leftMissing !== rightMissing) return false;
      continue;
    }
    if (compareValues(leftValue, rightValue) !== 0) return false;
  }
  return true;
}

/** Value from the row `offset` positions earlier in the partition. */
export function lag(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: OffsetOptions,
): PreparedTable {
  return offsetColumn(rows, columns, name, column, options, "lag");
}

/** Value from the row `offset` positions later in the partition. */
export function lead(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: OffsetOptions,
): PreparedTable {
  return offsetColumn(rows, columns, name, column, options, "lead");
}

function offsetColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: OffsetOptions,
  method: "lag" | "lead",
): PreparedTable {
  assertColumnName(columns, name, method);
  requireColumns(columns, [column], method);
  const offset = options.offset ?? 1;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError(`${method}: offset must be a non-negative integer, received ${String(options.offset)}.`);
  }
  const { ordered, positionInPartition, partitionsByIndex } = plan(rows, columns, options, method);

  const values = new Array<unknown>(rows.length);
  for (const [index] of rows.entries()) {
    const partition = partitionsByIndex[index] ?? 0;
    const position = positionInPartition[index] ?? 0;
    const target = method === "lag" ? position - offset : position + offset;
    const indices = ordered[partition] ?? [];
    const sourceIndex = indices[target];
    values[index] =
      sourceIndex === undefined ? cloneValue(options.fill ?? null) : cloneValue(rows[sourceIndex]?.[column] ?? null);
  }
  return withColumn(rows, columns, name, values);
}

/** Running total of a numeric column, in partition order. */
export function cumSum(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: CumulativeOptions,
): PreparedTable {
  return cumulativeColumn(rows, columns, name, column, options, "cumSum");
}

/** Running mean of a numeric column, in partition order. */
export function cumMean(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: CumulativeOptions,
): PreparedTable {
  return cumulativeColumn(rows, columns, name, column, options, "cumMean");
}

function cumulativeColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: CumulativeOptions,
  method: "cumSum" | "cumMean",
): PreparedTable {
  assertColumnName(columns, name, method);
  requireColumns(columns, [column], method);
  const ignoreMissing = options.ignoreMissing ?? false;
  const { ordered } = plan(rows, columns, options, method);
  const values = new Array<unknown>(rows.length);

  for (const indices of ordered) {
    let total = 0;
    let count = 0;
    let broken = false;
    for (const index of indices) {
      const value = asNumber(rows[index]?.[column]);
      if (value === null) {
        if (!ignoreMissing) broken = true;
        values[index] = broken
          ? null
          : method === "cumSum"
            ? count === 0
              ? null
              : total
            : count === 0
              ? null
              : total / count;
        continue;
      }
      total += value;
      count += 1;
      values[index] = broken ? null : method === "cumSum" ? total : total / count;
    }
  }
  return withColumn(rows, columns, name, values);
}

/** Trailing sum over a fixed window of rows. */
export function rollingSum(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
): PreparedTable {
  return rollingColumn(rows, columns, name, column, options, "rollingSum");
}

/** Trailing mean over a fixed window of rows. */
export function rollingMean(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
): PreparedTable {
  return rollingColumn(rows, columns, name, column, options, "rollingMean");
}

/** Trailing minimum over a fixed window of rows. */
export function rollingMin(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
): PreparedTable {
  return rollingColumn(rows, columns, name, column, options, "rollingMin");
}

/** Trailing maximum over a fixed window of rows. */
export function rollingMax(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
): PreparedTable {
  return rollingColumn(rows, columns, name, column, options, "rollingMax");
}

/**
 * Trailing sample standard deviation over a fixed window of rows.
 *
 * Divides by `n - 1` like `std`, so a window with fewer than two present values has no
 * spread to report and emits `null` rather than `0`.
 */
export function rollingStd(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
): PreparedTable {
  return rollingColumn(rows, columns, name, column, options, "rollingStd");
}

function rollingColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  column: string,
  options: RollingOptions,
  method: "rollingSum" | "rollingMean" | "rollingMin" | "rollingMax" | "rollingStd",
): PreparedTable {
  assertColumnName(columns, name, method);
  requireColumns(columns, [column], method);
  const window = options.window;
  if (!Number.isInteger(window) || window < 1) {
    throw new ValidationError(`${method}: window must be a positive integer, received ${String(window)}.`);
  }
  const minPeriods = options.minPeriods ?? window;
  if (!Number.isInteger(minPeriods) || minPeriods < 1 || minPeriods > window) {
    throw new ValidationError(
      `${method}: minPeriods must be an integer between 1 and window (${window}), received ${String(options.minPeriods)}.`,
    );
  }

  const { ordered } = plan(rows, columns, options, method);
  const values = new Array<unknown>(rows.length);

  for (const indices of ordered) {
    for (const [position, index] of indices.entries()) {
      const start = Math.max(0, position - window + 1);
      const slice = indices.slice(start, position + 1);
      const numbers: number[] = [];
      for (const sourceIndex of slice) {
        const value = asNumber(rows[sourceIndex]?.[column]);
        if (value !== null) numbers.push(value);
      }
      if (numbers.length < minPeriods) {
        values[index] = null;
        continue;
      }
      values[index] = reduceWindow(numbers, method);
    }
  }
  return withColumn(rows, columns, name, values);
}

function reduceWindow(
  numbers: readonly number[],
  method: "rollingSum" | "rollingMean" | "rollingMin" | "rollingMax" | "rollingStd",
): number | null {
  if (method === "rollingSum") return numbers.reduce((total, value) => total + value, 0);
  if (method === "rollingMean") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (method === "rollingMin") return numbers.reduce((lowest, value) => (value < lowest ? value : lowest));
  if (method === "rollingMax") return numbers.reduce((highest, value) => (value > highest ? value : highest));
  if (numbers.length < 2) return null;
  const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length;
  const squared = numbers.reduce((total, value) => total + (value - mean) ** 2, 0);
  return Math.sqrt(squared / (numbers.length - 1));
}

/** Ranked positions for every row, ordered as `rank` would produce them. */
export function rankRows(rows: readonly Row[], columns: readonly string[], options: WindowOptions): RankedRow[] {
  const { ordered } = plan(rows, columns, options, "rankRows");
  const resolvedOrder = resolveOrder(options.orderBy, columns, "rankRows");
  const result: RankedRow[] = [];
  for (const indices of ordered) {
    let currentRank = 0;
    let previous: Row | null = null;
    for (const [position, index] of indices.entries()) {
      const row = rows[index] as Row;
      if (previous === null || !sameOrderValues(previous, row, resolvedOrder)) currentRank = position + 1;
      result.push({ index, rank: currentRank });
      previous = row;
    }
  }
  return result;
}
