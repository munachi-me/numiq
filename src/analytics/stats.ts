/**
 * Descriptive statistics beyond the aggregation primitives.
 *
 * `core/aggregate.ts` covers the reductions a grouping needs; this module adds the
 * distribution statistics `describe()` reports — quantiles, mode, range — and the
 * percentile machinery they share.
 *
 * Every function takes the *present* values of a column, so missing cells are removed by
 * the caller. Functions that cannot answer for the given data return `null` rather than a
 * placeholder such as `0` or `NaN`.
 */
import { compareValues } from "../utils/compare.js";
import { cloneValue, stableKey } from "../utils/values.js";

/**
 * Validate a quantile/probability argument.
 *
 * Separated so `quantile` and `percentile` reject the same bad input the same way instead
 * of one silently extrapolating.
 */
function assertProbability(value: number, label: string, scale: number): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new RangeError(`${label} must be a number, received ${String(value)}.`);
  }
  if (value < 0 || value > scale) {
    throw new RangeError(`${label} must be between 0 and ${scale}, received ${value}.`);
  }
}

/** Ascending copy, so no caller's array is reordered. */
function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

/**
 * Ascending copy of a numeric column, exposed so a caller computing several statistics
 * over one column can sort once instead of once per statistic.
 *
 * `describe()` uses this: the quartiles, the interquartile range, the median, and any
 * extra percentiles all read the same ordered array. Sorting is the dominant cost of
 * profiling a numeric column, so the saving is the whole point.
 */
export function sortedColumn(values: readonly number[]): number[] {
  return sortedNumbers(values);
}

/**
 * Interpolated percentile of an already-sorted array.
 *
 * Same arithmetic as `percentile`, and the caller guarantees ascending order. Kept
 * separate rather than adding a flag to `percentile`, so the public signature stays
 * "give me any array and I will not reorder it".
 */
export function percentileOfSorted(sorted: readonly number[], p: number): number | null {
  assertProbability(p, "percentile() p", 100);
  return interpolateSorted(sorted, p);
}

/** Median of an already-sorted array. */
export function medianOfSorted(sorted: readonly number[]): number | null {
  const count = sorted.length;
  if (count === 0) return null;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/** Quartiles of an already-sorted array. */
export function quartilesOfSorted(sorted: readonly number[]): Quartiles | null {
  const q1 = percentileOfSorted(sorted, 25);
  const q2 = percentileOfSorted(sorted, 50);
  const q3 = percentileOfSorted(sorted, 75);
  if (q1 === null || q2 === null || q3 === null) return null;
  return { q1, q2, q3 };
}

/**
 * Value frequencies of a column, counted once.
 *
 * Returns the number of distinct present values and the most frequent present value.
 * `describe()` needs both; computing them separately hashed the column twice for the same
 * answer.
 *
 * Ties go to the value seen first, which matches `mode()`.
 */
export function frequencies(values: readonly unknown[]): { unique: number; mode: unknown } {
  // Numeric fast path. Building a `stableKey` string per value costs a Map lookup plus a
  // string allocation, which is the most expensive part of profiling a numeric column.
  // For numbers the key is redundant: `Set` uses SameValueZero, so `NaN` matches `NaN`
  // and `-0` matches `0`, exactly as `String(value)` does. Any non-number falls through
  // to the general path, which keeps type tags so `1` never collides with `"1"`.
  let allNumbers = true;
  for (const value of values) {
    if (typeof value !== "number") {
      allNumbers = false;
      break;
    }
  }
  if (allNumbers) {
    const counts = new Map<number, number>();
    for (const value of values as readonly number[]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let mode: unknown = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        mode = value;
      }
    }
    return { unique: counts.size, mode };
  }

  const counts = new Map<string, { value: unknown; count: number }>();
  for (const value of values) {
    const key = stableKey(value);
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { value, count: 1 });
    else entry.count += 1;
  }
  let best: { value: unknown; count: number } | null = null;
  for (const entry of counts.values()) {
    if (best === null || entry.count > best.count) best = entry;
  }
  // Copy on the way out: a returned `Date` or object must not alias the caller's data.
  return { unique: counts.size, mode: best === null ? null : cloneValue(best.value) };
}

/**
 * Quantile of a numeric sample, using linear interpolation between order statistics.
 *
 * This is the Hyndman-Fan type 7 definition: the same one `numpy.percentile` and R's
 * `quantile(type = 7)` use by default, so results line up with those tools. With `n`
 * values the position is `(n - 1) * q`; a fractional position interpolates between the
 * two neighbouring values.
 *
 * Returns `null` for no values. Throws `RangeError` when `q` is outside `[0, 1]`.
 */
export function quantile(values: readonly number[], q: number): number | null {
  assertProbability(q, "quantile() q", 1);
  return interpolate(values, q * 100);
}

/**
 * Percentile of a numeric sample, with `p` in `[0, 100]`.
 *
 * A thin wrapper over `quantile` so callers can stay in percent units. The interpolation
 * method is the same, and is documented on `quantile`.
 */
export function percentile(values: readonly number[], p: number): number | null {
  assertProbability(p, "percentile() p", 100);
  return interpolate(values, p);
}

/**
 * Shared interpolation for `quantile` and `percentile`.
 *
 * Takes the percentile directly and multiplies before dividing, so `(n - 1) * p / 100`
 * rounds once instead of inheriting the error from a pre-divided `p / 100`. That is the
 * difference between `p10` of `[2, 4, 4, 4, 5, 5, 7, 9]` reading `3.4` and
 * `3.4000000000000004`.
 */
function interpolate(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  return interpolateSorted(sortedNumbers(values), p);
}

/** Interpolation over an already-ascending array. */
function interpolateSorted(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const first = sorted[0];
  if (first === undefined) return null;
  if (sorted.length === 1) return first;

  const position = ((sorted.length - 1) * p) / 100;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

/** The three quartiles of a numeric sample. */
export interface Quartiles {
  readonly q1: number;
  readonly q2: number;
  readonly q3: number;
}

/**
 * First, second, and third quartiles.
 *
 * Returns `null` when there are no values. A single value is its own Q1, median, and Q3,
 * because there is no spread to describe.
 */
export function quartiles(values: readonly number[]): Quartiles | null {
  if (values.length === 0) return null;
  return quartilesOfSorted(sortedNumbers(values));
}

/**
 * Interquartile range: Q3 - Q1.
 *
 * Returns `null` for no values. Non-negative by construction, and `0` for a single value.
 */
export function iqr(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const parts = quartilesOfSorted(sortedNumbers(values));
  return parts === null ? null : parts.q3 - parts.q1;
}

/**
 * Most frequent present value.
 *
 * Ties are broken by first appearance in the input, so the answer is deterministic for a
 * given column order and does not depend on insertion order of an internal map. Returns
 * `null` for no values.
 *
 * Works on any comparable value type — numbers, text, booleans, dates — because equality
 * uses the same stable key as `Dataset.unique`.
 */
export function mode(values: readonly unknown[]): unknown {
  if (values.length === 0) return null;
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const value of values) {
    const key = stableKey(value);
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { value, count: 1 });
    else entry.count += 1;
  }
  let best: { value: unknown; count: number } | null = null;
  for (const entry of counts.values()) {
    if (best === null || entry.count > best.count) best = entry;
  }
  // Copy on the way out: a returned `Date` or object must not alias the caller's data.
  return best === null ? null : cloneValue(best.value);
}

/**
 * Difference between the largest and smallest value.
 *
 * Numeric only: a spread of dates or text has no single unit, so callers get `null` rather
 * than a meaningless subtraction. Returns `null` for no values.
 */
export function range(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let low = values[0];
  let high = values[0];
  if (low === undefined || high === undefined) return null;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return high - low;
}

/** Smallest and largest present value. */
export interface Extremes {
  readonly min: unknown;
  readonly max: unknown;
}

/**
 * Smallest and largest present value, ordered by `compareValues`.
 *
 * Works across types because it uses the same ordering as `Dataset.sort`; callers decide
 * whether that ordering is meaningful for their column.
 */
export function extremes(values: readonly unknown[]): Extremes | null {
  if (values.length === 0) return null;
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (low === undefined || compareValues(value, low) < 0) low = value;
    if (high === undefined || compareValues(value, high) > 0) high = value;
  }
  if (low === undefined || high === undefined) return null;
  return { min: low, max: high };
}
