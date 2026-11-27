/**
 * Advanced statistics: relationships between columns, distribution shape, and
 * position within a distribution.
 *
 * `stats.ts` answers questions about one column's spread; this module answers questions
 * that need either two columns (covariance, correlation) or a reference distribution
 * (z-scores, percentile rank, outliers).
 *
 * Every function takes the *present* values of a column, so missing cells are removed by
 * the caller. Where a result is genuinely undefined — zero variance, too few observations —
 * the function returns `null` rather than `NaN` or `0`, because a caller can branch on
 * `null` but a `NaN` silently poisons arithmetic downstream.
 *
 * ## Missing-value policy
 *
 * Pairwise. `covariance` and the correlations take two columns and use only the rows where
 * *both* values are present. A row missing either coordinate cannot contribute to a
 * relationship between the two, and imputing one would invent data. Consequently `n`
 * differs between pairs, and a correlation matrix computed over a dataset with scattered
 * gaps compares coefficients measured on slightly different row sets. Every structured
 * result reports the `n` it used so this is visible rather than hidden.
 *
 * ## What this module does not do
 *
 * It computes no p-values and claims no statistical significance. A correlation
 * coefficient on nine points and one on nine thousand look identical as numbers, and
 * deciding whether a relationship is real needs a test with its own assumptions. Shipping
 * an unqualified "significant" flag would be worse than shipping nothing.
 */
import { mean, variance } from "../core/aggregate.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { medianOfSorted, quartiles, sortedColumn } from "./stats.js";

/** A pair of numbers drawn from the same row. */
interface Pair {
  x: number;
  y: number;
}

/**
 * Rows where both columns hold finite numbers.
 *
 * Non-finite values are excluded alongside missing ones: `Infinity` would make every
 * downstream mean infinite, and a correlation involving it is meaningless rather than
 * merely imprecise.
 */
function pairedValues(left: readonly unknown[], right: readonly unknown[]): Pair[] {
  const length = Math.min(left.length, right.length);
  const pairs: Pair[] = [];
  for (let index = 0; index < length; index += 1) {
    const x = left[index];
    const y = right[index];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      pairs.push({ x, y });
    }
  }
  return pairs;
}

/** Present finite numbers from one column, for the single-column statistics. */
function finiteNumbers(values: readonly unknown[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

/**
 * Validate `ddof`, mirroring `describe()` so the two cannot drift apart.
 */
function assertDdof(ddof: number): void {
  if (typeof ddof !== "number" || !Number.isInteger(ddof) || ddof < 0) {
    throw new RangeError("Advanced statistics need a non-negative integer ddof.");
  }
}

/** Options for the dispersion-style statistics. */
export interface AdvancedOptions {
  /**
   * Delta degrees of freedom: `1` (default) for a sample, `0` for a population.
   *
   * Covariance and the correlations divide by `n - ddof`. Skewness and kurtosis use this
   * only to decide the *correction* term, not the denominator; see their documentation.
   */
  ddof?: number;
}

// ------------------------------------------------------------------ covariance

/**
 * Covariance of two columns over the rows where both are present.
 *
 * With `n` complete pairs, `ddof` of 1 (default) divides by `n - 1` — the sample
 * covariance — and `ddof` of 0 divides by `n`. Returns `null` when fewer than
 * `ddof + 1` pairs exist, because there is nothing left to divide by.
 *
 * Two-pass, for the same reason `variance` is: the one-pass `E[xy] - E[x]E[y]` form
 * cancels catastrophically when the means are large and the deviations small.
 */
export function covariance(
  left: readonly unknown[],
  right: readonly unknown[],
  options: AdvancedOptions = {},
): number | null {
  const ddof = options.ddof ?? 1;
  assertDdof(ddof);
  const pairs = pairedValues(left, right);
  const divisor = pairs.length - ddof;
  if (divisor <= 0) return null;

  const meanX = mean(pairs.map((pair) => pair.x));
  const meanY = mean(pairs.map((pair) => pair.y));
  if (meanX === null || meanY === null) return null;

  let total = 0;
  for (const pair of pairs) total += (pair.x - meanX) * (pair.y - meanY);
  return total / divisor;
}

/** A correlation coefficient together with the evidence behind it. */
export interface CorrelationResult {
  /** The coefficient, or `null` when it is undefined for the data. */
  r: number | null;
  /** Complete pairs the coefficient was computed from. */
  n: number;
  /**
   * Why `r` is `null`, or `null` when it is a real number.
   *
   * Distinguishing "too few points" from "no variance" matters: the first is a data
   * collection problem and the second may be a genuine finding.
   */
  reason: "insufficient-data" | "zero-variance" | null;
}

/**
 * Pearson correlation: the strength of a *linear* relationship, in `[-1, 1]`.
 *
 * Computed as the ratio of covariance to the product of standard deviations. Returns
 * `null` with a `reason` rather than `NaN` when the coefficient is undefined:
 *
 * - `insufficient-data` — fewer than two complete pairs.
 * - `zero-variance` — one column is constant, so it cannot covary with anything. This is
 *   a real answer, not a bug: a constant has no relationship to report.
 *
 * Pearson is sensitive to outliers and blind to non-linear relationships. A coefficient of
 * `0` means "no *linear* trend", not "no relationship" — check `spearmanCorrelation` or a
 * scatter plot before concluding independence.
 */
export function pearsonCorrelation(left: readonly unknown[], right: readonly unknown[]): CorrelationResult {
  const pairs = pairedValues(left, right);
  const n = pairs.length;
  if (n < 2) return { r: null, n, reason: "insufficient-data" };

  const meanX = mean(pairs.map((pair) => pair.x));
  const meanY = mean(pairs.map((pair) => pair.y));
  if (meanX === null || meanY === null) return { r: null, n, reason: "insufficient-data" };

  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (const pair of pairs) {
    const dx = pair.x - meanX;
    const dy = pair.y - meanY;
    sumXY += dx * dy;
    sumXX += dx * dx;
    sumYY += dy * dy;
  }

  if (sumXX === 0 || sumYY === 0) return { r: null, n, reason: "zero-variance" };

  // Clamp to [-1, 1]: floating point can overshoot by an ulp and report 1.0000000000000002.
  const r = sumXY / Math.sqrt(sumXX * sumYY);
  return { r: Math.max(-1, Math.min(1, r)), n, reason: null };
}

/**
 * Average ranks, with ties sharing the mean of the ranks they span.
 *
 * This is what makes Spearman correct in the presence of ties. Assigning tied values
 * arbitrary distinct ranks would invent an ordering the data does not have and bias the
 * coefficient toward whichever order the sort happened to produce.
 */
function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let position = 0;
  while (position < indexed.length) {
    let end = position;
    while (end + 1 < indexed.length && indexed[end + 1]!.value === indexed[position]!.value) end += 1;
    // Ranks are 1-based; a run from `position` to `end` spans those rank numbers.
    const shared = (position + 1 + (end + 1)) / 2;
    for (let cursor = position; cursor <= end; cursor += 1) {
      ranks[indexed[cursor]!.index] = shared;
    }
    position = end + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation: the Pearson correlation of the *ranks*.
 *
 * Measures any monotonic relationship, not just a linear one, and is robust to outliers
 * because only order matters. `x` and `y` with `r = 1` means "as one rises, the other
 * never falls", whatever the shape of the curve.
 *
 * Ties are handled by average ranks, so a column with many repeated values still produces
 * a defensible coefficient. The same `null` reasons as `pearsonCorrelation` apply; a
 * constant column has a single distinct rank and therefore zero rank variance.
 */
export function spearmanCorrelation(left: readonly unknown[], right: readonly unknown[]): CorrelationResult {
  const pairs = pairedValues(left, right);
  const n = pairs.length;
  if (n < 2) return { r: null, n, reason: "insufficient-data" };

  const rankX = averageRanks(pairs.map((pair) => pair.x));
  const rankY = averageRanks(pairs.map((pair) => pair.y));
  return pearsonCorrelation(rankX, rankY);
}

/** One cell of a correlation matrix. */
export interface CorrelationCell {
  /** Row column name. */
  x: string;
  /** Column column name. */
  y: string;
  /** The coefficient, or `null` when undefined. */
  r: number | null;
  /** Complete pairs behind the coefficient. */
  n: number;
  /** Why `r` is `null`, if it is. */
  reason: CorrelationResult["reason"];
}

/** A square, symmetric correlation matrix over named columns. */
export interface CorrelationMatrix {
  /** Column names, in the order given. */
  columns: readonly string[];
  /** Pearson coefficients, `matrix[i][j]` for `columns[i]` against `columns[j]`. */
  matrix: readonly (readonly (number | null)[])[];
  /** Every off-diagonal cell with its `n` and reason, for auditing. */
  cells: readonly CorrelationCell[];
  /** Which coefficient was computed. */
  method: "pearson" | "spearman";
  /** Look up one coefficient by column name. */
  get(x: string, y: string): CorrelationCell;
}

/** Input for `correlationMatrix`. */
export interface CorrelationInput {
  /** Column name to its values, in the order the matrix should present them. */
  columns: readonly { name: string; values: readonly unknown[] }[];
  /** Coefficient to compute. Defaults to `pearson`. */
  method?: "pearson" | "spearman";
}

/**
 * Correlation matrix across several columns.
 *
 * The diagonal is `1` for a column against itself — including a constant column, where
 * the off-diagonal entries are `null`. Reporting `1` on the diagonal is the identity a
 * correlation matrix is defined to have, not a claim that the column varies.
 */
export function correlationMatrix(input: CorrelationInput): CorrelationMatrix {
  const method = input.method ?? "pearson";
  if (method !== "pearson" && method !== "spearman") {
    throw new ValidationError(
      `correlationMatrix method must be "pearson" or "spearman", received "${String(method)}".`,
    );
  }
  const names = input.columns.map((column) => column.name);
  if (names.length === 0) throw new ValidationError("correlationMatrix needs at least one column.");

  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new ValidationError(`correlationMatrix received duplicate column "${name}".`);
    seen.add(name);
  }

  const compute = method === "pearson" ? pearsonCorrelation : spearmanCorrelation;
  const cells: CorrelationCell[] = [];
  const matrix: (number | null)[][] = names.map(() => new Array<number | null>(names.length).fill(null));

  for (let row = 0; row < names.length; row += 1) {
    for (let column = 0; column < names.length; column += 1) {
      if (row === column) {
        matrix[row]![column] = 1;
        continue;
      }
      // Only the upper triangle is computed; the matrix is symmetric by construction, and
      // computing both halves would double the work for an identical answer.
      if (column < row) {
        matrix[row]![column] = matrix[column]![row] ?? null;
        continue;
      }
      const result = compute(input.columns[row]!.values, input.columns[column]!.values);
      matrix[row]![column] = result.r;
      cells.push({ x: names[row]!, y: names[column]!, r: result.r, n: result.n, reason: result.reason });
    }
  }

  return {
    columns: [...names],
    matrix: matrix.map((row) => [...row]),
    cells,
    method,
    get(x: string, y: string): CorrelationCell {
      const rowIndex = names.indexOf(x);
      const columnIndex = names.indexOf(y);
      if (rowIndex === -1) throw new ColumnNotFoundError(x, names);
      if (columnIndex === -1) throw new ColumnNotFoundError(y, names);
      const r = matrix[rowIndex]![columnIndex] ?? null;
      if (rowIndex === columnIndex) return { x, y, r, n: input.columns[rowIndex]!.values.length, reason: null };
      const found = cells.find((cell) => (cell.x === x && cell.y === y) || (cell.x === y && cell.y === x));
      return found ?? { x, y, r, n: 0, reason: "insufficient-data" };
    },
  };
}

// ------------------------------------------------------------------ z-scores

/** A z-score per input position, with `null` where the value was missing. */
export interface ZScoreResult {
  /** Standardized values, aligned to the input array. */
  values: (number | null)[];
  /** Mean used for centring, or `null` when no values were present. */
  mean: number | null;
  /** Standard deviation used for scaling, or `null` when undefined. */
  std: number | null;
  /** Why every score is `null`, if they are. */
  reason: "insufficient-data" | "zero-variance" | null;
}

/**
 * Z-scores: how many standard deviations each value sits from the mean.
 *
 * Uses the sample standard deviation by default (`ddof` of 1), matching `describe()`.
 * Returns `null` scores with `reason: "zero-variance"` when the column is constant: every
 * value would divide by zero, and there is no meaningful "distance from the mean" when
 * there is no spread.
 *
 * Missing cells map to `null` in the output rather than being dropped, so the result stays
 * aligned with the source rows and can be added back as a column.
 */
export function zScores(values: readonly unknown[], options: AdvancedOptions = {}): ZScoreResult {
  const ddof = options.ddof ?? 1;
  assertDdof(ddof);

  const numbers = finiteNumbers(values);
  const average = mean(numbers);
  const spread = stdOf(numbers, ddof);

  if (average === null || spread === null) {
    return { values: values.map(() => null), mean: average, std: spread, reason: "insufficient-data" };
  }
  if (spread === 0) {
    return { values: values.map(() => null), mean: average, std: spread, reason: "zero-variance" };
  }

  return {
    values: values.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? (value - average) / spread : null,
    ),
    mean: average,
    std: spread,
    reason: null,
  };
}

/** `std` with an explicit ddof, kept local so the public `std` keeps its single argument. */
function stdOf(values: readonly number[], ddof: number): number | null {
  const spread = variance(values, { ddof });
  return spread === null ? null : Math.sqrt(spread);
}

// -------------------------------------------------------- percentile rank

/**
 * Percentile rank of `value` within `values`, in `[0, 100]`.
 *
 * The definition used is "percentage of values at or below this one", which is what
 * "scored in the 90th percentile" means in ordinary language. Ties therefore share the
 * highest rank they reach: in `[1, 2, 2, 3]` the value `2` is at the 75th percentile, not
 * the 50th.
 *
 * Returns `null` for no values, or when `value` is not a finite number.
 *
 * Note this is the inverse question to `percentile`: `percentile` asks "what value sits at
 * the 90th percentile", this asks "what percentile is this value at".
 */
export function percentileRank(values: readonly unknown[], value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const numbers = finiteNumbers(values);
  if (numbers.length === 0) return null;

  let atOrBelow = 0;
  for (const candidate of numbers) if (candidate <= value) atOrBelow += 1;
  return (atOrBelow / numbers.length) * 100;
}

// ------------------------------------------------------------- shape

/**
 * Skewness: asymmetry of a distribution.
 *
 * `0` is symmetric, positive has a longer right tail, negative a longer left tail. Uses
 * the adjusted Fisher-Pearson standardized moment coefficient, the same definition as
 * `pandas.Series.skew` and R's `e1071::skewness(type = 2)`:
 *
 * ```
 * G1 = n / ((n - 1)(n - 2)) * Σ((x - mean) / s)³
 * ```
 *
 * Returns `null` for fewer than three values, or for zero variance — both make the
 * coefficient undefined rather than merely unstable.
 */
export function skewness(values: readonly unknown[]): number | null {
  const numbers = finiteNumbers(values);
  const n = numbers.length;
  if (n < 3) return null;

  const average = mean(numbers);
  const spread = stdOf(numbers, 1);
  if (average === null || spread === null || spread === 0) return null;

  let cubed = 0;
  for (const value of numbers) {
    const standardized = (value - average) / spread;
    cubed += standardized * standardized * standardized;
  }
  return (n / ((n - 1) * (n - 2))) * cubed;
}

/**
 * Excess kurtosis: how heavy the tails are relative to a normal distribution.
 *
 * The normal distribution has excess kurtosis `0`, so this is reported *excess* rather
 * than the raw moment — reporting `3` for a normal distribution invites the reader to
 * think something is unusual. Positive means heavier tails than normal, negative lighter.
 *
 * Uses the sample excess kurtosis with the standard correction, matching
 * `pandas.Series.kurt`:
 *
 * ```
 * G2 = n(n+1)/((n-1)(n-2)(n-3)) * Σ((x - mean)/s)⁴ - 3(n-1)²/((n-2)(n-3))
 * ```
 *
 * Returns `null` for fewer than four values or zero variance. Four is the honest floor:
 * the correction term's denominator contains `n - 3`.
 */
export function kurtosis(values: readonly unknown[]): number | null {
  const numbers = finiteNumbers(values);
  const n = numbers.length;
  if (n < 4) return null;

  const average = mean(numbers);
  const spread = stdOf(numbers, 1);
  if (average === null || spread === null || spread === 0) return null;

  let fourth = 0;
  for (const value of numbers) {
    const standardized = (value - average) / spread;
    fourth += standardized * standardized * standardized * standardized;
  }
  const correction = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return (n * (n + 1) * fourth) / ((n - 1) * (n - 2) * (n - 3)) - correction;
}

/** The five-number summary plus the mean, which Tukey's summary omits. */
export interface FiveNumberSummary {
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  /** Included because the summary is usually read alongside the mean. */
  mean: number | null;
  /** Present-value count behind the summary. */
  count: number;
}

/**
 * Tukey's five-number summary: minimum, Q1, median, Q3, maximum.
 *
 * Quartiles use the same type 7 interpolation as `quartiles()`, so this agrees with
 * `describe()` to the last bit rather than introducing a second convention.
 *
 * `mean` is included because a five-number summary alone hides skew: comparing `median`
 * with `mean` is the cheapest way to see it.
 */
export function fiveNumberSummary(values: readonly unknown[]): FiveNumberSummary {
  const numbers = finiteNumbers(values);
  const parts = quartiles(numbers);
  return {
    min: numbers.length === 0 ? null : Math.min(...numbers),
    q1: parts === null ? null : parts.q1,
    median: parts === null ? null : parts.q2,
    q3: parts === null ? null : parts.q3,
    max: numbers.length === 0 ? null : Math.max(...numbers),
    mean: mean(numbers),
    count: numbers.length,
  };
}

// ------------------------------------------------------------- outliers

/** How an outlier test decided what counts as an outlier. */
export type OutlierMethod = "iqr" | "zscore" | "modified-zscore";

/** Options for outlier detection. */
export interface OutlierOptions {
  /** `iqr` (default) uses Tukey's fences; `zscore` uses a standard-deviation threshold. */
  method?: OutlierMethod;
  /**
   * For `iqr`, the multiplier applied to the IQR beyond the quartiles. Default `1.5`
   * marks "outliers" and `3` marks "extreme outliers" in Tukey's convention.
   *
   * For `zscore`, the absolute z-score above which a point is an outlier. Default `3`.
   */
  threshold?: number;
}

/** One detected outlier. */
export interface Outlier {
  /** Position in the input array, so a caller can map back to the source row. */
  index: number;
  /** The offending value. */
  value: number;
  /** Its z-score, when the method is `zscore`. */
  zScore: number | null;
  /** Which fence it crossed, for `iqr`. */
  side: "low" | "high";
}

/** Result of an outlier scan. */
export interface OutlierResult {
  method: OutlierMethod;
  threshold: number;
  outliers: Outlier[];
  /** Fences used, present for `iqr`. */
  fences: { lower: number; upper: number } | null;
  /** Values the test could actually be applied to. */
  considered: number;
  /** Why no outliers could be computed, if that is the case. */
  reason: "insufficient-data" | "zero-variance" | null;
}

/**
 * Detect outliers, either by Tukey's fences or by z-score threshold.
 *
 * **IQR (default).** Points below `Q1 - k·IQR` or above `Q3 + k·IQR` with `k = 1.5`. This
 * makes no assumption about the distribution and is the safer default: it will not flag
 * the tail of a genuinely skewed distribution as aggressively as a z-score threshold does.
 *
 * **Z-score.** Points whose absolute z-score exceeds the threshold (default 3). Assumes
 * roughly normal data; on a skewed distribution it flags the long tail, which is often a
 * real feature rather than an error. Use it when you specifically want a mean-and-spread
 * notion of unusual.
 *
 * **Modified z-score.** The median absolute deviation form, `0.6745·(x - median) / MAD`,
 * with the threshold applied to that score (default 3.5). It replaces the mean and standard
 * deviation with the median and MAD, both of which a single extreme value cannot move.
 * That is the point: a plain z-score is computed *from* the outliers it is trying to find,
 * so one very large value inflates the standard deviation and hides itself. The modified
 * score is the recommended default when outliers are suspected but not yet located.
 *
 * An outlier is not an error. It is a value that is unusual relative to the rest, and the
 * correct response is usually to look at it, not to delete it.
 */
export function detectOutliers(values: readonly unknown[], options: OutlierOptions = {}): OutlierResult {
  const method = options.method ?? "iqr";
  if (method !== "iqr" && method !== "zscore" && method !== "modified-zscore") {
    throw new ValidationError(
      `detectOutliers method must be "iqr", "zscore", or "modified-zscore", received "${String(method)}".`,
    );
  }
  const threshold = options.threshold ?? (method === "iqr" ? 1.5 : method === "zscore" ? 3 : 3.5);
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
    throw new RangeError("detectOutliers threshold must be a positive finite number.");
  }

  const numbers = finiteNumbers(values);
  const base: OutlierResult = {
    method,
    threshold,
    outliers: [],
    fences: null,
    considered: numbers.length,
    reason: null,
  };

  if (numbers.length === 0) return { ...base, reason: "insufficient-data" };

  if (method === "iqr") {
    const parts = quartiles(numbers);
    if (parts === null) return { ...base, reason: "insufficient-data" };
    const spread = parts.q3 - parts.q1;
    // A zero IQR means at least half the values are identical; the fences collapse onto
    // the quartiles and every deviation from them would be flagged. Refusing is honest.
    if (spread === 0) return { ...base, reason: "zero-variance" };

    const lower = parts.q1 - threshold * spread;
    const upper = parts.q3 + threshold * spread;
    const outliers: Outlier[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < lower) outliers.push({ index, value, zScore: null, side: "low" });
      else if (value > upper) outliers.push({ index, value, zScore: null, side: "high" });
    }
    return { ...base, outliers, fences: { lower, upper } };
  }

  if (method === "modified-zscore") {
    const sorted = sortedColumn(numbers);
    const centre = medianOfSorted(sorted);
    if (centre === null) return { ...base, reason: "insufficient-data" };
    const deviations = sortedColumn(numbers.map((value) => Math.abs(value - centre)));
    const mad = medianOfSorted(deviations);
    // A zero MAD means over half the values equal the median; every deviation would be
    // infinitely unusual, so there is no meaningful scale to measure against.
    if (mad === null || mad === 0) return { ...base, reason: "zero-variance" };

    const modified: Outlier[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const score = (0.6745 * (value - centre)) / mad;
      if (Math.abs(score) > threshold) {
        modified.push({ index, value, zScore: score, side: score < 0 ? "low" : "high" });
      }
    }
    return { ...base, outliers: modified };
  }

  const scores = zScores(numbers, { ddof: 1 });
  if (scores.reason !== null) return { ...base, reason: scores.reason };

  const outliers: Outlier[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const score = scores.values[index];
    if (score === null || score === undefined) continue;
    if (Math.abs(score) > threshold) {
      outliers.push({
        index,
        value: values[index] as number,
        zScore: score,
        side: score < 0 ? "low" : "high",
      });
    }
  }
  return { ...base, outliers };
}

// ------------------------------------------- normalization / standardization

/**
 * Standardize: subtract the mean, divide by the standard deviation.
 *
 * The result has mean `0` and standard deviation `1` (subject to rounding), which is what
 * makes variables measured in different units comparable in a model. This is `zScores`
 * under its other name; the alias exists because both terms are in common use and a
 * reader looking for "standardize" should find it.
 *
 * Returns the standardized values only, aligned to the input, with `null` where a value was
 * missing or the transformation was undefined. Use `zScores` when the mean and standard
 * deviation are also wanted.
 */
export function standardize(values: readonly unknown[], options: AdvancedOptions = {}): (number | null)[] {
  return zScores(values, options).values;
}

/** Range-normalization strategy. */
export type NormalizationMethod = "minmax" | "maxabs";

/** Options for `normalize`. */
export interface NormalizeOptions {
  /**
   * `minmax` (default) maps the observed range onto `[0, 1]`.
   * `maxabs` divides by the largest absolute value, preserving sign in `[-1, 1]` and
   * leaving zero at zero — useful when the data is already centred.
   */
  method?: NormalizationMethod;
  /** Lower bound of the target range for `minmax`. Default `0`. */
  min?: number;
  /** Upper bound of the target range for `minmax`. Default `1`. */
  max?: number;
}

/**
 * Scale values into a bounded range.
 *
 * **minmax** maps the observed minimum to `min` and maximum to `max` (default `[0, 1]`).
 * **maxabs** divides by the largest absolute value, keeping sign.
 *
 * Both are sensitive to a single extreme value — one outlier compresses everything else
 * toward one end of the range. That is a property of the transformation, not a defect, but
 * it is the reason `standardize` is often the better choice.
 *
 * Returns `null` for every value when the scale is undefined: no values, a constant column
 * (nothing to stretch), or an all-zero column under `maxabs`.
 */
export function normalize(values: readonly unknown[], options: NormalizeOptions = {}): (number | null)[] {
  const method = options.method ?? "minmax";
  if (method !== "minmax" && method !== "maxabs") {
    throw new ValidationError(`normalize method must be "minmax" or "maxabs", received "${String(method)}".`);
  }
  const lower = options.min ?? 0;
  const upper = options.max ?? 1;
  if (method === "minmax") {
    if (typeof lower !== "number" || typeof upper !== "number" || !Number.isFinite(lower) || !Number.isFinite(upper)) {
      throw new RangeError("normalize min and max must be finite numbers.");
    }
    if (upper === lower) throw new RangeError("normalize min and max must differ.");
  }

  const numbers = finiteNumbers(values);
  if (numbers.length === 0) return values.map(() => null);

  if (method === "maxabs") {
    let largest = 0;
    for (const value of numbers) largest = Math.max(largest, Math.abs(value));
    if (largest === 0) return values.map(() => null);
    return values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value / largest : null));
  }

  const minimum = Math.min(...numbers);
  const maximum = Math.max(...numbers);
  // A constant column has no range to stretch; mapping it to the lower bound would claim
  // a position within a range that does not exist.
  if (maximum === minimum) return values.map(() => null);

  return values.map((value) =>
    typeof value === "number" && Number.isFinite(value)
      ? lower + ((value - minimum) / (maximum - minimum)) * (upper - lower)
      : null,
  );
}
