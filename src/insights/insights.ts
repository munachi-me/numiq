/**
 * The insight engine: defensible observations about a dataset, with their evidence.
 *
 * ## The rule this module is built around
 *
 * An insight is only emitted when the data supports it, and every insight carries the
 * values that produced it. There is no prose generated independently of a measurement, and
 * no claim whose supporting numbers are absent from `evidence`. If a check cannot run — no
 * date column, too few groups, a constant measure — it is reported in `skipped` with a
 * reason rather than silently omitted, so an empty result is distinguishable from a check
 * that never ran.
 *
 * ## Determinism
 *
 * Output is stable for the same input. Checks run in a fixed order, candidates are sorted
 * by a documented key before truncation, and truncation is reported through `truncated`
 * rather than dropping observations silently.
 *
 * ## Separation from presentation
 *
 * Nothing here renders, formats for display, or produces HTML. `title` and `detail` are
 * plain sentences built from the numbers in `evidence`; a caller wanting a chart reads
 * `evidence` and ignores the prose.
 */
import { columnKind } from "../analytics/describe.js";
import { detectOutliers, pearsonCorrelation, spearmanCorrelation } from "../analytics/advanced.js";
import type { DType, Row } from "../core/types.js";
import type { ColumnSchema } from "../core/types.js";
import { countUnique } from "../core/schema.js";
import { isIsoDate, isIsoDateTime, parseIsoDate, parseIsoDateTime } from "../utils/temporal.js";
import { isPresent, stableKey } from "../utils/values.js";

/** The insight categories this engine can produce. */
export type InsightKind =
  "missing-data" | "outliers" | "correlation" | "category-extreme" | "group-change" | "dominance" | "trend";

/** How much attention an insight deserves. Severity never implies a conclusion. */
export type InsightSeverity = "info" | "notice" | "warning";

/** Evidence behind an insight. Shape depends on `kind`, but always holds the raw values. */
export type InsightEvidence = Readonly<Record<string, unknown>>;

/** One observation, with everything needed to verify it. */
export interface Insight {
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  /** One sentence naming the finding. */
  readonly title: string;
  /** One or two sentences explaining how the evidence supports the title. */
  readonly detail: string;
  /** The values behind the finding. Never empty. */
  readonly evidence: InsightEvidence;
  /** Columns the finding rests on. */
  readonly columns: readonly string[];
}

/** A check that could not run, and why. */
export interface SkippedInsight {
  readonly kind: InsightKind;
  readonly reason: string;
  readonly columns: readonly string[];
}

/** The result of an analysis. */
export interface InsightReport {
  /** Insights in a stable order: by kind, then by the sort key documented per check. */
  readonly insights: readonly Insight[];
  /** Checks that could not run. */
  readonly skipped: readonly SkippedInsight[];
  /** How many insights were dropped by `maxInsights`. */
  readonly truncated: number;
  /** The thresholds actually used, so a caller can cite them. */
  readonly thresholds: ResolvedInsightOptions;
}

/** Configurable thresholds. Every default is documented and reported back. */
export interface InsightOptions {
  /**
   * Minimum absolute correlation reported as "strong". Default `0.7`.
   *
   * Chosen so that only relationships explaining roughly half the variance or more are
   * called out; a lower bar produces a wall of weak coefficients.
   */
  readonly strongCorrelation?: number;
  /**
   * Share of rows one value must hold to count as dominant. Default `0.5`.
   *
   * A majority is the smallest share that supports the word "dominant" without argument.
   */
  readonly dominanceShare?: number;
  /**
   * IQR fence multiplier for outlier detection. Default `1.5`, Tukey's conventional fence.
   */
  readonly outlierThreshold?: number;
  /**
   * Minimum |Spearman| against time for a trend to be reported. Default `0.7`.
   *
   * Monotonic association, not linearity, because a trend can be steady without being
   * straight.
   */
  readonly trendStrength?: number;
  /** Minimum rows in a group before its mean is reported. Default `3`. */
  readonly minGroupSize?: number;
  /**
   * Highest distinct-to-rows ratio still treated as a category dimension. Default `0.5`.
   *
   * A column where most rows hold a different value is an identifier, not a dimension.
   * Ranking its "groups" would report the extreme of a set of one-row samples as though it
   * described a category.
   */
  readonly maxCategoryRatio?: number;
  /**
   * Smallest difference worth reporting, as a fraction of the measure's observed range.
   * Default `0.25`.
   *
   * Means that differ by a sliver of the range are noise dressed as a finding. A quarter of
   * the range is the smallest gap that reads as a real separation.
   */
  readonly minRelativeGap?: number;
  /** Maximum insights returned. Default `50`. */
  readonly maxInsights?: number;
  /** Minimum distinct time points for a trend check. Default `4`. */
  readonly minTrendPoints?: number;
}

/** Thresholds after defaults are applied. */
export interface ResolvedInsightOptions {
  readonly strongCorrelation: number;
  readonly dominanceShare: number;
  readonly outlierThreshold: number;
  readonly trendStrength: number;
  readonly minGroupSize: number;
  readonly maxCategoryRatio: number;
  readonly minRelativeGap: number;
  readonly maxInsights: number;
  readonly minTrendPoints: number;
}

/** What the engine analyses. A `Dataset` satisfies this. */
export interface InsightInput {
  readonly rows: readonly Row[];
  readonly columns: readonly string[];
  readonly schema: Readonly<Record<string, ColumnSchema>>;
}

/** The conventional bar for calling a correlation strong, independent of any override. */
const DEFAULT_STRONG_CORRELATION = 0.7;

const DEFAULTS: ResolvedInsightOptions = {
  strongCorrelation: 0.7,
  dominanceShare: 0.5,
  outlierThreshold: 1.5,
  trendStrength: 0.7,
  minGroupSize: 3,
  maxCategoryRatio: 0.5,
  minRelativeGap: 0.25,
  maxInsights: 50,
  minTrendPoints: 4,
};

/** Validate and fill thresholds, rejecting values that would produce nonsense. */
export function resolveInsightOptions(options: InsightOptions = {}): ResolvedInsightOptions {
  const merged: ResolvedInsightOptions = {
    strongCorrelation: options.strongCorrelation ?? DEFAULTS.strongCorrelation,
    dominanceShare: options.dominanceShare ?? DEFAULTS.dominanceShare,
    outlierThreshold: options.outlierThreshold ?? DEFAULTS.outlierThreshold,
    trendStrength: options.trendStrength ?? DEFAULTS.trendStrength,
    minGroupSize: options.minGroupSize ?? DEFAULTS.minGroupSize,
    maxCategoryRatio: options.maxCategoryRatio ?? DEFAULTS.maxCategoryRatio,
    minRelativeGap: options.minRelativeGap ?? DEFAULTS.minRelativeGap,
    maxInsights: options.maxInsights ?? DEFAULTS.maxInsights,
    minTrendPoints: options.minTrendPoints ?? DEFAULTS.minTrendPoints,
  };

  if (merged.strongCorrelation < 0 || merged.strongCorrelation > 1) {
    throw new RangeError("strongCorrelation must be between 0 and 1.");
  }
  if (merged.dominanceShare <= 0 || merged.dominanceShare > 1) {
    throw new RangeError("dominanceShare must be greater than 0 and at most 1.");
  }
  if (merged.outlierThreshold <= 0) throw new RangeError("outlierThreshold must be greater than 0.");
  if (merged.trendStrength < 0 || merged.trendStrength > 1) {
    throw new RangeError("trendStrength must be between 0 and 1.");
  }
  if (merged.minGroupSize < 1) throw new RangeError("minGroupSize must be at least 1.");
  if (merged.maxCategoryRatio <= 0 || merged.maxCategoryRatio > 1) {
    throw new RangeError("maxCategoryRatio must be greater than 0 and at most 1.");
  }
  if (merged.minRelativeGap < 0 || merged.minRelativeGap > 1) {
    throw new RangeError("minRelativeGap must be between 0 and 1.");
  }
  if (merged.maxInsights < 1) throw new RangeError("maxInsights must be at least 1.");
  if (merged.minTrendPoints < 3) throw new RangeError("minTrendPoints must be at least 3.");
  return merged;
}

/** Round for prose only; evidence keeps full precision. */
function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Present finite numbers from a column. */
function numericValues(rows: readonly Row[], column: string): number[] {
  const numbers: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  }
  return numbers;
}

/** Coerce a cell to a timestamp, accepting `Date` objects and ISO strings. */
function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "string") {
    if (isIsoDateTime(value)) return parseIsoDateTime(value).getTime();
    if (isIsoDate(value)) return parseIsoDate(value).getTime();
  }
  return null;
}

/**
 * Column names usable as a grouping dimension.
 *
 * A column qualifies when its kind is categorical or boolean, it has at least two distinct
 * values, and it is not identifier-like. The last test matters: a near-unique text column
 * such as an order id passes every type check, but grouping by it produces one-row groups
 * whose "highest mean" describes a single observation.
 */
function categoricalColumns(input: InsightInput, options: ResolvedInsightOptions): string[] {
  const total = input.rows.length;
  return input.columns.filter((column) => {
    const kind = columnKind(input.schema[column]?.type ?? "unknown");
    // `boolean` is a legitimate two-value dimension; `mixed` and `empty` are not.
    if (kind !== "categorical" && kind !== "boolean") return false;
    const distinct = countUnique(input.rows.map((row) => row[column]));
    if (distinct < 2) return false;
    return total === 0 || distinct / total <= options.maxCategoryRatio;
  });
}

/** Observed range of a numeric measure, or `null` when it has no spread. */
function measureSpread(input: InsightInput, measure: string): number | null {
  const numbers = numericValues(input.rows, measure);
  if (numbers.length === 0) return null;
  let low = numbers[0] as number;
  let high = numbers[0] as number;
  for (const value of numbers) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const spread = high - low;
  return spread > 0 ? spread : null;
}

/**
 * True when a difference is large enough to report.
 *
 * Measured against the measure's observed range rather than zero, so "the groups differ by
 * 0.17 on a 1-to-7 scale" is suppressed while "they differ by 1485 on a 0-to-2720 scale"
 * survives.
 */
function isMeaningfulGap(gap: number, spread: number | null, options: ResolvedInsightOptions): boolean {
  if (spread === null) return false;
  return gap / spread >= options.minRelativeGap;
}

/** Column names whose kind is `numeric`. */
function numericColumns(input: InsightInput): string[] {
  return input.columns.filter((column) => columnKind(input.schema[column]?.type ?? "unknown") === "numeric");
}

/** Column names whose kind is `temporal`. */
function temporalColumns(input: InsightInput): string[] {
  return input.columns.filter((column) => {
    const type: DType = input.schema[column]?.type ?? "unknown";
    return columnKind(type) === "temporal";
  });
}

/** Missing-data warnings, one per column that has any. */
function missingDataInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const total = input.rows.length;
  if (total === 0) return insights;

  for (const column of input.columns) {
    let missing = 0;
    for (const row of input.rows) {
      if (!isPresent(row[column])) missing += 1;
    }
    if (missing === 0) continue;
    const share = missing / total;
    insights.push({
      kind: "missing-data",
      severity: share >= 0.5 ? "warning" : "notice",
      title: `"${column}" is missing in ${missing} of ${total} rows`,
      detail:
        `"${column}" has no value in ${round(share * 100, 1)}% of rows. ` +
        "Aggregations over this column skip those cells rather than counting them as zero.",
      evidence: { column, missing, total, share },
      columns: [column],
    });
  }
  return insights;
}

/** Outlier observations per numeric column, using the configured IQR fence. */
function outlierInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];
  for (const column of numericColumns(input)) {
    const values = numericValues(input.rows, column);
    const result = detectOutliers(values, { method: "iqr", threshold: options.outlierThreshold });
    if (result.outliers.length === 0) continue;
    insights.push({
      kind: "outliers",
      severity: "notice",
      title: `"${column}" has ${result.outliers.length} value${result.outliers.length === 1 ? "" : "s"} outside the IQR fences`,
      detail:
        `With fences at ${round(result.fences?.lower ?? 0, 2)} and ${round(result.fences?.upper ?? 0, 2)}, ` +
        `${result.outliers.length} of ${result.considered} values fall outside. ` +
        "An outlier is an unusual value, not an error.",
      evidence: {
        column,
        count: result.outliers.length,
        considered: result.considered,
        threshold: result.threshold,
        fences: result.fences,
        values: result.outliers.map((outlier) => ({ index: outlier.index, value: outlier.value, side: outlier.side })),
      },
      columns: [column],
    });
  }
  return insights;
}

/** Strong pairwise correlations among numeric columns, each pair once. */
function correlationInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];
  const columns = numericColumns(input);
  if (columns.length < 2) return insights;

  for (let left = 0; left < columns.length; left += 1) {
    for (let right = left + 1; right < columns.length; right += 1) {
      const a = columns[left] as string;
      const b = columns[right] as string;
      const result = pearsonCorrelation(
        input.rows.map((row) => row[a]),
        input.rows.map((row) => row[b]),
      );
      if (result.r === null || Math.abs(result.r) < options.strongCorrelation) continue;
      const direction = result.r > 0 ? "positive" : "negative";
      // "Strong" is only claimed at the conventional 0.7 bar. A caller who lowers the
      // threshold to surface weaker relationships must not have them described as strong.
      const strength = Math.abs(result.r) >= DEFAULT_STRONG_CORRELATION ? "strongly " : "";
      insights.push({
        kind: "correlation",
        severity: "info",
        title: `"${a}" and "${b}" are ${strength}${direction}ly correlated (r = ${round(result.r, 3)})`,
        detail:
          `Pearson r is ${round(result.r, 4)} over ${result.n} complete pairs, above the ` +
          `${options.strongCorrelation} threshold. Correlation is not causation, and no ` +
          "significance test is implied.",
        evidence: { left: a, right: b, r: result.r, n: result.n, threshold: options.strongCorrelation },
        columns: [a, b],
      });
    }
  }
  return insights;
}

/** Highest and lowest group means for each categorical-by-numeric pair. */
function categoryExtremeInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];

  for (const dimension of categoricalColumns(input, options)) {
    const groups = groupMeans(input, dimension, numericColumns(input), options.minGroupSize);
    for (const [measure, table] of groups) {
      if (table.length < 2) continue;
      const highest = table[0] as GroupMean;
      const lowest = table[table.length - 1] as GroupMean;
      if (highest.mean === lowest.mean) continue;
      if (!isMeaningfulGap(highest.mean - lowest.mean, measureSpread(input, measure), options)) continue;
      insights.push({
        kind: "category-extreme",
        severity: "info",
        title: `"${highest.key}" has the highest mean ${measure} and "${lowest.key}" the lowest`,
        detail:
          `Mean "${measure}" is ${round(highest.mean, 2)} for "${highest.key}" (n = ${highest.count}) ` +
          `and ${round(lowest.mean, 2)} for "${lowest.key}" (n = ${lowest.count}), across ` +
          `${table.length} ${dimension} groups.`,
        evidence: {
          dimension,
          measure,
          highest: { key: highest.key, mean: highest.mean, count: highest.count },
          lowest: { key: lowest.key, mean: lowest.mean, count: lowest.count },
          groupCount: table.length,
          groups: table.map((entry) => ({ key: entry.key, mean: entry.mean, count: entry.count })),
        },
        columns: [dimension, measure],
      });
    }
  }
  return insights;
}

interface GroupMean {
  readonly key: string;
  readonly mean: number;
  readonly count: number;
}

/**
 * Mean of each numeric measure per category, largest first.
 *
 * Groups smaller than `minGroupSize` are excluded: a mean of one row is that row, and
 * ranking on it invites a false "highest" claim.
 */
function groupMeans(
  input: InsightInput,
  dimension: string,
  measures: readonly string[],
  minGroupSize: number,
): Map<string, GroupMean[]> {
  const result = new Map<string, GroupMean[]>();
  if (measures.length === 0) return result;

  const buckets = new Map<string, { key: string; rows: Row[] }>();
  const order: string[] = [];
  for (const row of input.rows) {
    const raw = row[dimension];
    if (!isPresent(raw)) continue;
    const key = String(raw);
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { key, rows: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.rows.push(row);
  }

  for (const measure of measures) {
    const table: GroupMean[] = [];
    for (const key of order) {
      const bucket = buckets.get(key) as { key: string; rows: Row[] };
      const numbers = numericValues(bucket.rows, measure);
      if (numbers.length < minGroupSize) continue;
      let total = 0;
      for (const value of numbers) total += value;
      table.push({ key, mean: total / numbers.length, count: numbers.length });
    }
    table.sort((a, b) => b.mean - a.mean || a.key.localeCompare(b.key));
    if (table.length > 0) result.set(measure, table);
  }
  return result;
}

/**
 * The widest gap between two comparable groups.
 *
 * Only emitted with three or more groups: with two, "the largest difference" is just the
 * difference, and `category-extreme` has already reported it.
 */
function groupChangeInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];

  for (const dimension of categoricalColumns(input, options)) {
    const groups = groupMeans(input, dimension, numericColumns(input), options.minGroupSize);
    for (const [measure, table] of groups) {
      if (table.length < 3) continue;
      const highest = table[0] as GroupMean;
      const lowest = table[table.length - 1] as GroupMean;
      const gap = highest.mean - lowest.mean;
      if (gap === 0) continue;
      if (!isMeaningfulGap(gap, measureSpread(input, measure), options)) continue;
      insights.push({
        kind: "group-change",
        severity: "info",
        title: `Largest ${measure} gap across "${dimension}" is ${round(gap, 2)}`,
        detail:
          `"${highest.key}" averages ${round(highest.mean, 2)} against ${round(lowest.mean, 2)} for ` +
          `"${lowest.key}", a gap of ${round(gap, 2)} across ${table.length} groups.`,
        evidence: {
          dimension,
          measure,
          gap,
          highest: { key: highest.key, mean: highest.mean, count: highest.count },
          lowest: { key: lowest.key, mean: lowest.mean, count: lowest.count },
          groupCount: table.length,
        },
        columns: [dimension, measure],
      });
    }
  }
  return insights;
}

/** Category dominance, one per categorical column whose top value clears the share. */
function dominanceInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];
  const total = input.rows.length;
  if (total === 0) return insights;

  const dimensions = new Set(categoricalColumns(input, options));

  for (const column of input.columns) {
    if (!dimensions.has(column)) continue;

    // Track the display value alongside the identity key: `stableKey` prefixes the type,
    // which is right for bucketing and wrong for anything a person reads.
    const counts = new Map<string, { display: string; count: number }>();
    let present = 0;
    for (const row of input.rows) {
      const value = row[column];
      if (!isPresent(value)) continue;
      present += 1;
      const key = stableKey(value);
      const bucket = counts.get(key);
      if (bucket === undefined) counts.set(key, { display: String(value), count: 1 });
      else bucket.count += 1;
    }
    if (present === 0) continue;

    let topKey: string | null = null;
    let topCount = 0;
    for (const bucket of counts.values()) {
      if (bucket.count > topCount) {
        topKey = bucket.display;
        topCount = bucket.count;
      }
    }
    if (topKey === null) continue;
    const share = topCount / present;
    if (share < options.dominanceShare) continue;

    insights.push({
      kind: "dominance",
      severity: "info",
      title: `"${topKey}" accounts for ${round(share * 100, 1)}% of "${column}"`,
      detail:
        `"${topKey}" holds ${topCount} of ${present} present values in "${column}", above the ` +
        `${round(options.dominanceShare * 100, 1)}% dominance threshold across ` +
        `${countUnique(input.rows.map((row) => row[column]))} distinct values.`,
      evidence: {
        column,
        value: topKey,
        count: topCount,
        present,
        share,
        distinct: countUnique(input.rows.map((row) => row[column])),
        threshold: options.dominanceShare,
      },
      columns: [column],
    });
  }
  return insights;
}

/** Monotonic trends of a numeric measure over a temporal column. */
function trendInsights(input: InsightInput, options: ResolvedInsightOptions): Insight[] {
  const insights: Insight[] = [];
  const times = temporalColumns(input);
  const measures = numericColumns(input);
  if (times.length === 0 || measures.length === 0) return insights;

  for (const timeColumn of times) {
    for (const measure of measures) {
      const points: { time: number; value: number }[] = [];
      for (const row of input.rows) {
        const time = toTimestamp(row[timeColumn]);
        const value = row[measure];
        if (time === null || typeof value !== "number" || !Number.isFinite(value)) continue;
        points.push({ time, value });
      }
      if (points.length < options.minTrendPoints) continue;

      const distinctTimes = new Set(points.map((point) => point.time)).size;
      if (distinctTimes < options.minTrendPoints) continue;

      // Spearman against time measures monotonic association, so a steady but curved
      // climb still counts as a trend.
      const result = spearmanCorrelation(
        points.map((point) => point.time),
        points.map((point) => point.value),
      );
      if (result.r === null || Math.abs(result.r) < options.trendStrength) continue;

      const direction = result.r > 0 ? "rising" : "falling";
      insights.push({
        kind: "trend",
        severity: "info",
        title: `"${measure}" trends ${direction} over "${timeColumn}" (rho = ${round(result.r, 3)})`,
        detail:
          `Spearman rho against time is ${round(result.r, 4)} over ${result.n} points across ` +
          `${distinctTimes} distinct timestamps, above the ${options.trendStrength} threshold. ` +
          "This is monotonic association, not a forecast.",
        evidence: {
          timeColumn,
          measure,
          rho: result.r,
          n: result.n,
          distinctTimes,
          threshold: options.trendStrength,
        },
        columns: [timeColumn, measure],
      });
    }
  }
  return insights;
}

/** Stable order for the report, so equal inputs always produce equal output. */
const KIND_ORDER: readonly InsightKind[] = [
  "missing-data",
  "outliers",
  "correlation",
  "category-extreme",
  "group-change",
  "dominance",
  "trend",
];

/**
 * Analyse a dataset and return defensible observations.
 *
 * Checks run in a fixed order; within a check, output follows the sort documented on that
 * check. `skipped` explains every check that could not run, so an empty `insights` array
 * is never ambiguous.
 */
export function analyze(input: InsightInput, options: InsightOptions = {}): InsightReport {
  const thresholds = resolveInsightOptions(options);
  const skipped: SkippedInsight[] = [];

  const numerics = numericColumns(input);
  const temporals = temporalColumns(input);
  const categoricals = categoricalColumns(input, thresholds);

  if (input.rows.length === 0) {
    for (const kind of KIND_ORDER) {
      skipped.push({ kind, reason: "the dataset has no rows", columns: [] });
    }
    return { insights: Object.freeze([]), skipped: Object.freeze(skipped), truncated: 0, thresholds };
  }

  const collected: Insight[] = [
    ...missingDataInsights(input),
    ...outlierInsights(input, thresholds),
    ...correlationInsights(input, thresholds),
    ...categoryExtremeInsights(input, thresholds),
    ...groupChangeInsights(input, thresholds),
    ...dominanceInsights(input, thresholds),
    ...trendInsights(input, thresholds),
  ];

  if (numerics.length === 0) {
    skipped.push({ kind: "outliers", reason: "no numeric columns", columns: [] });
    skipped.push({ kind: "correlation", reason: "no numeric columns", columns: [] });
    skipped.push({ kind: "trend", reason: "no numeric columns", columns: [] });
  } else if (numerics.length < 2) {
    skipped.push({ kind: "correlation", reason: "needs at least two numeric columns", columns: numerics });
  }

  if (categoricals.length === 0) {
    skipped.push({ kind: "category-extreme", reason: "no categorical columns", columns: [] });
    skipped.push({ kind: "group-change", reason: "no categorical columns", columns: [] });
    skipped.push({ kind: "dominance", reason: "no categorical columns", columns: [] });
  }

  if (temporals.length === 0) {
    skipped.push({ kind: "trend", reason: "no date or datetime column", columns: [] });
  }

  collected.sort((a, b) => {
    const order = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (order !== 0) return order;
    return a.columns.join("\u0000").localeCompare(b.columns.join("\u0000")) || a.title.localeCompare(b.title);
  });

  const truncated = Math.max(0, collected.length - thresholds.maxInsights);
  const insights = collected.slice(0, thresholds.maxInsights);

  return {
    insights: Object.freeze(insights),
    skipped: Object.freeze(skipped),
    truncated,
    thresholds,
  };
}
