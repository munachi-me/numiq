/**
 * Dataset profiling behind `Dataset.profile()`.
 *
 * ## Why this is not `describe()`
 *
 * `describe()` already answers "what are the numbers in this column". `profile()` answers
 * a different question: "is this dataset ready to analyse, and where will it hurt me".
 * The overlap is deliberate — the per-column statistics are literally the same
 * `ColumnProfile` objects, so `profile().describe().get("age").mean` and
 * `describe("age").mean` can never disagree. What `profile()` adds on top is the part
 * that is about the dataset rather than one column: duplicate rows, memory, a type
 * breakdown, and a quality verdict.
 *
 * A separate `ColumnProfile` type would have been the obvious mistake here. Two shapes
 * computing the same mean from the same values is how a package ends up with `mean` in
 * one place and `mean` in another that disagree after the third release.
 *
 * ## Nothing is mutated
 *
 * Every operation reads. Building a profile cannot change the dataset, which is why the
 * signature has no options for "fix this for me" — cleaning is a separate, explicit step.
 */
import type { Row, TableOptions } from "./types.js";
import type { ColumnProfile, DescribeOptions } from "../analytics/describe.js";
import { DatasetDescription, profileColumn, validateDescribeOptions } from "../analytics/describe.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";

import { stableKey } from "../utils/values.js";
import { renderTable } from "../display/table.js";
import {
  columnFindings,
  countColumnOutliers,
  datasetFindings,
  type QualityFinding,
  type QualitySeverity,
} from "./quality.js";

/** Number of columns of each inferred type. */
export interface TypeBreakdown {
  readonly numeric: number;
  readonly categorical: number;
  readonly temporal: number;
  readonly boolean: number;
  readonly mixed: number;
  readonly empty: number;
}

/** Everything `profile()` knows about the dataset as a whole. */
export interface DatasetProfileSummary {
  readonly rowCount: number;
  readonly columnCount: number;
  /** `[rowCount, columnCount]`. */
  readonly shape: readonly [number, number];
  /** Total missing cells across all columns. */
  readonly missingValues: number;
  /** Missing cells as a percentage of all cells, `0` when there are no cells. */
  readonly missingPercent: number;
  /** Rows that are exact duplicates of an earlier row. */
  readonly duplicateRows: number;
  /** Approximate retained size in bytes, computed the same way as `info().memoryHint`. */
  readonly memoryBytes: number;
  /** Number of distinct column types present. */
  readonly typeCount: number;
  readonly types: TypeBreakdown;
  /** Columns with no present values at all. */
  readonly emptyColumns: readonly string[];
  /** Columns where every present value is identical. */
  readonly constantColumns: readonly string[];
}

/** Options accepted by `profile()`. */
export interface ProfileOptions extends DescribeOptions {
  /**
   * Cap on the number of findings returned. Highest severity first, then column order.
   *
   * Findings are cheap to produce but a pathological dataset can generate one per column
   * per check, and a report nobody can read is not a report. `findingCount` records the
   * true total when this truncates.
   */
  maxFindings?: number;
}

/** Outcome of `Dataset.profile()`. */
export class DatasetProfile<TDataset = unknown> {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly summary: DatasetProfileSummary;
  readonly profiles: readonly ColumnProfile[];
  /** Findings, highest severity first. May be truncated by `maxFindings`. */
  readonly findings: readonly QualityFinding[];
  /** Total findings found, which may exceed `findings.length` when truncated. */
  readonly findingCount: number;
  /** True when `findings` was truncated. */
  readonly truncated: boolean;
  /** Findings per severity, counted before truncation. */
  readonly bySeverity: Readonly<Record<QualitySeverity, number>>;
  /** Degrees of freedom used for `variance` and `std`. */
  readonly ddof: number;

  readonly #description: DatasetDescription<TDataset>;

  constructor(
    description: DatasetDescription<TDataset>,
    summary: DatasetProfileSummary,
    findings: readonly QualityFinding[],
    ddof: number,
    maxFindings: number,
  ) {
    this.#description = description;
    this.rowCount = description.rowCount;
    this.columnCount = description.columnCount;
    this.summary = summary;
    this.profiles = description.profiles;
    this.ddof = ddof;

    const ordered = [...findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
    const kept = ordered.slice(0, maxFindings);
    this.findings = Object.freeze(kept.map((finding) => Object.freeze(finding)));
    this.findingCount = ordered.length;
    this.truncated = ordered.length > kept.length;

    const counts: Record<QualitySeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of ordered) counts[finding.severity] += 1;
    this.bySeverity = Object.freeze(counts);
  }

  /** Column names, in dataset order. */
  get columns(): readonly string[] {
    return this.profiles.map((profile) => profile.name);
  }

  /** Profile for one column. Throws `ColumnNotFoundError` when absent. */
  get(column: string): ColumnProfile {
    return this.#description.get(column);
  }

  /** The underlying description, so callers can use `describe()` helpers without recomputing. */
  describe(): DatasetDescription<TDataset> {
    return this.#description;
  }

  /** Findings for one column, or for the dataset when `column` is `null`. */
  findingsFor(column: string | null): readonly QualityFinding[] {
    return this.findings.filter((finding) => finding.column === column);
  }

  /** True when nothing was flagged as an `error`. Warnings and info do not fail this. */
  get healthy(): boolean {
    return this.bySeverity.error === 0;
  }

  /** Render the per-column statistics as a table, identical to `describe().table()`. */
  table(options: TableOptions = {}): string {
    return this.#description.table(options);
  }

  /** Render the findings as a table. */
  findingsTable(): string {
    const rows: Row[] = this.findings.map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      column: finding.column ?? "-",
      count: finding.count ?? "-",
      message: finding.message,
    }));
    return renderTable(rows, ["severity", "code", "column", "count", "message"], {});
  }

  /** Serialize to a plain object, suitable for `JSON.stringify`. */
  toJSON(): {
    rowCount: number;
    columnCount: number;
    summary: DatasetProfileSummary;
    findings: readonly QualityFinding[];
    findingCount: number;
    truncated: boolean;
    bySeverity: Readonly<Record<QualitySeverity, number>>;
  } {
    return {
      rowCount: this.rowCount,
      columnCount: this.columnCount,
      summary: this.summary,
      findings: this.findings,
      findingCount: this.findingCount,
      truncated: this.truncated,
      bySeverity: this.bySeverity,
    };
  }
}

function severityRank(severity: QualitySeverity): number {
  switch (severity) {
    case "error":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

/** Approximate bytes retained by a value. Deliberately rough; used for a hint, not a budget. */
function valueBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case "number":
      return 8;
    case "boolean":
      return 4;
    case "string":
      return value.length * 2;
    case "object":
      if (value instanceof Date) return 8;
      return 16;
    default:
      return 8;
  }
}

/** Rows that repeat an earlier row, compared on every column. */
function countDuplicateRows(rows: readonly Row[], columns: readonly string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    // `stableKey` on the projected row keeps `1` and `"1"` distinct, and treats a missing
    // cell consistently with everywhere else in the package.
    const key = stableKey(columns.map((column) => row[column]));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

/** Mutable working copy; the frozen result is built once all columns are counted. */
interface MutableTypeBreakdown {
  numeric: number;
  categorical: number;
  temporal: number;
  boolean: number;
  mixed: number;
  empty: number;
}

function emptyBreakdown(): MutableTypeBreakdown {
  return { numeric: 0, categorical: 0, temporal: 0, boolean: 0, mixed: 0, empty: 0 };
}

/** Validate `maxFindings`, which has no sensible default when given a bad value. */
function resolveMaxFindings(maxFindings: number | undefined): number {
  if (maxFindings === undefined) return 100;
  if (typeof maxFindings !== "number" || !Number.isFinite(maxFindings) || maxFindings < 0) {
    throw new ValidationError(
      `profile() expects maxFindings to be a non-negative number, received ${String(maxFindings)}.`,
    );
  }
  return Math.floor(maxFindings);
}

/**
 * Build a profile for the named columns.
 *
 * `columns` must already be validated by the caller; this does not re-check membership
 * because `Dataset` owns the column list and has a better error message for it.
 */
export function buildProfile<TDataset>(
  rows: readonly Row[],
  allColumns: readonly string[],
  selected: readonly string[],
  options: ProfileOptions,
  build: (rows: readonly Row[], columns: readonly string[]) => TDataset,
): DatasetProfile<TDataset> {
  const { ddof } = validateDescribeOptions(options);
  const maxFindings = resolveMaxFindings(options.maxFindings);

  const profiles: ColumnProfile[] = [];
  const findings: QualityFinding[] = [];
  const types = emptyBreakdown();
  let missingValues = 0;
  let memoryBytes = 0;

  for (const name of selected) {
    const values = rows.map((row) => row[name]);
    const profile = profileColumn(name, values, rows.length, options);
    profiles.push(profile);
    missingValues += profile.missing;

    switch (profile.kind) {
      case "numeric":
        types.numeric += 1;
        break;
      case "categorical":
        types.categorical += 1;
        break;
      case "temporal":
        types.temporal += 1;
        break;
      case "boolean":
        types.boolean += 1;
        break;
      case "mixed":
        types.mixed += 1;
        break;
      default:
        types.empty += 1;
        break;
    }

    for (const row of rows) memoryBytes += valueBytes(row[name]);
    const outlierCount = profile.kind === "numeric" ? countColumnOutliers(values) : 0;
    findings.push(...columnFindings(name, values, profile, outlierCount));
  }

  const totalCells = rows.length * selected.length;
  const duplicateRows = countDuplicateRows(rows, selected);

  const summary: DatasetProfileSummary = Object.freeze({
    rowCount: rows.length,
    columnCount: selected.length,
    shape: Object.freeze([rows.length, selected.length]) as readonly [number, number],
    missingValues,
    missingPercent: totalCells === 0 ? 0 : Math.round((missingValues / totalCells) * 1000) / 10,
    duplicateRows,
    memoryBytes,
    typeCount: Object.values(types).filter((count) => count > 0).length,
    types: Object.freeze(types),
    emptyColumns: Object.freeze(profiles.filter((profile) => profile.count === 0).map((profile) => profile.name)),
    constantColumns: Object.freeze(
      profiles.filter((profile) => profile.count > 0 && profile.unique === 1).map((profile) => profile.name),
    ),
  });

  // Duplicate-row findings only make sense when every column was examined. On a column
  // subset, "duplicate" would mean "two rows share this one value", which is a different
  // question and would be reported as if the whole row repeated.
  const wholeDataset = selected.length === allColumns.length;
  findings.push(...datasetFindings(rows.length, selected.length, wholeDataset ? duplicateRows : 0));

  const description = new DatasetDescription<TDataset>(rows.length, selected.length, profiles, ddof, build);
  return new DatasetProfile<TDataset>(description, summary, findings, ddof, maxFindings);
}

/**
 * Resolve the `profile()` argument to a column list.
 *
 * Accepts nothing (every column), a name, or an array of names. A `DescribeOptions`
 * object in the first position is also accepted, mirroring `describe()`.
 */
export function resolveProfileColumns(
  allColumns: readonly string[],
  columnOrOptions: string | readonly string[] | ProfileOptions | undefined,
  options: ProfileOptions,
): { selected: readonly string[]; settings: ProfileOptions } {
  if (typeof columnOrOptions === "string") {
    if (columnOrOptions.length === 0) {
      throw new ValidationError("profile() needs a non-empty column name.");
    }
    if (!allColumns.includes(columnOrOptions)) {
      throw new ColumnNotFoundError(columnOrOptions, allColumns);
    }
    return { selected: [columnOrOptions], settings: options };
  }

  if (Array.isArray(columnOrOptions)) {
    const names = columnOrOptions as readonly string[];
    if (names.length === 0) {
      throw new ValidationError("profile() received an empty column list.");
    }
    for (const name of names) {
      if (typeof name !== "string" || name.length === 0) {
        throw new ValidationError(`profile() expects non-empty column names, received ${String(name)}.`);
      }
      if (!allColumns.includes(name)) throw new ColumnNotFoundError(name, allColumns);
    }
    // Preserve caller order but drop repeats: profiling the same column twice would
    // double-count it in every dataset-level total.
    return { selected: [...new Set(names)], settings: options };
  }

  const settings = (columnOrOptions ?? options) as ProfileOptions;
  return { selected: allColumns, settings };
}

/** Re-exported so callers can name the type without reaching into `analytics`. */
export type { ColumnProfile } from "../analytics/describe.js";
