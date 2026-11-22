/**
 * Column profiling behind `Dataset.describe()`.
 *
 * Two result shapes, one contract:
 *
 * - `describe()` profiles every column and returns a `DatasetDescription`.
 * - `describe(column)` profiles one column and returns a `ColumnProfile`.
 *
 * They are distinct types rather than a union, so a single-column call gives you the
 * profile directly instead of a one-row wrapper you have to unwrap. Neither is a
 * `Dataset`: a profile is an analytical result, not tabular data, and pretending
 * otherwise forces every consumer through a reshape. `toDataset()` is available when a
 * table really is wanted.
 *
 * ## What each statistic means for each column kind
 *
 * | Statistic | numeric | boolean | temporal | text | mixed |
 * | --------- | ------- | ------- | -------- | ---- | ----- |
 * | count, missing, unique | yes | yes | yes | yes | yes |
 * | min, max, mode | yes | yes | yes | yes | yes |
 * | sum, mean, median, quartiles, iqr, variance, std, range | yes | no | no | no | no |
 *
 * "No" means `null`, not `0`. A sum of categories has no meaning, and inventing one is
 * how wrong dashboards get built. Numeric columns are the only kind where arithmetic
 * produces a number with a unit.
 */
import type { DType, Row, TableOptions } from "../core/types.js";
import { ColumnNotFoundError } from "../errors/index.js";
import { renderTable } from "../display/table.js";
import { cloneValue, isPresent } from "../utils/values.js";
import { inferColumnType } from "../core/schema.js";
import { mean, std, sum, variance } from "../core/aggregate.js";
import {
  extremes,
  frequencies,
  medianOfSorted,
  percentileOfSorted,
  quartilesOfSorted,
  range,
  sortedColumn,
} from "./stats.js";

/** Broad column category, which decides what statistics are meaningful. */
export type ColumnKind = "numeric" | "boolean" | "temporal" | "categorical" | "mixed" | "empty";

/** Options accepted by `describe()`. */
export interface DescribeOptions {
  /**
   * Delta degrees of freedom for `variance` and `std`.
   *
   * `1` (default) treats the values as a sample of something larger and divides by
   * `n - 1`; `0` treats them as a full population and divides by `n`. The choice is
   * recorded on every profile as `ddof` so a result is never ambiguous about which
   * formula produced it.
   */
  ddof?: number;
  /** Extra percentiles to compute, in `[0, 100]`. Keys are `p<value>`, e.g. `p90`. */
  percentiles?: readonly number[];
}

/** The statistics computed for one column. */
export interface ColumnProfile {
  /** Column name. */
  readonly name: string;
  /** Type as inferred from the column's present values. */
  readonly type: DType;
  /** Broad category deciding which statistics are meaningful. */
  readonly kind: ColumnKind;
  /** Number of present values. */
  readonly count: number;
  /** Number of missing (`null`/`undefined`) values. */
  readonly missing: number;
  /** Total values considered, present plus missing. */
  readonly total: number;
  /** Number of distinct present values. */
  readonly unique: number;
  /** Sum of present numbers, or `null` when the column is not numeric. */
  readonly sum: number | null;
  /** Arithmetic mean of present numbers, or `null`. */
  readonly mean: number | null;
  /** Median of present numbers, or `null`. */
  readonly median: number | null;
  /** Most frequent present value, or `null` when there are none. */
  readonly mode: unknown;
  /** Smallest present value by the `Dataset.sort` ordering, or `null`. */
  readonly min: unknown;
  /** Largest present value by the `Dataset.sort` ordering, or `null`. */
  readonly max: unknown;
  /** `max - min` for numeric columns, otherwise `null`. */
  readonly range: number | null;
  /** Sample (or population, per `ddof`) variance of present numbers, or `null`. */
  readonly variance: number | null;
  /** Square root of `variance`, or `null`. */
  readonly std: number | null;
  /** First quartile of present numbers, or `null`. */
  readonly q1: number | null;
  /** Third quartile of present numbers, or `null`. */
  readonly q3: number | null;
  /** Interquartile range (`q3 - q1`), or `null`. */
  readonly iqr: number | null;
  /** Requested extra percentiles, keyed `p<value>`. Empty when none were asked for. */
  readonly percentiles: Readonly<Record<string, number | null>>;
  /** Degrees of freedom used for `variance` and `std`. */
  readonly ddof: number;
}

/** Rebuild a dataset from rows; supplied by the owning `Dataset`. */
export type DescriptionBuilder<TDataset> = (rows: readonly Row[], columns: readonly string[]) => TDataset;

/** Statistics shown by `DatasetDescription.table()`, in order. */
const TABLE_STATISTICS = ["count", "missing", "unique", "sum", "mean", "median", "min", "max", "std"] as const;

/** Map a column type to the category that decides which statistics apply. */
export function columnKind(type: DType): ColumnKind {
  switch (type) {
    case "number":
    case "integer":
      return "numeric";
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
    case "time":
      return "temporal";
    case "string":
      return "categorical";
    case "mixed":
      return "mixed";
    default:
      return "empty";
  }
}

/**
 * Validate `describe()` options before any column is profiled.
 *
 * Called by both entry points so bad options fail even when there are no columns to
 * profile — an empty dataset must not be the one input that silently accepts them.
 */
export function validateDescribeOptions(options: DescribeOptions = {}): Required<DescribeOptions> {
  const ddof = options.ddof ?? 1;
  if (typeof ddof !== "number" || !Number.isInteger(ddof) || ddof < 0) {
    throw new RangeError("describe() needs a non-negative integer ddof.");
  }
  const percentiles = options.percentiles ?? [];
  if (!Array.isArray(percentiles)) {
    throw new RangeError("describe() percentiles must be an array of numbers.");
  }
  for (const p of percentiles) {
    if (typeof p !== "number" || Number.isNaN(p) || p < 0 || p > 100) {
      throw new RangeError(`describe() percentiles must be between 0 and 100, received ${String(p)}.`);
    }
  }
  return { ddof, percentiles };
}

/**
 * Profile one column's values.
 *
 * `total` is passed rather than derived so an all-null column reports the row count as
 * `missing` instead of `0`, which would understate the problem it is reporting.
 */
export function profileColumn(
  name: string,
  values: readonly unknown[],
  total: number,
  options: DescribeOptions = {},
): ColumnProfile {
  const { ddof, percentiles } = validateDescribeOptions(options);

  const present = values.filter(isPresent);
  const type = inferColumnType(present);
  const kind = columnKind(type);
  const numeric = kind === "numeric";
  const numbers = numeric
    ? present.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];

  // One sort and one frequency pass serve every statistic below. Sorting dominates the
  // cost of profiling a numeric column, and each statistic that sorted on its own used to
  // re-sort the same values: quartiles, the interquartile range, the median, and every
  // extra percentile. The answers are identical, because they all read the same order.
  const sorted = numeric && numbers.length > 0 ? sortedColumn(numbers) : null;
  const counts = frequencies(present);
  const bounds = extremes(present);
  const parts = sorted === null ? null : quartilesOfSorted(sorted);

  const computed: Record<string, number | null> = {};
  for (const p of percentiles) {
    computed[`p${p}`] = sorted === null ? null : percentileOfSorted(sorted, p);
  }

  return {
    name,
    type,
    kind,
    count: present.length,
    missing: Math.max(0, total - present.length),
    total,
    unique: counts.unique,
    sum: numeric ? sum(numbers) : null,
    mean: numeric ? mean(numbers) : null,
    median: sorted === null ? null : medianOfSorted(sorted),
    mode: counts.mode,
    min: bounds === null ? null : cloneValue(bounds.min),
    max: bounds === null ? null : cloneValue(bounds.max),
    range: numeric ? range(numbers) : null,
    variance: numeric ? variance(numbers, { ddof }) : null,
    std: numeric ? std(numbers, { ddof }) : null,
    q1: parts === null ? null : parts.q1,
    q3: parts === null ? null : parts.q3,
    iqr: parts === null ? null : parts.q3 - parts.q1,
    percentiles: computed,
    ddof,
  };
}

/**
 * Round a value for display only.
 *
 * Full precision stays in the profile; a table cell is read by a human, and
 * `0.30000000000000004` costs width without adding information. `null` is preserved so a
 * "not applicable" cell never looks like a zero.
 */
function formatForDisplay(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  if (Number.isInteger(value)) return value;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e12)) return Number(value.toPrecision(6));
  return Number(value.toFixed(6));
}

/**
 * Profiles for every column of one dataset.
 *
 * Holds the per-column results plus the shape they came from, so a consumer can tell
 * "no variance" from "no rows" without re-reading the dataset.
 */
export class DatasetDescription<TDataset = unknown> {
  /** Rows profiled. */
  readonly rowCount: number;
  /** Columns profiled. */
  readonly columnCount: number;
  /** One profile per column, in dataset column order. */
  readonly profiles: readonly ColumnProfile[];
  /** Degrees of freedom used for `variance` and `std`. */
  readonly ddof: number;

  readonly #build: DescriptionBuilder<TDataset> | null;

  constructor(
    rowCount: number,
    columnCount: number,
    profiles: readonly ColumnProfile[],
    ddof: number,
    build: DescriptionBuilder<TDataset> | null = null,
  ) {
    this.rowCount = rowCount;
    this.columnCount = columnCount;
    this.profiles = profiles;
    this.ddof = ddof;
    this.#build = build;
  }

  /** Profile for one column. Throws `ColumnNotFoundError` when absent. */
  get(column: string): ColumnProfile {
    const found = this.profiles.find((profile) => profile.name === column);
    if (found === undefined) {
      throw new ColumnNotFoundError(
        column,
        this.profiles.map((profile) => profile.name),
      );
    }
    return found;
  }

  /** Column names, in order. */
  get columns(): readonly string[] {
    return this.profiles.map((profile) => profile.name);
  }

  /**
   * Render as a table, one row per column.
   *
   * Shows a readable subset of statistics; `toDataset()` has all of them. Numbers are
   * rounded for display only — `profiles` keeps full precision.
   */
  table(options: TableOptions = {}): string {
    const rows: Row[] = this.profiles.map((profile) => {
      const row: Row = { column: profile.name, type: profile.type };
      for (const statistic of TABLE_STATISTICS) {
        row[statistic] = formatForDisplay(profile[statistic]);
      }
      return row;
    });
    const columns = ["column", "type", ...TABLE_STATISTICS];
    return renderTable(rows, columns, options);
  }

  /**
   * Every statistic as a `Dataset`, one row per column.
   *
   * For piping into Numviz or any other tool that expects tabular data. Requires the
   * source dataset, so it is unavailable on a description built without one.
   */
  toDataset(): TDataset {
    if (this.#build === null) {
      throw new Error("This description was not built from a Dataset, so it cannot be converted back.");
    }
    const percentileColumns: string[] = [];
    for (const profile of this.profiles) {
      for (const key of Object.keys(profile.percentiles)) {
        if (!percentileColumns.includes(key)) percentileColumns.push(key);
      }
    }
    // Percentiles are flattened into their own columns; the nested object is dropped so a
    // cell never holds a record.
    const rows: Row[] = this.profiles.map(({ percentiles, ...profile }) => {
      const row: Row = { ...profile };
      for (const key of percentileColumns) row[key] = percentiles[key] ?? null;
      return row;
    });
    return this.#build(rows, [
      "name",
      "type",
      "kind",
      "count",
      "missing",
      "total",
      "unique",
      "sum",
      "mean",
      "median",
      "mode",
      "min",
      "max",
      "range",
      "variance",
      "std",
      "q1",
      "q3",
      "iqr",
      ...percentileColumns,
      "ddof",
    ]);
  }

  /** JSON-safe representation. */
  toJSON(): {
    rowCount: number;
    columnCount: number;
    ddof: number;
    profiles: ColumnProfile[];
  } {
    return {
      rowCount: this.rowCount,
      columnCount: this.columnCount,
      ddof: this.ddof,
      profiles: this.profiles.map((profile) => ({ ...profile, percentiles: { ...profile.percentiles } })),
    };
  }
}
