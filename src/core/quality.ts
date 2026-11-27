/**
 * Structured data-quality inspection behind `Dataset.getQualityReport()` and friends.
 *
 * This module deliberately produces *reports*, never edits. Cleaning is a separate,
 * explicit step (`dropMissing`, `normalizeText`, `replace`, ...) so that "tell me what is
 * wrong" and "change my data" can never be confused for one another.
 *
 * ## Relationship to `profile()`
 *
 * `profile()` is the summary view: one verdict per column plus dataset totals. The
 * functions here are the drill-down: which rows, which values, how many. They share the
 * same missing-value definition (`isPresent`) so a count from one always matches the
 * count from the other.
 */
import type { Row } from "./types.js";
import type { ColumnProfile } from "../analytics/describe.js";
import { profileColumn } from "../analytics/describe.js";
import { detectOutliers } from "../analytics/advanced.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { renderTable } from "../display/table.js";

/** Severity of a quality finding. Ordered: an `error` outranks a `warning`, which outranks `info`. */
export type QualitySeverity = "error" | "warning" | "info";

/** One thing worth knowing about the dataset, or about one column. */
export interface QualityFinding {
  /** Machine-readable category, stable across releases. */
  readonly code: string;
  readonly severity: QualitySeverity;
  /** Human-readable description, safe to show in a UI. */
  readonly message: string;
  /** Column the finding concerns, or `null` when it is about the dataset as a whole. */
  readonly column: string | null;
  /** How many rows or cells are affected. `null` when a count is not meaningful. */
  readonly count: number | null;
  /** Supporting detail, e.g. the offending values. Shallow-frozen. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Missing-cell counts for one column. */
export interface ColumnMissingSummary {
  readonly column: string;
  readonly missing: number;
  readonly present: number;
  readonly total: number;
  /** `missing / total * 100`, or `0` for an empty column. */
  readonly percent: number;
  /** Zero-based row indexes holding a missing value, capped by `maxRows`. */
  readonly rows: readonly number[];
  /** True when `rows` was capped. */
  readonly truncated: boolean;
}

/** Outcome of `missingValues()`. */
export interface MissingValuesReport {
  readonly columns: readonly ColumnMissingSummary[];
  /** Total missing cells across the examined columns. */
  readonly totalMissing: number;
  /** Total cells examined. */
  readonly totalCells: number;
  readonly percent: number;
  /** Columns with at least one missing value, worst first. */
  readonly affected: readonly string[];
}

/** One group of duplicate rows. */
export interface DuplicateGroup {
  /** Row indexes sharing the same key, in ascending order. Always length >= 2. */
  readonly rows: readonly number[];
  /** The repeated values, keyed by the compared columns. */
  readonly values: Readonly<Record<string, unknown>>;
}

/** Outcome of `findDuplicates()`. */
export interface DuplicateReport {
  /** Columns compared. */
  readonly columns: readonly string[];
  readonly groups: readonly DuplicateGroup[];
  /** Rows that repeat an earlier row, i.e. every row in a group after the first. */
  readonly duplicateRows: number;
  /** Rows removed by `dropDuplicates(columns)`. Equal to `duplicateRows`. */
  readonly removable: number;
  /** True when `groups` was capped by `maxGroups`. */
  readonly truncated: boolean;
}

/** Options for `missingValues()`. */
export interface MissingValuesOptions {
  /** Columns to examine. Defaults to every column. */
  columns?: readonly string[];
  /** Cap on row indexes recorded per column. Defaults to 20. */
  maxRows?: number;
}

/** Options for `findDuplicates()`. */
export interface FindDuplicatesOptions {
  /** Columns that define a duplicate. Defaults to every column. */
  columns?: readonly string[];
  /** Cap on groups returned. Defaults to 50. */
  maxGroups?: number;
}

/** One outlier, located by row. */
export interface OutlierRow {
  readonly row: number;
  readonly value: number;
}

/** Outliers for one column. */
export interface ColumnOutliers {
  readonly column: string;
  readonly method: "iqr" | "zscore";
  /** Fences or threshold actually used, so the result is reproducible. */
  readonly bounds: { readonly lower: number; readonly upper: number };
  readonly outliers: readonly OutlierRow[];
  readonly count: number;
  /** Rows with a present numeric value, i.e. the population searched. */
  readonly examined: number;
}

/** Outcome of `detectOutliers()`. */
export interface OutliersReport {
  readonly columns: readonly ColumnOutliers[];
  readonly totalOutliers: number;
}

/** Options for `detectOutliers()`. */
export interface DetectOutliersOptions {
  /** Columns to scan. Defaults to every numeric column. */
  columns?: readonly string[];
  /** `iqr` uses Tukey fences; `zscore` uses a standard-deviation threshold. */
  method?: "iqr" | "zscore";
  /** Multiplier for `iqr` (default 1.5) or threshold for `zscore` (default 3). */
  factor?: number;
}

function assertColumnList(columns: readonly string[], targets: readonly string[]): void {
  const known = new Set(columns);
  for (const target of targets) {
    if (!known.has(target)) throw new ColumnNotFoundError(target, columns);
  }
}

/** Round to three decimals; quality percentages do not need more. */
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/**
 * Findings that need the whole column, not just its profile.
 *
 * Kept separate from the per-column loop so the cheap profile-driven checks and the
 * full-column scans stay readable. `values` are already extracted by the caller.
 */
export function columnFindings(
  name: string,
  values: readonly unknown[],
  profile: ColumnProfile,
  outlierCount = 0,
): QualityFinding[] {
  const findings: QualityFinding[] = [];

  if (profile.total === 0) {
    findings.push({
      code: "EMPTY_COLUMN",
      severity: "warning",
      message: `Column "${name}" has no rows.`,
      column: name,
      count: 0,
      detail: Object.freeze({}),
    });
    return findings;
  }

  if (profile.count === 0) {
    findings.push({
      code: "ALL_MISSING",
      severity: "error",
      message: `Column "${name}" has no present values.`,
      column: name,
      count: profile.total,
      detail: Object.freeze({}),
    });
    return findings;
  }

  if (profile.unique === 1) {
    findings.push({
      code: "CONSTANT_COLUMN",
      severity: "info",
      message: `Column "${name}" has a single distinct value.`,
      column: name,
      count: profile.count,
      detail: Object.freeze({ value: cloneValue(profile.mode) }),
    });
  }

  if (profile.missing > 0) {
    const percent = Math.round((profile.missing / profile.total) * 1000) / 10;
    findings.push({
      code: "MISSING_VALUES",
      severity: percent >= 50 ? "warning" : "info",
      message: `Column "${name}" is missing ${profile.missing} of ${profile.total} values (${percent}%).`,
      column: name,
      count: profile.missing,
      detail: Object.freeze({ percent }),
    });
  }

  if (profile.type === "mixed") {
    // Name the types actually present, otherwise "mixed" tells the reader nothing about
    // what to fix.
    const seen = new Map<string, number>();
    for (const value of values) {
      if (!isPresent(value)) continue;
      const type = value instanceof Date ? "date" : typeof value;
      seen.set(type, (seen.get(type) ?? 0) + 1);
    }
    findings.push({
      code: "MIXED_TYPES",
      severity: "warning",
      message: `Column "${name}" holds more than one type: ${[...seen.keys()].sort().join(", ")}.`,
      column: name,
      count: profile.count,
      detail: Object.freeze({ types: Object.freeze(Object.fromEntries(seen)) }),
    });
  }

  if (profile.type === "string") {
    // Whitespace that the reader cannot see is the single most common cause of "these
    // values look identical but group separately". Report the count, not the rows.
    let padded = 0;
    for (const value of values) {
      if (typeof value === "string" && value !== value.trim()) padded += 1;
    }
    if (padded > 0) {
      findings.push({
        code: "UNTRIMMED_STRINGS",
        severity: "warning",
        message: `Column "${name}" has ${padded} value(s) with leading or trailing whitespace.`,
        column: name,
        count: padded,
        detail: Object.freeze({}),
      });
    }
  }

  if (outlierCount > 0) {
    findings.push({
      code: "OUTLIERS",
      severity: "info",
      message: `Column "${name}" has ${outlierCount} value(s) outside the IQR fences.`,
      column: name,
      count: outlierCount,
      detail: Object.freeze({ method: "iqr" }),
    });
  }

  return findings;
}

/**
 * Findings about the dataset as a whole, given its shape and duplicate count.
 *
 * Shared with `profile()` so the two surfaces cannot disagree about severity or wording.
 */
export function datasetFindings(rowCount: number, columnCount: number, duplicateRows: number): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (duplicateRows > 0) {
    findings.push({
      code: "DUPLICATE_ROWS",
      severity: "warning",
      message: `${duplicateRows} row(s) repeat an earlier row exactly.`,
      column: null,
      count: duplicateRows,
      detail: Object.freeze({}),
    });
  }
  if (columnCount === 0) {
    findings.push({
      code: "NO_COLUMNS",
      severity: "error",
      message: "Dataset has no columns.",
      column: null,
      count: 0,
      detail: Object.freeze({}),
    });
  } else if (rowCount === 0) {
    findings.push({
      code: "NO_ROWS",
      severity: "warning",
      message: "Dataset has no rows.",
      column: null,
      count: 0,
      detail: Object.freeze({}),
    });
  }
  return findings;
}

/**
 * IQR outlier count for a column's raw values.
 *
 * Shared by `profile()` and `getQualityReport()` so both report the same number under the
 * same code. Non-numeric and missing cells are skipped, not coerced.
 */
export function countColumnOutliers(values: readonly unknown[]): number {
  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  }
  return detectOutliers(numbers, { method: "iqr" }).outliers.length;
}

/** Locate every missing cell, column by column. */
export function missingValues(
  rows: readonly Row[],
  columns: readonly string[],
  options: MissingValuesOptions = {},
): MissingValuesReport {
  const targets = options.columns ?? columns;
  assertColumnList(columns, targets);
  const maxRows = options.maxRows ?? 20;
  if (!Number.isInteger(maxRows) || maxRows < 0) {
    throw new ValidationError(
      `missingValues() expects maxRows to be a non-negative integer, received ${String(maxRows)}.`,
    );
  }

  const summaries: ColumnMissingSummary[] = [];
  let totalMissing = 0;

  for (const column of targets) {
    const indexes: number[] = [];
    let missing = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (isPresent(rows[index]?.[column])) continue;
      missing += 1;
      if (indexes.length < maxRows) indexes.push(index);
    }
    totalMissing += missing;
    summaries.push(
      Object.freeze({
        column,
        missing,
        present: rows.length - missing,
        total: rows.length,
        percent: pct(missing, rows.length),
        rows: Object.freeze(indexes),
        truncated: missing > indexes.length,
      }),
    );
  }

  const totalCells = rows.length * targets.length;
  const affected = summaries
    .filter((summary) => summary.missing > 0)
    .sort((left, right) => right.missing - left.missing)
    .map((summary) => summary.column);

  return Object.freeze({
    columns: Object.freeze(summaries),
    totalMissing,
    totalCells,
    percent: pct(totalMissing, totalCells),
    affected: Object.freeze(affected),
  });
}

/** Group rows that share a key. */
export function findDuplicates(
  rows: readonly Row[],
  columns: readonly string[],
  options: FindDuplicatesOptions = {},
): DuplicateReport {
  const targets = options.columns ?? columns;
  assertColumnList(columns, targets);
  if (targets.length === 0) {
    throw new ValidationError("findDuplicates() needs at least one column.");
  }
  const maxGroups = options.maxGroups ?? 50;
  if (!Number.isInteger(maxGroups) || maxGroups < 0) {
    throw new ValidationError(
      `findDuplicates() expects maxGroups to be a non-negative integer, received ${String(maxGroups)}.`,
    );
  }

  const buckets = new Map<string, number[]>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const values = targets.map((column) => row[column]);
    const key = stableKey(values);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [index]);
    else bucket.push(index);
  }

  const groups: DuplicateGroup[] = [];
  let duplicateRows = 0;
  for (const indexes of buckets.values()) {
    if (indexes.length < 2) continue;
    duplicateRows += indexes.length - 1;
    if (groups.length >= maxGroups) continue;
    const first = rows[indexes[0] ?? 0];
    const values: Record<string, unknown> = {};
    for (const column of targets) values[column] = first?.[column] ?? null;
    groups.push(Object.freeze({ rows: Object.freeze([...indexes]), values: Object.freeze(values) }));
  }

  // Longest group first: the biggest duplication problem is the one worth showing.
  groups.sort((left, right) => right.rows.length - left.rows.length);

  return Object.freeze({
    columns: Object.freeze([...targets]),
    groups: Object.freeze(groups),
    duplicateRows,
    removable: duplicateRows,
    truncated: duplicateRows > 0 && groups.length < countDuplicateGroups(buckets),
  });
}

function countDuplicateGroups(buckets: ReadonlyMap<string, number[]>): number {
  let count = 0;
  for (const indexes of buckets.values()) if (indexes.length >= 2) count += 1;
  return count;
}

/**
 * Outliers per column, located by row.
 *
 * Unlike `Dataset.outliers()`, which reports values only, this keeps the row index so a
 * caller can go and look at the record. Rows whose value is missing or non-numeric are
 * skipped rather than coerced — a null is not an outlier, it is a gap.
 */
export function detectOutlierRows(
  rows: readonly Row[],
  columns: readonly string[],
  numericColumns: readonly string[],
  options: DetectOutliersOptions = {},
): OutliersReport {
  const targets = options.columns ?? numericColumns;
  assertColumnList(columns, targets);
  const method = options.method ?? "iqr";
  if (method !== "iqr" && method !== "zscore") {
    throw new ValidationError(`detectOutliers() expects method "iqr" or "zscore", received ${String(method)}.`);
  }
  const factor = options.factor ?? (method === "iqr" ? 1.5 : 3);
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
    throw new ValidationError(`detectOutliers() expects factor to be a positive number, received ${String(factor)}.`);
  }

  const results: ColumnOutliers[] = [];
  let totalOutliers = 0;

  for (const column of targets) {
    const values: number[] = [];
    const indexes: number[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const value = rows[index]?.[column];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      values.push(value);
      indexes.push(index);
    }

    const found = detectOutliers(values, { method, threshold: factor });
    // `found.outliers[].index` is a position in `values`, and `indexes` maps that same
    // position back to the source row.
    const flagged: OutlierRow[] = [];
    for (const outlier of found.outliers) {
      const row = indexes[outlier.index];
      if (row === undefined) continue;
      flagged.push(Object.freeze({ row, value: outlier.value }));
    }

    const bounds = found.fences ?? {
      lower: Number.NEGATIVE_INFINITY,
      upper: Number.POSITIVE_INFINITY,
    };

    totalOutliers += flagged.length;
    results.push(
      Object.freeze({
        column,
        method,
        bounds: Object.freeze({ lower: bounds.lower, upper: bounds.upper }),
        outliers: Object.freeze(flagged),
        count: flagged.length,
        examined: values.length,
      }),
    );
  }

  return Object.freeze({ columns: Object.freeze(results), totalOutliers });
}

/**
 * Roll everything into a severity-ranked finding list.
 *
 * Built on top of `profile()`, so the per-column facts are computed once. This exists
 * because a caller sometimes wants the flat list of problems without the statistics;
 * making them re-derive it from `profile()` output would invite drift.
 */
export function qualityFindings(
  rows: readonly Row[],
  columns: readonly string[],
  numericColumns: readonly string[],
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const duplicates = findDuplicates(rows, columns);

  const numeric = new Set(numericColumns);

  // Per-column checks come from the same generator `profile()` uses, so a column can never
  // be a warning in one report and an observation in the other.
  for (const column of columns) {
    const values = rows.map((row) => row[column]);
    const profile = profileColumn(column, values, rows.length, {});
    const outlierCount = numeric.has(column) ? countColumnOutliers(values) : 0;
    findings.push(...columnFindings(column, values, profile, outlierCount));
  }

  findings.push(...datasetFindings(rows.length, columns.length, duplicates.duplicateRows));

  return findings;
}

/** Order findings by severity, then by column, then by code, for a stable report. */
export function rankFindings(findings: readonly QualityFinding[]): QualityFinding[] {
  const rank: Record<QualitySeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((left, right) => {
    const bySeverity = rank[left.severity] - rank[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const leftColumn = left.column ?? "";
    const rightColumn = right.column ?? "";
    if (leftColumn !== rightColumn) return leftColumn < rightColumn ? -1 : 1;
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });
}

/**
 * A severity-ranked quality report.
 *
 * A class rather than a plain object so `table()` and the severity counters are computed
 * once and stay consistent with `findings`. It is a result, not a `Dataset`: there is
 * nothing to reshape here.
 */
export class QualityReport {
  /** Findings, errors first. */
  readonly findings: readonly QualityFinding[];
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly bySeverity: Readonly<Record<QualitySeverity, number>>;

  constructor(findings: readonly QualityFinding[], columns: readonly string[], rowCount: number) {
    this.findings = Object.freeze([...findings]);
    this.columns = Object.freeze([...columns]);
    this.rowCount = rowCount;
    const counts: Record<QualitySeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    this.bySeverity = Object.freeze(counts);
  }

  /** True when no `error`-severity finding exists. Warnings and info do not fail this. */
  get healthy(): boolean {
    return this.bySeverity.error === 0;
  }

  /** Findings for one column, or for the dataset when `column` is `null`. */
  forColumn(column: string | null): readonly QualityFinding[] {
    return this.findings.filter((finding) => finding.column === column);
  }

  /** Findings carrying one code, e.g. `"MISSING_VALUES"`. */
  forCode(code: string): readonly QualityFinding[] {
    return this.findings.filter((finding) => finding.code === code);
  }

  /** Render the findings as a table. */
  table(): string {
    const rows: Row[] = this.findings.map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      column: finding.column ?? "-",
      count: finding.count ?? "-",
      message: finding.message,
    }));
    return renderTable(rows, ["severity", "code", "column", "count", "message"], {});
  }

  toJSON(): {
    rowCount: number;
    findings: readonly QualityFinding[];
    bySeverity: Readonly<Record<QualitySeverity, number>>;
  } {
    return { rowCount: this.rowCount, findings: this.findings, bySeverity: this.bySeverity };
  }
}
