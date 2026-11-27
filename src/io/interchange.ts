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

/** Every dtype this version can describe. */
const DTYPES: readonly DType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
  "unknown",
  "mixed",
];
const ROLES: readonly ColumnDescriptor["role"][] = ["measure", "dimension", "temporal"];

/**
 * Why `value` is not JSON-safe metadata, or `null` when it is.
 *
 * The interchange contract promises a payload `JSON.stringify()` can serialise, so metadata
 * that would break it has to be refused at the boundary rather than discovered later by a
 * consumer whose `JSON.stringify` throws on a BigInt. Values are *checked*, never converted:
 * turning a function into a string would smuggle a meaningless value past the caller.
 *
 * `Date` is accepted because it serialises to an ISO string by definition. `undefined` is
 * rejected rather than dropped, because dropping it would silently change the metadata.
 */
function metadataProblem(value: unknown, path: string, seen: Set<object>): string | null {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return null;
  if (type === "number") {
    return Number.isFinite(value as number) ? null : `${path} is ${String(value)}, which JSON cannot represent.`;
  }
  if (type === "bigint") return `${path} is a BigInt, which JSON cannot represent.`;
  if (type === "function") return `${path} is a function, which JSON cannot represent.`;
  if (type === "symbol") return `${path} is a symbol, which JSON cannot represent.`;
  if (type === "undefined") return `${path} is undefined; use null for an absent value.`;
  if (type !== "object") return `${path} is a ${type}, which JSON cannot represent.`;

  const object = value as object;
  if (seen.has(object)) return `${path} is a circular reference, which JSON cannot represent.`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? `${path} is an invalid Date.` : null;
  }
  seen.add(object);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const problem = metadataProblem(value[index], `${path}[${index}]`, seen);
      if (problem !== null) return problem;
    }
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      const name = (value as { constructor?: { name?: string } }).constructor?.name ?? "object";
      return `${path} is a ${name}; only plain objects, arrays, and JSON primitives are supported.`;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const problem = metadataProblem(item, `${path}.${key}`, seen);
      if (problem !== null) return problem;
    }
  }
  seen.delete(object);
  return null;
}

/** Throw unless `metadata` can be serialised with `JSON.stringify()`. */
function assertJsonSafeMetadata(metadata: unknown, owner: string): void {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError(`${owner} metadata must be an object.`);
  }
  const problem = metadataProblem(metadata, "metadata", new Set());
  if (problem !== null) throw new ValidationError(`${owner} ${problem}`);
}

/**
 * Why `value` is not a readable version-1 payload, or `null` when it is.
 *
 * Returns a message rather than a boolean so `fromInterchange()` can say what is wrong;
 * `isInterchangePayload()` is the boolean face of the same check. The checks follow the
 * declared contract rather than a subset of it: a payload whose `rowCount` disagrees with
 * `rows.length` is not a table a consumer can trust, and truncating or padding it would hide
 * the disagreement instead of reporting it.
 */
function payloadProblem(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return 'expected a payload object with format "numiq.table" and version 1.';
  }
  const payload = value as Record<string, unknown>;
  if (payload.format !== "numiq.table") {
    return `format must be "numiq.table", received ${JSON.stringify(payload.format) ?? String(payload.format)}.`;
  }
  if (payload.version !== 1) {
    return `version must be 1, received ${JSON.stringify(payload.version) ?? String(payload.version)}.`;
  }
  if (typeof payload.name !== "string") return "name must be a string.";

  const { columns, rows } = payload;
  if (!Array.isArray(columns)) return "columns must be an array.";
  if (!Array.isArray(rows)) return "rows must be an array.";

  for (let index = 0; index < columns.length; index += 1) {
    const problem = columnProblem(columns[index], index);
    if (problem !== null) return problem;
  }

  if (!isCount(payload.rowCount)) return "rowCount must be a non-negative integer.";
  if (!isCount(payload.columnCount)) return "columnCount must be a non-negative integer.";
  if (payload.columnCount !== columns.length) {
    return `columnCount is ${payload.columnCount} but ${columns.length} column descriptors were supplied.`;
  }
  if (payload.rowCount !== rows.length) {
    return `rowCount is ${payload.rowCount} but ${rows.length} rows were supplied.`;
  }
  if (payload.missingValue !== null) {
    return `missingValue must be null, received ${JSON.stringify(payload.missingValue) ?? String(payload.missingValue)}.`;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row)) return `row ${index} is not an array.`;
    if (row.length !== columns.length) {
      return `row ${index} has ${row.length} cells but there are ${columns.length} columns.`;
    }
  }

  if (payload.metadata === undefined || payload.metadata === null) return "metadata must be an object.";
  if (typeof payload.metadata !== "object" || Array.isArray(payload.metadata)) return "metadata must be an object.";
  const metadataIssue = metadataProblem(payload.metadata, "metadata", new Set());
  if (metadataIssue !== null) return metadataIssue;
  return null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function columnProblem(value: unknown, index: number): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `column ${index} is not an object.`;
  }
  const column = value as Record<string, unknown>;
  if (typeof column.name !== "string" || column.name === "") {
    return `column ${index} needs a non-empty name.`;
  }
  if (typeof column.type !== "string" || !DTYPES.includes(column.type as DType)) {
    return `column ${index} has type ${JSON.stringify(column.type) ?? String(column.type)}, which is not a Numiq dtype.`;
  }
  if (typeof column.nullable !== "boolean") return `column ${index} nullable must be a boolean.`;
  if (!ROLES.includes(column.role as ColumnDescriptor["role"])) {
    return `column ${index} role must be "measure", "dimension", or "temporal".`;
  }
  return null;
}

/**
 * Build the interchange payload a consumer such as Numviz reads.
 *
 * The payload is plain JSON-safe data with a `format` marker and a `version`, so a
 * consumer can check what it received before reading it. Numiq never imports Numviz and
 * Numviz never needs Numiq's classes: this object is the whole boundary.
 *
 * Metadata is copied only if it survives `JSON.stringify()`, so the promise holds for the
 * payload as a whole rather than for every part of it except metadata.
 */
export function toInterchange(dataset: Dataset): InterchangePayload {
  assertJsonSafeMetadata(dataset.metadata, "toInterchange()");
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
  return payloadProblem(value) === null;
}

/** Rebuild a dataset from an interchange payload. */
export function fromInterchange(payload: InterchangePayload): Dataset {
  const problem = payloadProblem(payload);
  if (problem !== null) {
    throw new ValidationError(`fromInterchange() needs a valid version-1 payload: ${problem}`);
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
