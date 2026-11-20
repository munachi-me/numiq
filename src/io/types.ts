import type { ColumnType, ColumnTypeSpec, ImportReport, NormalizationPolicy } from "../core/types.js";

/** Formats the parsers understand. Excel is deliberately absent. */
export type ImportFormat = "csv" | "tsv" | "json";

/** Anything a loader can read without filesystem access. */
export type Source = string | URL | Blob | ArrayBuffer | Uint8Array;

/** Options shared by every loader. */
export interface LoadOptions {
  name?: string;
  metadata?: Record<string, unknown>;
  /** Only used by `loadURL`. */
  signal?: AbortSignal;
  /** Only used by `loadURL`. */
  headers?: Record<string, string>;
  /** Only used by `loadURL`. Defaults to 30 seconds. */
  timeoutMs?: number;
}

/** CSV/TSV parse options. */
export interface CsvOptions {
  /** Single-character field separator. Detected when omitted. */
  delimiter?: string;
  /** Treat the first non-skipped row as column names. Default true. */
  header?: boolean;
  /** Column names used when `header` is false. */
  columns?: readonly string[];
  /** Rows to discard before header detection. Default 0. */
  skipRows?: number;
  /** Explicit per-column type conversion. */
  schema?: Record<string, ColumnType | ColumnTypeSpec>;
  /** What to do with a cell that fails an explicit cast. Default `"error"`. */
  onInvalid?: "error" | "null";
  /** What to do with a row whose width differs from the header. Default `"error"`. */
  onRaggedRow?: "error" | "pad";
  /** Cell normalization overrides. */
  normalization?: Partial<NormalizationPolicy>;
}

/** JSON parse options. */
export interface JsonOptions {
  /** Column names for arrays-of-arrays input. */
  columns?: readonly string[];
  skipRows?: number;
  schema?: Record<string, ColumnType | ColumnTypeSpec>;
  onInvalid?: "error" | "null";
  normalization?: Partial<NormalizationPolicy>;
}

/** Format selection for `loadURL`, where the extension is not authoritative. */
export interface FormatOptions {
  format?: ImportFormat;
  contentType?: string;
}

export type { ImportReport, NormalizationPolicy };
