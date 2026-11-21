import type {
  ColumnSchema,
  ColumnView,
  DatasetInfo,
  DatasetOptions,
  DType,
  ImportReport,
  Row,
  TableOptions,
  NormalizationPolicy,
  ColumnType,
  ColumnTypeSpec,
} from "./types.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { renderTable } from "../display/table.js";
import { cloneValue, deepFreeze, isPresent, stableKey } from "../utils/values.js";
import { compareValues } from "../utils/compare.js";
import { countUnique, describeColumn, distinctValues, inferColumnType } from "./schema.js";
import {
  addColumn,
  castColumns,
  dropColumns,
  dropDuplicateRows,
  dropMissingRows,
  fillMissingValues,
  mapColumn,
  renameColumns,
  replaceValues,
  sampleRows,
} from "./prepare.js";
import type { DropMissingOptions, FillStrategy, ReplaceRule, SampleOptions } from "./prepare.js";
import { Query, detectCellShape } from "./query.js";
import { GroupedDataset } from "./group.js";
import { DatasetDescription, columnKind, profileColumn, validateDescribeOptions } from "../analytics/describe.js";
import type { ColumnProfile, DescribeOptions } from "../analytics/describe.js";
import {
  correlationMatrix,
  covariance,
  detectOutliers,
  fiveNumberSummary,
  kurtosis,
  pearsonCorrelation,
  percentileRank,
  skewness,
  spearmanCorrelation,
  zScores,
} from "../analytics/advanced.js";
import type {
  AdvancedOptions,
  CorrelationMatrix,
  CorrelationResult,
  FiveNumberSummary,
  OutlierOptions,
  OutlierResult,
  ZScoreResult,
} from "../analytics/advanced.js";
import { Metric } from "../metrics/metric.js";
import type { MetricSpec } from "../metrics/metric.js";
import { analyze } from "../insights/insights.js";
import type { InsightOptions, InsightReport } from "../insights/insights.js";
import { resolveNormalization } from "../io/normalization/policy.js";
import { normalizeCell } from "../io/normalization/values.js";

/** Internal marker: rows are already normalized, so the constructor must not re-normalize. */
const NORMALIZED = Symbol("numiq.normalized-rows");

interface InternalOptions extends DatasetOptions {
  [NORMALIZED]?: boolean;
  normalizationPolicy?: NormalizationPolicy;
  importReport?: ImportReport;
}

/**
 * An immutable table of records.
 *
 * Rows are stored once and never mutated; every read hands back a defensive copy, so
 * callers cannot corrupt a dataset by mutating what they receive.
 */
export class Dataset {
  readonly #rows: readonly Row[];
  readonly #columns: readonly string[];
  readonly #options: InternalOptions;
  readonly #importReport: ImportReport | null;
  #schemaCache: Record<string, ColumnSchema> | null = null;

  readonly name: string;
  readonly metadata: Readonly<Record<string, unknown>>;

  constructor(rows: readonly Row[], options: InternalOptions = {}) {
    const normalized = options[NORMALIZED] === true;
    const policy = options.normalizationPolicy ?? resolveNormalization(options.normalization);

    const columns = options.columns ? [...options.columns] : inferColumns(rows);
    validateColumnNames(columns);
    if (columns.length === 0 && rows.length > 0) {
      throw new ValidationError("Cannot build a dataset: rows are present but no columns were detected.");
    }

    const built: Row[] = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      const source = rows[index];
      if (source === undefined) throw new ValidationError(`Row ${index} is undefined.`);
      const record: Row = {};
      for (const column of columns) {
        const raw = source[column];
        record[column] = normalized ? cloneValue(raw ?? null) : normalizeCell(raw, policy).value;
      }
      // Frozen so a `filter` predicate (or any other callback) cannot rewrite the
      // dataset's own rows; the class promises immutability to JavaScript callers too.
      built[index] = Object.freeze(record) as Row;
    }

    this.#rows = Object.freeze(built) as readonly Row[];
    // Frozen so a JavaScript caller cannot push a phantom column past the `readonly` type.
    this.#columns = Object.freeze(columns) as readonly string[];
    this.#options = { ...options };
    this.#importReport = options.importReport ? deepFreeze(cloneValue(options.importReport)) : null;
    this.name = options.name ?? "Dataset";
    // Deep-frozen copy: the documented contract is immutability, and a shallow freeze
    // would still let `metadata.nested.x = ...` corrupt the dataset.
    this.metadata = deepFreeze(cloneValue(options.metadata ?? {}));
  }

  // ---------------------------------------------------------------- structure

  /** Column names, in order. */
  get columns(): readonly string[] {
    return this.#columns;
  }

  /** Rows as an array of records. A defensive copy on every call. */
  get data(): readonly Row[] {
    return this.#rows.map((row) => cloneValue(row));
  }

  /** `[rowCount, columnCount]`. */
  get shape(): readonly [number, number] {
    return [this.#rows.length, this.#columns.length];
  }

  get rowCount(): number {
    return this.#rows.length;
  }

  get columnCount(): number {
    return this.#columns.length;
  }

  /** Number of rows. Alias of `rowCount`. */
  get length(): number {
    return this.#rows.length;
  }

  /** True when there are no rows or no columns. */
  get empty(): boolean {
    return this.#rows.length === 0 || this.#columns.length === 0;
  }

  /** Per-column type and nullability. Cached; the dataset is immutable. */
  get schema(): Readonly<Record<string, ColumnSchema>> {
    this.#schemaCache ??= deepFreeze(
      Object.fromEntries(this.#columns.map((column) => [column, describeColumn(column, this.#columnValues(column))])),
    );
    return this.#schemaCache;
  }

  /** Column name to inferred type. */
  get dtypes(): Readonly<Record<string, DType>> {
    const schema = this.schema;
    return Object.fromEntries(this.#columns.map((column) => [column, schema[column]?.type ?? "unknown"]));
  }

  /**
   * Metadata produced by the loader, or `null` when built with `createDataset`.
   *
   * Derived datasets (`head`, `tail`) return `null`: their counts and warnings would
   * describe the source import rather than the rows they actually hold.
   */
  get importReport(): ImportReport | null {
    return this.#importReport;
  }

  // ---------------------------------------------------------------- inspection

  /** First `count` rows. */
  head(count = 5): Dataset {
    return this.#derive(this.#rows.slice(0, requireCount(count, "head")));
  }

  /** Last `count` rows. */
  tail(count = 5): Dataset {
    const size = requireCount(count, "tail");
    return this.#derive(size === 0 ? [] : this.#rows.slice(-size));
  }

  /** Summary of structure, types, and missing counts. */
  info(): DatasetInfo {
    let missingValues = 0;
    for (const column of this.#columns) {
      for (const row of this.#rows) if (!isPresent(row[column])) missingValues += 1;
    }
    return {
      name: this.name,
      rowCount: this.rowCount,
      columnCount: this.columnCount,
      shape: this.shape,
      dtypes: this.dtypes,
      missingValues,
      memoryHint: `~${estimateBytes(this.#rows, this.#columns)} bytes`,
    };
  }

  /** A read-only view of one column. */
  column(name: string): ColumnView {
    this.#assertColumn(name);
    const values = this.#columnValues(name);
    return {
      name,
      type: inferColumnType(values),
      values: values.map((value) => cloneValue(value)),
      missing: values.filter((value) => !isPresent(value)).length,
      unique: countUnique(values),
    };
  }

  /** Distinct present values of a column, in first-seen order. */
  distinct(name: string): unknown[] {
    this.#assertColumn(name);
    return distinctValues(this.#columnValues(name));
  }

  /** Number of distinct present values in a column. */
  unique(name: string): number {
    this.#assertColumn(name);
    return countUnique(this.#columnValues(name));
  }

  /**
   * Descriptive statistics, for one column or for every column.
   *
   * `describe()` profiles the whole dataset and returns a `DatasetDescription`;
   * `describe(column)` profiles that column and returns its `ColumnProfile`. The overloads
   * return different types on purpose: a single-column answer is the profile itself, not a
   * one-row wrapper to unwrap.
   *
   * Statistics that do not apply to a column's type are `null` rather than `0`. Only
   * numeric columns get arithmetic, because a sum of categories has no meaning.
   *
   * ```ts
   * data.describe().table();          // one row per column
   * data.describe("revenue").mean;    // a single profile
   * data.describe().get("revenue");   // the same profile, by name
   * ```
   *
   * The source dataset is never modified; profiles hold copies of any non-primitive values.
   */
  describe(): DatasetDescription<Dataset>;
  describe(options: DescribeOptions): DatasetDescription<Dataset>;
  describe(column: string, options?: DescribeOptions): ColumnProfile;
  describe(
    columnOrOptions?: string | DescribeOptions,
    options: DescribeOptions = {},
  ): DatasetDescription<Dataset> | ColumnProfile {
    // An options object in the first position means "every column"; a string names one.
    if (typeof columnOrOptions === "string") {
      if (columnOrOptions.length === 0) {
        throw new ValidationError("describe() needs a non-empty column name.");
      }
      this.#assertColumn(columnOrOptions);
      return profileColumn(columnOrOptions, this.#columnValues(columnOrOptions), this.rowCount, options);
    }

    const settings = columnOrOptions ?? options;
    const { ddof } = validateDescribeOptions(settings);
    const profiles = this.#columns.map((name) =>
      profileColumn(name, this.#columnValues(name), this.rowCount, settings),
    );
    return new DatasetDescription<Dataset>(this.rowCount, this.columnCount, profiles, ddof, (rows, columns) =>
      this.#build(rows, columns),
    );
  }

  // ------------------------------------------------------------ advanced statistics

  /**
   * Covariance of two columns, over rows where both are present.
   *
   * `ddof` of 1 (default) is the sample covariance; 0 is the population covariance.
   */
  covariance(left: string, right: string, options: AdvancedOptions = {}): number | null {
    this.#assertNumericColumns([left, right], "covariance");
    return covariance(this.#columnValues(left), this.#columnValues(right), options);
  }

  /**
   * Pearson correlation of two columns, with the pair count and a reason when undefined.
   *
   * Reports no p-value and makes no claim of significance; see `pearsonCorrelation`.
   */
  correlation(left: string, right: string): CorrelationResult {
    this.#assertNumericColumns([left, right], "correlation");
    return pearsonCorrelation(this.#columnValues(left), this.#columnValues(right));
  }

  /** Spearman rank correlation of two columns. Monotonic, and robust to outliers. */
  rankCorrelation(left: string, right: string): CorrelationResult {
    this.#assertNumericColumns([left, right], "rankCorrelation");
    return spearmanCorrelation(this.#columnValues(left), this.#columnValues(right));
  }

  /**
   * Correlation matrix over numeric columns.
   *
   * With no arguments every numeric column is included, in dataset order. Pass column
   * names to choose and order a subset.
   */
  correlationMatrix(columns?: readonly string[], method: "pearson" | "spearman" = "pearson"): CorrelationMatrix {
    const chosen = columns ?? this.#numericColumnNames();
    if (chosen.length === 0) {
      throw new ValidationError("correlationMatrix() found no numeric columns to correlate.");
    }
    this.#assertNumericColumns(chosen, "correlationMatrix");
    return correlationMatrix({
      columns: chosen.map((name) => ({ name, values: this.#columnValues(name) })),
      method,
    });
  }

  /** Z-scores for one column, aligned to its rows. */
  zScores(column: string, options: AdvancedOptions = {}): ZScoreResult {
    this.#assertNumericColumns([column], "zScores");
    return zScores(this.#columnValues(column), options);
  }

  /** Percentile rank of `value` within one column, in `[0, 100]`. */
  percentileRank(column: string, value: number): number | null {
    this.#assertNumericColumns([column], "percentileRank");
    return percentileRank(this.#columnValues(column), value);
  }

  /** Skewness of one column. `null` below three values or with zero variance. */
  skewness(column: string): number | null {
    this.#assertNumericColumns([column], "skewness");
    return skewness(this.#columnValues(column));
  }

  /** Excess kurtosis of one column. `null` below four values or with zero variance. */
  kurtosis(column: string): number | null {
    this.#assertNumericColumns([column], "kurtosis");
    return kurtosis(this.#columnValues(column));
  }

  /** Minimum, Q1, median, Q3, maximum, and mean of one column. */
  fiveNumberSummary(column: string): FiveNumberSummary {
    this.#assertNumericColumns([column], "fiveNumberSummary");
    return fiveNumberSummary(this.#columnValues(column));
  }

  /** Outliers in one column, by IQR fences (default) or z-score threshold. */
  outliers(column: string, options: OutlierOptions = {}): OutlierResult {
    this.#assertNumericColumns([column], "outliers");
    return detectOutliers(this.#columnValues(column), options);
  }

  /**
   * Add a z-score column computed from `column`.
   *
   * The new column is `null` wherever the score is undefined, so a constant column yields
   * an all-null column rather than silently scaling by zero.
   */
  withZScores(column: string, name = `${column}_z`, options: AdvancedOptions = {}): Dataset {
    this.#assertNumericColumns([column], "withZScores");
    const scores = zScores(this.#columnValues(column), options);
    const table = addColumn(this.#rows, this.#columns, name, scores.values);
    return this.#build(table.rows, table.columns);
  }

  /** Numeric column names, in dataset order. */
  #numericColumnNames(): string[] {
    const schema = this.schema;
    return this.#columns.filter((column) => columnKind(schema[column]?.type ?? "unknown") === "numeric");
  }

  /**
   * Reject a non-numeric column before any computation.
   *
   * Arithmetic on text silently yields `null` deep inside a formula; failing at the call
   * site names the column that is wrong. Uses `columnKind` rather than comparing against
   * `"number"`, because `integer` is a separate dtype and is equally numeric.
   */
  #assertNumericColumns(columns: readonly string[], method: string): void {
    const schema = this.schema;
    for (const column of columns) {
      this.#assertColumn(column);
      const type = schema[column]?.type ?? "unknown";
      if (columnKind(type) !== "numeric") {
        throw new ValidationError(`${method}() needs a numeric column, but "${column}" is ${type}.`);
      }
    }
  }

  // ------------------------------------------------------------------------- metrics

  /**
   * Build a reusable, named metric over this dataset.
   *
   * The metric retains this dataset's rows, so it can be recalculated against another
   * dataset and compared across groups without the caller threading data back in.
   */
  createMetric(spec: MetricSpec): Metric {
    return new Metric(spec, this.#rows, this.#columns);
  }

  // ------------------------------------------------------------------------ insights

  /**
   * Defensible observations about this dataset, each carrying its evidence.
   *
   * Deterministic for the same input. Checks that cannot run are reported in `skipped`
   * rather than omitted, so an empty result is never ambiguous.
   */
  insights(options: InsightOptions = {}): InsightReport {
    return analyze({ rows: this.#rows, columns: this.#columns, schema: this.schema }, options);
  }

  // ---------------------------------------------------------------- transformations

  /**
   * Rows that satisfy `predicate`, in their original order.
   *
   * The predicate receives a frozen row record, so an accidental write throws instead of
   * silently altering the dataset.
   */
  filter(predicate: (row: Row, index: number) => boolean): Dataset {
    if (typeof predicate !== "function") {
      throw new ValidationError("filter expects a predicate function.");
    }
    const kept: Row[] = [];
    for (const [index, row] of this.#rows.entries()) {
      if (predicate(row, index)) kept.push(row);
    }
    return this.#derive(kept);
  }

  /**
   * Start a structured query against this dataset.
   *
   * The returned `Query` is an immutable description: nothing runs until `execute()`,
   * which returns a new `Dataset`. Conditions are typed values rather than text, so no
   * query string is ever parsed or evaluated.
   *
   * ```ts
   * data
   *   .query()
   *   .where("revenue", ">", 100)
   *   .and("region", "in", ["North", "West"])
   *   .orderBy("revenue", "desc")
   *   .limit(20)
   *   .execute();
   * ```
   */
  query(): Query<Dataset> {
    const dtypes = this.dtypes;
    // Shape detection scans a column, and a query may compare the same column repeatedly.
    const shapes = new Map<string, ReturnType<typeof detectCellShape>>();
    return new Query<Dataset>({
      columns: this.#columns,
      rows: this.#rows,
      dtypes,
      shapeOf: (column) => {
        let shape = shapes.get(column);
        if (shape === undefined) {
          shape = detectCellShape(this.#rows, column, dtypes[column]);
          shapes.set(column, shape);
        }
        return shape;
      },
      build: (rows, columns) => this.#build(rows, columns),
    });
  }

  /**
   * Split rows into groups by one or more columns.
   *
   * Returns a `GroupedDataset`, which computes nothing until `aggregate()` runs. Groups
   * keep first-appearance order, so the output is deterministic. Rows whose key is missing
   * form their own group with a `null` key rather than being dropped.
   *
   * ```ts
   * data.groupBy("region").aggregate({
   *   totalRevenue: { column: "revenue", op: "sum" },
   *   orderCount: { op: "count" },
   * });
   * ```
   */
  groupBy(...columns: (string | readonly string[])[]): GroupedDataset<Dataset> {
    const requested = columns.flat();
    if (requested.length === 0) {
      throw new ValidationError("groupBy() needs at least one column.");
    }
    for (const column of requested) {
      if (typeof column !== "string" || column.length === 0) {
        throw new ValidationError("groupBy() needs non-empty column names.");
      }
      if (!this.#columns.includes(column)) {
        throw new ColumnNotFoundError(column, this.#columns);
      }
    }
    if (new Set(requested).size !== requested.length) {
      throw new ValidationError("groupBy() received the same column twice.");
    }
    return new GroupedDataset<Dataset>(
      {
        columns: this.#columns,
        rows: this.#rows,
        dtypes: this.dtypes,
        build: (rows, buildColumns) => this.#build(rows, buildColumns),
      },
      requested,
    );
  }

  /**
   * Rows sorted by `column`.
   *
   * Ordering is total and deterministic: nullish values sort last in both directions,
   * numbers and dates compare numerically, everything else compares as text. Ties keep
   * their original relative order (stable), so sorting twice is idempotent.
   */
  sort(column: string, direction: SortDirection = "asc"): Dataset {
    this.#assertColumn(column);
    if (direction !== "asc" && direction !== "desc") {
      throw new ValidationError(`sort direction must be "asc" or "desc", received "${String(direction)}".`);
    }
    const factor = direction === "asc" ? 1 : -1;
    const indexed = this.#rows.map((row, index) => ({ row, index }));
    indexed.sort((left, right) => {
      const leftValue = left.row[column];
      const rightValue = right.row[column];
      // Missing values sort last in both directions, so they are compared before the
      // direction factor is applied; only present values reverse.
      const leftMissing = !isPresent(leftValue);
      const rightMissing = !isPresent(rightValue);
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index;
        return leftMissing ? 1 : -1;
      }
      const comparison = compareValues(leftValue, rightValue);
      return comparison !== 0 ? comparison * factor : left.index - right.index;
    });
    return this.#derive(indexed.map((entry) => entry.row));
  }

  /** A dataset with `columns`, in the requested order. */
  select(columns: readonly string[]): Dataset {
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new ValidationError("select expects a non-empty array of column names.");
    }
    for (const column of columns) this.#assertColumn(column);
    if (new Set(columns).size !== columns.length) {
      throw new ValidationError(`select received duplicate column names: ${columns.join(", ")}.`);
    }
    return this.#build(
      this.#rows.map((row) => {
        const projected: Row = {};
        for (const column of columns) projected[column] = row[column];
        return projected;
      }),
      [...columns],
    );
  }

  /** At most `count` rows from the start. */
  limit(count: number): Dataset {
    const size = requireCount(count, "limit");
    return this.#derive(size >= this.#rows.length ? this.#rows : this.#rows.slice(0, size));
  }

  // ---------------------------------------------------------------- preparation

  /**
   * A dataset without `columns`.
   *
   * Remaining columns keep their original order. Throws `ColumnNotFoundError` for an
   * unknown column, and `ValidationError` if the call would remove every column.
   */
  drop(columns: string | readonly string[]): Dataset {
    const toDrop = typeof columns === "string" ? [columns] : columns;
    if (!Array.isArray(toDrop) || toDrop.length === 0) {
      throw new ValidationError("drop expects a column name or a non-empty array of column names.");
    }
    const result = dropColumns(this.#rows, this.#columns, toDrop);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with `mapping` applied to column names.
   *
   * Renaming preserves each column's position and every value it holds. Throws
   * `ColumnNotFoundError` for an unknown source column and `ValidationError` when the
   * mapping would produce a duplicate or blank name.
   */
  rename(mapping: Readonly<Record<string, string>>): Dataset {
    if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new ValidationError("rename expects an object mapping old names to new names.");
    }
    const result = renameColumns(this.#rows, this.#columns, mapping);
    return this.#build(result.rows, result.columns);
  }

  /**
   * Rows whose considered cells are all present.
   *
   * With `how: "any"` (the default) a row is dropped as soon as one considered cell is
   * missing; `how: "all"` keeps a row unless every considered cell is missing.
   */
  dropMissing(options: DropMissingOptions = {}): Dataset {
    const result = dropMissingRows(this.#rows, this.#columns, options);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with missing cells replaced.
   *
   * Pass one strategy for every column or a per-column mapping. Strategies are `"mean"`,
   * `"median"`, `"mode"`, a constant, or a `(row, index) => value` callback. `"mean"` and
   * `"median"` require a numeric column and throw `ValidationError` otherwise, rather than
   * coercing text. A column with no present values is left untouched.
   */
  fillMissing(strategyOrMapping: FillStrategy | Readonly<Record<string, FillStrategy>>): Dataset {
    const result = fillMissingValues(this.#rows, this.#columns, strategyOrMapping);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with values replaced, per column.
   *
   * Each column takes a rule or a list of rules applied in order. A rule matches by
   * value (`{ from, to }`, where `from` may be an array), by predicate
   * (`{ match, to }`), or by transformation (`(value, context) => value`). Comparison is
   * by value and type, so `1` does not match `"1"`. Only listed columns are touched.
   */
  replace(rules: Readonly<Record<string, ReplaceRule | readonly ReplaceRule[]>>): Dataset {
    if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
      throw new ValidationError("replace expects an object mapping column names to rules.");
    }
    const result = replaceValues(this.#rows, this.#columns, rules);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with one column transformed by `callback(value, row, index)`.
   *
   * Every other column keeps its value, and the callback sees the row as it was before
   * the transformation. A callback that throws produces a `ValidationError` naming the
   * operation, row, and column, with the original error as `cause`.
   */
  map(column: string, callback: (value: unknown, row: Row, index: number) => unknown): Dataset {
    const result = mapColumn(this.#rows, this.#columns, column, callback);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with `name` appended as the last column.
   *
   * `spec` is either `(row, index) => value` or an array of values, one per row. Throws
   * `ValidationError` when the name already exists, when the array length does not match
   * the row count, or when the name is blank.
   */
  addColumn(name: string, spec: ((row: Row, index: number) => unknown) | readonly unknown[]): Dataset {
    const result = addColumn(this.#rows, this.#columns, name, spec);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset with columns converted to explicit types.
   *
   * Accepts the same type names and `{ type, format }` descriptors as the loader `schema`
   * option. A cell that cannot be converted throws `ValidationError` naming the row and
   * column; nothing is coerced silently and no value is dropped.
   */
  cast(schema: Readonly<Record<string, ColumnType | ColumnTypeSpec>>): Dataset {
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      throw new ValidationError("cast expects an object mapping column names to types.");
    }
    const result = castColumns(this.#rows, this.#columns, schema);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A dataset keeping the first row of each distinct combination.
   *
   * With no `columns`, the whole row is compared. Comparison is by value and type, and
   * `null` and `undefined` are treated as the same value, matching `dropMissing`.
   */
  dropDuplicates(columns?: string | readonly string[]): Dataset {
    const subset = typeof columns === "string" ? [columns] : columns;
    if (subset !== undefined && (!Array.isArray(subset) || subset.length === 0)) {
      throw new ValidationError("dropDuplicates expects a non-empty array of column names.");
    }
    const result = dropDuplicateRows(this.#rows, this.#columns, subset);
    return this.#build(result.rows, result.columns);
  }

  /**
   * A random sample of `count` rows, in draw order.
   *
   * Supplying `seed` makes the draw reproducible: the same seed and row count return the
   * same rows in the same order on every call and every run. Without a seed the draw uses
   * `Math.random`. Sampling without replacement is the default and throws
   * `ValidationError` when `count` exceeds the row count; pass `{ replace: true }` to
   * sample with replacement.
   */
  sample(count: number, options: SampleOptions = {}): Dataset {
    const result = sampleRows(this.#rows, this.#columns, count, options);
    return this.#build(result.rows, result.columns);
  }

  // ---------------------------------------------------------------- output

  /** Render as a table. Defaults to 1000 rows; see `TableOptions`. */
  table(options: TableOptions = {}): string {
    return renderTable(this.#rows, this.#columns, options);
  }

  /** Alias of `table()`, kept for familiarity with prior tooling. */
  toTable(options: TableOptions = {}): string {
    return this.table(options);
  }

  /** Print the table and return the dataset for chaining. */
  display(options: TableOptions = {}): this {
    console.log(this.table(options));
    return this;
  }

  /** JSON-safe representation. */
  toJSON(): {
    name: string;
    columns: string[];
    shape: [number, number];
    rows: Row[];
    metadata: Record<string, unknown>;
  } {
    return {
      name: this.name,
      columns: [...this.#columns],
      shape: [this.rowCount, this.columnCount],
      rows: this.data as Row[],
      metadata: { ...this.metadata },
    };
  }

  // ---------------------------------------------------------------- internals

  #derive(rows: readonly Row[]): Dataset {
    return this.#build(rows, this.#columns);
  }

  /**
   * Build a derived dataset with an explicit column set.
   *
   * The import report is dropped: its row counts and warnings describe the source import,
   * not the prepared result. Name, metadata, and the normalization policy carry over so a
   * chain keeps its identity.
   */
  #build(rows: readonly Row[], columns: readonly string[]): Dataset {
    const { importReport: _discarded, ...inherited } = this.#options;
    return new Dataset(rows, {
      ...inherited,
      columns,
      name: this.name,
      metadata: this.metadata,
      [NORMALIZED]: true,
    });
  }

  #columnValues(column: string): unknown[] {
    const values = new Array<unknown>(this.#rows.length);
    for (let index = 0; index < this.#rows.length; index += 1) {
      values[index] = this.#rows[index]?.[column];
    }
    return values;
  }

  #assertColumn(name: string): void {
    if (!this.#columns.includes(name)) throw new ColumnNotFoundError(name, this.#columns);
  }
}

/** Create a dataset from records, column-oriented data, or another dataset. */
export function createDataset(
  input: readonly Row[] | Readonly<Record<string, readonly unknown[]>> | Dataset,
  options: DatasetOptions = {},
): Dataset {
  if (input instanceof Dataset) {
    return new Dataset(input.data, {
      ...options,
      columns: options.columns ?? input.columns,
      name: options.name ?? input.name,
      [NORMALIZED]: true,
    });
  }

  if (Array.isArray(input)) {
    const rows = input as readonly Row[];
    for (const [index, row] of rows.entries()) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw new ValidationError(`Row ${index} must be an object of column values.`);
      }
    }
    return new Dataset(rows, options);
  }

  if (input === null || typeof input !== "object") {
    throw new ValidationError("createDataset expects an array of records, a column-oriented object, or a Dataset.");
  }

  const columns = Object.keys(input);
  const lengths = new Set<number>();
  for (const column of columns) {
    const values = (input as Record<string, unknown>)[column];
    if (!Array.isArray(values)) {
      throw new ValidationError(`Column-oriented input: "${column}" must be an array of values.`);
    }
    lengths.add(values.length);
  }
  if (lengths.size > 1) {
    throw new ValidationError("Column-oriented input must have arrays of equal length.");
  }

  const first = columns[0];
  const rowCount = first === undefined ? 0 : (input as Record<string, readonly unknown[]>)[first]!.length;
  const rows: Row[] = new Array(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    const row: Row = {};
    for (const column of columns) {
      row[column] = (input as Record<string, readonly unknown[]>)[column]![index] ?? null;
    }
    rows[index] = row;
  }

  return new Dataset(rows, { ...options, columns: options.columns ?? columns });
}

/** Build a dataset from rows that a parser has already normalized and validated. */
export function createNormalizedDataset(
  rows: readonly Row[],
  options: DatasetOptions & {
    importReport: ImportReport;
    columns: readonly string[];
    normalizationPolicy: NormalizationPolicy;
  },
): Dataset {
  return new Dataset(rows, { ...options, [NORMALIZED]: true });
}

function inferColumns(rows: readonly Row[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

function validateColumnNames(columns: readonly string[]): void {
  const seen = new Set<string>();
  for (const column of columns) {
    if (typeof column !== "string" || column.trim() === "") {
      throw new ValidationError("Column names must be non-empty strings.");
    }
    if (seen.has(column)) throw new ValidationError(`Duplicate column name: "${column}".`);
    seen.add(column);
  }
}

/** Sort order accepted by `Dataset.sort`. */
export type SortDirection = "asc" | "desc";

function requireCount(value: number, method: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${method} expects a non-negative integer, received ${String(value)}.`);
  }
  return value;
}

function estimateBytes(rows: readonly Row[], columns: readonly string[]): number {
  let bytes = 0;
  for (const row of rows) {
    for (const column of columns) {
      const value = row[column];
      if (value === null || value === undefined) bytes += 8;
      else if (typeof value === "number") bytes += 8;
      else if (typeof value === "boolean") bytes += 4;
      else if (value instanceof Date) bytes += 24;
      else bytes += String(value).length * 2;
    }
  }
  return bytes;
}

export { stableKey };
