/**
 * Interoperability: ordinary JavaScript shapes in and out, plus the interchange contract
 * a consumer such as Numviz reads.
 *
 * A `Dataset` is convenient inside Numiq and awkward at its edges — a chart library wants
 * an array of records or a header plus rows, not a class. These functions convert without
 * exposing any internal representation, so a consumer never needs to know how a `Dataset`
 * stores its rows.
 *
 * The missing-value representation is part of the contract: `null`, never `undefined`, and
 * never `NaN`. A chart that receives `undefined` cannot tell "missing" from "not present";
 * a chart that receives `NaN` draws a broken axis.
 */
import { ValidationError } from "../errors/index.js";
import { Dataset, createDataset } from "../core/dataset.js";
import type { DType } from "../core/types.js";

/** A table as a header plus rows of cells: the shape most chart libraries accept. */
export interface TableData {
  /** Column names, in order. */
  readonly columns: readonly string[];
  /** Row-major cells, aligned with `columns`. Missing values are `null`. */
  readonly rows: readonly (readonly unknown[])[];
}

/** One column described for a consumer that does not share Numiq's types. */
export interface ColumnDescriptor {
  readonly name: string;
  /** Numiq's dtype, e.g. `"number"`, `"integer"`, `"date"`. */
  readonly type: DType;
  /** Whether any row holds `null`. */
  readonly nullable: boolean;
  /** How a consumer should read the values. */
  readonly role: "measure" | "dimension" | "temporal";
}

/** The full interchange contract: everything a chart needs, and nothing about the class. */
export interface InterchangePayload {
  /** Format marker, so a consumer can reject a payload it does not understand. */
  readonly format: "numiq.table";
  /** Contract version. Consumers should check this before reading. */
  readonly version: 1;
  readonly name: string;
  readonly columns: readonly ColumnDescriptor[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  readonly columnCount: number;
  /** The representation used for absent values. Always `null`. */
  readonly missingValue: null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Options for `toCSV()`. */
export interface ToCsvOptions {
  /** Field separator. Defaults to `","`. */
  readonly delimiter?: string;
  /** Line ending. Defaults to `"\n"`. */
  readonly newline?: string;
  /** Whether to write the header row. Defaults to `true`. */
  readonly header?: boolean;
}

const TEMPORAL: readonly DType[] = ["date", "datetime", "time"];
const NUMERIC: readonly DType[] = ["number", "integer"];

/** How a consumer should treat a column, derived from its dtype. */
export function columnRole(type: DType): ColumnDescriptor["role"] {
  if (NUMERIC.includes(type)) return "measure";
  if (TEMPORAL.includes(type)) return "temporal";
  return "dimension";
}

/** Convert a dataset to a header plus row-major cells. */
export function toTableData(dataset: Dataset): TableData {
  const columns = [...dataset.columns];
  const rows = dataset.data.map((row) => columns.map((column) => row[column] ?? null));
  return { columns, rows };
}

/**
 * Convert a dataset to an array of plain records.
 *
 * Each record is a fresh object with the dataset's own column keys, so a consumer can
 * mutate it, serialise it, or hand it to `JSON.stringify` without touching the dataset.
 */
export function toObjects(dataset: Dataset): Record<string, unknown>[] {
  return dataset.data.map((row) => ({ ...row }));
}

/**
 * Build a dataset from a header plus row-major cells.
 *
 * The inverse of `toTableData()`. A short row is padded with `null` and a long row is
 * truncated only when `strict` is false (the default); with `strict` either case throws,
 * because a silent reshape is how a column ends up off by one.
 */
export function fromTableData(table: TableData, options: { name?: string; strict?: boolean } = {}): Dataset {
  if (table === null || typeof table !== "object" || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new ValidationError("fromTableData() needs { columns, rows }.");
  }
  if (table.columns.length === 0) {
    throw new ValidationError("fromTableData() needs at least one column.");
  }
  const strict = options.strict ?? false;
  const rows = table.rows.map((cells, index) => {
    if (!Array.isArray(cells)) {
      throw new ValidationError(`fromTableData() row ${index} is not an array.`);
    }
    if (strict && cells.length !== table.columns.length) {
      throw new ValidationError(
        `fromTableData() row ${index} has ${cells.length} cells but there are ${table.columns.length} columns.`,
      );
    }
    const record: Record<string, unknown> = {};
    for (let column = 0; column < table.columns.length; column += 1) {
      record[table.columns[column] as string] = cells[column] ?? null;
    }
    return record;
  });
  return createDataset(rows, {
    columns: [...table.columns],
    ...(options.name === undefined ? {} : { name: options.name }),
  });
}

/** Quote a CSV field when it holds a delimiter, quote, or line break. */
function csvField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Render a dataset as CSV text.
 *
 * Missing values become empty fields, which is what every spreadsheet reads as blank. The
 * output round-trips through `parseDelimited()` for the dtypes Numiq infers.
 */
export function toCSV(dataset: Dataset, options: ToCsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const newline = options.newline ?? "\n";
  if (delimiter.length !== 1) throw new ValidationError("toCSV() delimiter must be a single character.");
  const columns = [...dataset.columns];
  const lines: string[] = [];
  if (options.header ?? true) lines.push(columns.map((column) => csvField(column, delimiter)).join(delimiter));
  for (const row of dataset.data) {
    lines.push(columns.map((column) => csvField(row[column], delimiter)).join(delimiter));
  }
  return lines.join(newline);
}

/**
 * Build the interchange payload a consumer such as Numviz reads.
 *
 * The payload is plain JSON-safe data with a `format` marker and a `version`, so a
 * consumer can check what it received before reading it. Numiq never imports Numviz and
 * Numviz never needs Numiq's classes: this object is the whole boundary.
 */
export function toInterchange(dataset: Dataset): InterchangePayload {
  const schema = dataset.schema;
  const columns: ColumnDescriptor[] = dataset.columns.map((name) => {
    const type = schema[name]?.type ?? "unknown";
    return { name, type, nullable: schema[name]?.nullable ?? false, role: columnRole(type) };
  });
  const rows = dataset.data.map((row) => dataset.columns.map((column) => row[column] ?? null));
  return {
    format: "numiq.table",
    version: 1,
    name: dataset.name,
    columns,
    rows,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    missingValue: null,
    metadata: dataset.metadata,
  };
}

/** True when `value` is a payload this version of Numiq can read. */
export function isInterchangePayload(value: unknown): value is InterchangePayload {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<InterchangePayload>;
  return (
    candidate.format === "numiq.table" &&
    candidate.version === 1 &&
    Array.isArray(candidate.columns) &&
    Array.isArray(candidate.rows)
  );
}

/** Rebuild a dataset from an interchange payload. */
export function fromInterchange(payload: InterchangePayload): Dataset {
  if (!isInterchangePayload(payload)) {
    throw new ValidationError('fromInterchange() needs a payload with format "numiq.table" and version 1.');
  }
  const names = payload.columns.map((column) => column.name);
  const rows = payload.rows.map((cells) => {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < names.length; index += 1) {
      record[names[index] as string] = cells[index] ?? null;
    }
    return record;
  });
  return createDataset(rows, { columns: names, name: payload.name, metadata: payload.metadata });
}
