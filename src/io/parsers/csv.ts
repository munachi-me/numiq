import type { Dataset } from "../../core/dataset.js";
import type { CsvOptions, DelimitedFormat, LoadOptions } from "../types.js";
import type { Row } from "../../core/types.js";
import { FormatError, ValidationError } from "../../errors/index.js";
import { createNormalizedDataset } from "../../core/dataset.js";
import { resolveNormalization } from "../normalization/policy.js";
import { ReportBuilder } from "../normalization/report.js";
import { CastFailure, normalizeAndCast, resolveCast, type ColumnCast } from "../normalization/schema.js";
import { detectDelimiter, tokenize } from "./csv-tokenizer.js";

/**
 * Internal-only option: the number of data records already consumed before this text.
 *
 * `chunkDelimited()` re-parses each chunk on its own, so without this every chunk would
 * report row numbers starting at 1 and a malformed row deep in a file would be reported as
 * being near the top of it. Not part of the public option types.
 */
type RowOffset = { rowOffset?: number };

/** Parse delimited text into a dataset. Synchronous: no I/O happens here. */
export function parseDelimited(
  text: string,
  options: CsvOptions & LoadOptions & { format: DelimitedFormat; source?: string; contentType?: string } & RowOffset,
): Dataset {
  if (typeof text !== "string") throw new ValidationError("Delimited input must be a string.");
  // `format` is required by the type, but untyped callers can omit it. Without this check
  // the report would carry `format: undefined`, and omitting `options` entirely threw a
  // TypeError from reading `.delimiter` off undefined.
  if (options === null || typeof options !== "object") {
    throw new ValidationError('parseDelimited expects an options object with a "format" of "csv" or "tsv".');
  }
  if (options.format !== "csv" && options.format !== "tsv") {
    throw new ValidationError(
      `parseDelimited requires a "format" of "csv" or "tsv" (received ${JSON.stringify(options.format)}). ` +
        "Use parseJSON for JSON input.",
    );
  }
  if (options.delimiter !== undefined && options.delimiter.length !== 1) {
    throw new ValidationError("delimiter must be a single character.");
  }
  if (options.header !== undefined && typeof options.header !== "boolean") {
    throw new ValidationError("header must be true or false.");
  }

  const source = options.source ?? "memory";
  const policy = resolveNormalization(options.normalization);
  const report = new ReportBuilder(options.format, source, policy);
  const skipRows = requireSkipRows(options.skipRows);

  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Sample after the preamble: a report header that uses a different separator must not
  // outvote the real table, which is what happens when detection sees the whole file.
  const delimiter = options.delimiter ?? detectDelimiter(body, 10, skipRows);
  const rawRecords = tokenize(body, delimiter);
  const nonBlank = rawRecords.filter((record) => record.some((cell) => cell.trim() !== ""));
  const remaining = nonBlank.slice(Math.min(skipRows, nonBlank.length));
  const hasHeader = options.header !== false;

  const columns = hasHeader ? readHeader(remaining[0], options.columns, hasHeader) : readHeaderless(remaining, options);
  const dataRecords = hasHeader ? remaining.slice(1) : remaining;
  report.rowsRead = dataRecords.length;

  const casts = buildCasts(options.schema, columns);
  const onRagged = options.onRaggedRow ?? "error";
  if (onRagged !== "error" && onRagged !== "pad") {
    throw new ValidationError(`onRaggedRow must be "error" or "pad", received "${String(onRagged)}".`);
  }
  const onInvalid = options.onInvalid ?? "error";
  if (onInvalid !== "error" && onInvalid !== "null") {
    throw new ValidationError(`onInvalid must be "error" or "null", received "${String(onInvalid)}".`);
  }

  const rows: Row[] = [];
  const rowOffset = options.rowOffset ?? 0;
  for (const [recordIndex, record] of dataRecords.entries()) {
    const lineNumber = rowOffset + recordIndex + 1;
    const values = [...record];

    if (values.length !== columns.length) {
      const message = `Row ${lineNumber} has ${values.length} cells but ${columns.length} columns are expected.`;
      if (onRagged === "error") throw new FormatError(message);
      report.warn("ragged-row", `${message} Extra cells were dropped and missing cells were set to null.`, {
        row: lineNumber,
      });
      values.length = columns.length;
      for (let index = 0; index < columns.length; index += 1) values[index] ??= "";
    }

    const row: Row = {};
    for (const [columnIndex, column] of columns.entries()) {
      row[column] = convertCell(values[columnIndex], casts[column], policy, onInvalid, report, lineNumber, column);
    }
    rows.push(row);
  }

  const importReport = report.build(rows, columns, {
    delimiter,
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
  });
  return createNormalizedDataset(rows, {
    columns,
    name: options.name ?? sourceLabel(source),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    normalizationPolicy: policy,
    importReport,
  });
}

function convertCell(
  raw: string | undefined,
  cast: ColumnCast | undefined,
  policy: ReturnType<typeof resolveNormalization>,
  onInvalid: "error" | "null",
  report: ReportBuilder,
  row: number,
  column: string,
): unknown {
  try {
    const result = normalizeAndCast(raw, policy, cast);
    if (result.issue === "unsafe-integer") {
      report.warn(
        "unsafe-integer",
        `Value in row ${row}, column "${column}" exceeds the safe integer range and was kept as a string.`,
        { row, column },
      );
    }
    return result.value;
  } catch (error) {
    if (!(error instanceof CastFailure)) throw error;
    if (onInvalid === "error") {
      throw new FormatError(`Row ${row}, column "${column}": ${error.message}.`);
    }
    report.warn("invalid-value", `Row ${row}, column "${column}": ${error.message}. Value was set to null.`, {
      row,
      column,
    });
    return null;
  }
}

function readHeader(
  first: readonly string[] | undefined,
  supplied: readonly string[] | undefined,
  hasHeader: boolean,
): string[] {
  if (hasHeader && supplied !== undefined) {
    throw new ValidationError("columns cannot be supplied when header is true; header names come from the file.");
  }
  if (first === undefined) return supplied ? [...supplied] : [];

  const names = first.map((cell, index) => {
    const name = cell.trim();
    if (name === "") throw new ValidationError(`Column ${index + 1} in the header is empty.`);
    return name;
  });

  const seen = new Map<string, number>();
  for (const [index, name] of names.entries()) {
    const previous = seen.get(name);
    if (previous !== undefined) {
      throw new ValidationError(`Duplicate column name "${name}" at header position ${previous + 1} and ${index + 1}.`);
    }
    seen.set(name, index);
  }
  return names;
}

function readHeaderless(records: readonly (readonly string[])[], options: CsvOptions): string[] {
  const width = records.reduce((max, record) => Math.max(max, record.length), 0);
  if (options.columns !== undefined) {
    if (options.columns.length !== width) {
      throw new ValidationError(
        `header is false and ${width} columns of data were found, but ${options.columns.length} column names were supplied.`,
      );
    }
    return [...options.columns];
  }
  return Array.from({ length: width }, (_, index) => `column_${index + 1}`);
}

function buildCasts(
  schema:
    Record<string, import("../../core/types.js").ColumnType | import("../../core/types.js").ColumnTypeSpec> | undefined,
  columns: readonly string[],
): Record<string, ColumnCast> {
  const casts: Record<string, ColumnCast> = {};
  if (schema === undefined) return casts;

  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new ValidationError("schema must map column names to types.");
  }

  const unknown = Object.keys(schema).filter((column) => !columns.includes(column));
  if (unknown.length > 0) {
    throw new ValidationError(`schema references unknown column(s): ${unknown.join(", ")}.`);
  }

  for (const [column, entry] of Object.entries(schema)) casts[column] = resolveCast(entry, column);
  return casts;
}

function requireSkipRows(value: number | undefined): number {
  const skipRows = value ?? 0;
  if (!Number.isInteger(skipRows) || skipRows < 0) {
    throw new ValidationError("skipRows must be a non-negative integer.");
  }
  return skipRows;
}

function sourceLabel(source: string): string {
  if (/^https?:\/\//i.test(source)) {
    try {
      const pathname = new URL(source).pathname;
      const name = pathname.split("/").pop() ?? "";
      return name.replace(/\.[^.]+$/, "") || "Dataset";
    } catch {
      return "Dataset";
    }
  }
  const name = source.split(/[\\/]/).pop() ?? source;
  return name.replace(/\.[^.]+$/, "") || "Dataset";
}
