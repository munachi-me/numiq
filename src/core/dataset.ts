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
} from "./types.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { renderTable } from "../display/table.js";
import { cloneValue, deepFreeze, isPresent, stableKey } from "../utils/values.js";
import { countUnique, describeColumn, distinctValues, inferColumnType } from "./schema.js";
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
    return new Dataset(
      this.#rows.map((row) => {
        const projected: Row = {};
        for (const column of columns) projected[column] = row[column];
        return projected;
      }),
      {
        columns: [...columns],
        name: this.name,
        metadata: this.metadata,
        ...(this.#options.normalizationPolicy === undefined
          ? {}
          : { normalizationPolicy: this.#options.normalizationPolicy }),
        [NORMALIZED]: true,
      },
    );
  }

  /** At most `count` rows from the start. */
  limit(count: number): Dataset {
    const size = requireCount(count, "limit");
    return this.#derive(size >= this.#rows.length ? this.#rows : this.#rows.slice(0, size));
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
    const { importReport: _discarded, ...inherited } = this.#options;
    return new Dataset(rows, {
      ...inherited,
      columns: this.#columns,
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

/** Order present values only; `sort` handles nullish values before calling this. */
function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return Math.sign(left.getTime() - right.getTime());
  if (typeof left === "number" && typeof right === "number") return Math.sign(left - right);
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

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
