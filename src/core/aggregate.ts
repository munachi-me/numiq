/**
 * Aggregation primitives.
 *
 * Each function takes the *present* values of one column and returns a result, or `null`
 * when the answer is genuinely undefined for the data (an empty group, a single
 * observation with a sample variance, and so on). Missing values are removed by the
 * caller, so no function here has to think about `null` cells.
 *
 * Two numerical choices are deliberate:
 *
 * - **Summation uses Neumaier compensation.** Plain left-to-right addition loses low-order
 *   bits when one term dwarfs the running total, so `sum([1e16, 1, -1e16])` returns `0`
 *   instead of `1`. Compensated summation returns the correct answer for the same cost as
 *   a few extra additions.
 * - **Variance is two-pass.** The one-pass `E[x²] - E[x]²` shortcut cancels catastrophically
 *   for large means with small spread; computing deviations from the already-known mean is
 *   stable and we hold the values in memory anyway.
 */
import type { Row } from "./types.js";
import { compareValues } from "../utils/compare.js";
import { stableKey } from "../utils/values.js";

/** Every aggregation Numiq computes natively. */
export type AggregationOp =
  "count" | "sum" | "mean" | "min" | "max" | "median" | "first" | "last" | "nunique" | "std" | "variance";

/**
 * Operations that only make sense on numbers.
 *
 * `min`, `max`, `first`, `last`, `count`, and `nunique` are deliberately absent: they are
 * meaningful on text, booleans, and dates too.
 */
export const NUMERIC_OPS: ReadonlySet<AggregationOp> = new Set<AggregationOp>([
  "sum",
  "mean",
  "median",
  "std",
  "variance",
]);

/** Options shared by the dispersion aggregations. */
export interface DispersionOptions {
  /**
   * Delta degrees of freedom: `1` (default) for a sample, `0` for a population.
   *
   * A sample variance divides by `n - 1`; a population variance divides by `n`. The default
   * matches the usual data-science convention, where the data is a sample of something
   * larger.
   */
  ddof?: number;
}

/**
 * Neumaier-compensated summation.
 *
 * Tracks the rounding error of each addition and folds it back in at the end, so the
 * result does not depend on the order of the terms the way naive addition does.
 */
export function sum(values: readonly number[]): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    // `total` is larger in magnitude: the lost low-order bits are `total - next + value`.
    compensation += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return total + compensation;
}

/** Arithmetic mean, or `null` for no values. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

/**
 * Median: the middle value, or the mean of the two middle values for an even count.
 *
 * Returns `null` for no values. Does not mutate the caller's array.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/**
 * Variance with `ddof` degrees of freedom removed.
 *
 * Returns `null` when there are not enough observations to divide by — for example a single
 * value with the default sample `ddof` of 1. That is the honest answer: one observation
 * says nothing about spread.
 */
export function variance(values: readonly number[]): number | null;
export function variance(values: readonly number[], options: DispersionOptions): number | null;
export function variance(values: readonly number[], options: DispersionOptions = {}): number | null {
  const ddof = options.ddof ?? 1;
  const divisor = values.length - ddof;
  if (values.length === 0 || divisor <= 0) return null;
  const average = mean(values);
  if (average === null) return null;
  let squared = 0;
  for (const value of values) {
    const deviation = value - average;
    squared += deviation * deviation;
  }
  return squared / divisor;
}

/** Standard deviation: the square root of the variance. */
export function std(values: readonly number[]): number | null;
export function std(values: readonly number[], options: DispersionOptions): number | null;
export function std(values: readonly number[], options: DispersionOptions = {}): number | null {
  const spread = variance(values, options);
  return spread === null ? null : Math.sqrt(spread);
}

/** Smallest present value, using the same ordering as `Dataset.sort`. */
export function min(values: readonly unknown[]): unknown {
  return extremum(values, (order) => order < 0);
}

/** Largest present value, using the same ordering as `Dataset.sort`. */
export function max(values: readonly unknown[]): unknown {
  return extremum(values, (order) => order > 0);
}

function extremum(values: readonly unknown[], replaces: (order: number) => boolean): unknown {
  if (values.length === 0) return null;
  let best = values[0];
  for (const value of values) {
    if (best === undefined) {
      best = value;
      continue;
    }
    if (replaces(compareValues(value, best))) best = value;
  }
  return best ?? null;
}

/** First present value in source order. */
export function first(values: readonly unknown[]): unknown {
  return values.length === 0 ? null : (values[0] ?? null);
}

/** Last present value in source order. */
export function last(values: readonly unknown[]): unknown {
  return values.length === 0 ? null : (values[values.length - 1] ?? null);
}

/** Number of distinct present values. */
export function nunique(values: readonly unknown[]): number {
  const seen = new Set<string>();
  for (const value of values) seen.add(stableKey(value));
  return seen.size;
}

/** The aggregation callbacks receive this, so a custom aggregator can see more than values. */
export interface AggregationContext {
  /** The aggregated column, or `null` for a whole-group aggregation such as `{ op: "count" }`. */
  readonly column: string | null;
  /** The group's rows, frozen and already copied. Safe to read, impossible to corrupt. */
  readonly rows: readonly Readonly<Row>[];
}

/** A user-supplied aggregation over a bound column's present values. */
export type AggregationFn = (values: readonly unknown[], context: AggregationContext) => unknown;

/**
 * A user-supplied aggregation over a whole group.
 *
 * Typed separately from `AggregationFn` so a bare callback sees `Row` objects rather than
 * `unknown`, and does not need a cast to read a column.
 */
export type GroupAggregationFn = (rows: readonly Readonly<Row>[], context: AggregationContext) => unknown;

/** A built-in aggregation over an optional column. */
export interface AggregationSpec {
  /** Column to aggregate. Optional only for `count`, which then counts rows. */
  readonly column?: string;
  readonly op: AggregationOp;
  /** Applies to `std` and `variance` only. */
  readonly ddof?: number;
}

/**
 * A custom aggregation bound to one column.
 *
 * The callback receives that column's present values, so it can be written without
 * reaching into rows. Use a bare `AggregationFn` when the whole group is needed.
 */
export interface CustomAggregation {
  readonly column: string;
  readonly fn: AggregationFn;
}

/** A spec entry: a built-in aggregation, a column-bound callback, or a whole-group callback. */
export type AggregationEntry = AggregationSpec | CustomAggregation | GroupAggregationFn;

/** Output column name to aggregation. */
export type AggregateSpec = Readonly<Record<string, AggregationEntry>>;

/** Present, finite numbers from a value list. */
export function toNumbers(values: readonly unknown[]): number[] {
  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  }
  return numbers;
}

/** True when an entry is a bare callback over the whole group. */
export function isAggregationFn(entry: AggregationEntry): entry is GroupAggregationFn {
  return typeof entry === "function";
}

/** True when an entry is a callback bound to a single column. */
export function isCustomAggregation(entry: AggregationEntry): entry is CustomAggregation {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "fn" in entry &&
    typeof (entry as CustomAggregation).fn === "function"
  );
}
