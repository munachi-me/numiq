/** A single tabular record. Values are the normalized cell values. */
export type Row = Record<string, unknown>;

/** Supported column data types. `mixed` means no single type fits every present value. */
export type DType = "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "time" | "unknown" | "mixed";

/** Column types accepted in an import `schema`. */
export type ColumnType = "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "time";

/** Column type with an optional parse format (used for temporal types). */
export interface ColumnTypeSpec {
  type: ColumnType;
  format?: string;
}

/** Inferred description of a single column. */
export interface ColumnSchema {
  name: string;
  type: DType;
  nullable: boolean;
}

/** Warning raised while importing; never thrown. */
export interface ImportWarning {
  code: string;
  message: string;
  row?: number;
  column?: string;
}

/** How cell values are interpreted during import. */
export interface NormalizationPolicy {
  /** Trim surrounding whitespace from string cells. */
  trimStrings: boolean;
  /** Treat empty strings as `null`. */
  emptyStringAsNull: boolean;
  /** Convert numeric and boolean looking strings to their native types. */
  inferTypes: boolean;
  /** Case-insensitive markers treated as `null` in addition to empty strings. */
  nullValues: readonly string[];
}

/** Metadata produced by an import. Never included in analytical results. */
export interface ImportReport {
  format: "csv" | "tsv" | "json";
  source: string;
  rowsRead: number;
  rowsImported: number;
  columns: readonly string[];
  missingByColumn: Readonly<Record<string, number>>;
  warnings: readonly ImportWarning[];
  normalization: Readonly<NormalizationPolicy>;
  delimiter?: string;
  contentType?: string;
}

/** Options accepted by `createDataset`. */
export interface DatasetOptions {
  /** Column order. Required when rows are arrays of values. */
  columns?: readonly string[];
  name?: string;
  metadata?: Readonly<Record<string, unknown>>;
  /** Applied to raw input cells; ignored for already-normalized imports. */
  normalization?: Partial<NormalizationPolicy>;
}

/** Options accepted by `Dataset.table()`. */
export interface TableOptions {
  /** Maximum rows rendered. Default 1000. `Infinity` renders all. */
  maxRows?: number;
  /** Maximum columns rendered. Default 20. */
  maxColumns?: number;
  /** Maximum characters per cell before truncation. Default 28. */
  maxCellWidth?: number;
  /** Render the `idx` row-label column. Default true. */
  showIndex?: boolean;
  /** Render the trailing row/column summary line. Default true. */
  showShape?: boolean;
}

/** A read-only view of one column. */
export interface ColumnView {
  name: string;
  type: DType;
  values: readonly unknown[];
  missing: number;
  unique: number;
}

/** Summary returned by `Dataset.info()`. */
export interface DatasetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  shape: readonly [number, number];
  dtypes: Readonly<Record<string, DType>>;
  missingValues: number;
  memoryHint: string;
}
