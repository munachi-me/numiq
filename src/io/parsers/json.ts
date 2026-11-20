import type { Dataset } from "../../core/dataset.js";
import type { Row } from "../../core/types.js";
import type { JsonOptions, LoadOptions } from "../types.js";
import { FormatError, ValidationError } from "../../errors/index.js";
import { createNormalizedDataset } from "../../core/dataset.js";
import { isRecord } from "../../utils/values.js";
import { resolveNormalization } from "../normalization/policy.js";
import { ReportBuilder } from "../normalization/report.js";
import { CastFailure, normalizeAndCast, resolveCast, type ColumnCast } from "../normalization/schema.js";

/** Parse JSON text (or an already-parsed value) into a dataset. Synchronous. */
export function parseJSON(
  input: string | unknown,
  options: JsonOptions & LoadOptions & { source?: string; contentType?: string } = {},
): Dataset {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new FormatError("Input is not valid JSON.");
    }
  }

  const source = options.source ?? "memory";
  const policy = resolveNormalization(options.normalization);
  const report = new ReportBuilder("json", source, policy);
  const skipRows = requireSkipRows(options.skipRows);

  const { columns, records } = shape(value, options, report);
  report.rowsRead = Math.max(0, records.length - skipRows);

  const remaining = records.slice(Math.min(skipRows, records.length));
  const casts = buildCasts(options.schema, columns);
  const onInvalid = options.onInvalid ?? "error";
  if (onInvalid !== "error" && onInvalid !== "null") {
    throw new ValidationError(`onInvalid must be "error" or "null", received "${String(onInvalid)}".`);
  }

  const rows: Row[] = [];
  for (const [recordIndex, record] of remaining.entries()) {
    const lineNumber = recordIndex + 1;
    const row: Row = {};
    for (const column of columns) {
      row[column] = convertCell(record[column], casts[column], policy, onInvalid, report, lineNumber, column);
    }
    rows.push(row);
  }

  const importReport = report.build(rows, columns, {
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

function shape(value: unknown, options: JsonOptions, report: ReportBuilder): { columns: string[]; records: Row[] } {
  if (Array.isArray(value)) return shapeArray(value, options, report);
  if (isRecord(value)) return shapeColumnOriented(value, options);
  if (value === null) throw new FormatError("JSON input is null; expected an array of records or an object.");
  throw new FormatError(
    `JSON input is a ${typeof value}; expected an array of records, an array of arrays, or a column-oriented object.`,
  );
}

function shapeArray(
  value: readonly unknown[],
  options: JsonOptions,
  report: ReportBuilder,
): {
  columns: string[];
  records: Row[];
} {
  if (value.length === 0) {
    return { columns: options.columns ? [...options.columns] : [], records: [] };
  }

  if (value.every((entry) => Array.isArray(entry))) {
    const columns = options.columns ? [...options.columns] : [];
    if (columns.length === 0) {
      throw new FormatError("JSON arrays of arrays require an explicit `columns` option.");
    }
    const records = value.map((entry, index) => {
      const cells = entry as readonly unknown[];
      if (cells.length !== columns.length) {
        report.warn(
          "ragged-row",
          `Row ${index + 1} has ${cells.length} values but ${columns.length} columns are expected.`,
          { row: index + 1 },
        );
      }
      const record: Row = {};
      for (const [columnIndex, column] of columns.entries()) record[column] = cells[columnIndex] ?? null;
      return record;
    });
    return { columns, records };
  }

  if (!value.every((entry) => isRecord(entry))) {
    throw new FormatError("JSON record arrays must contain only objects, or only arrays with a `columns` option.");
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const record of value as readonly Record<string, unknown>[]) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  if (options.columns) {
    for (const column of options.columns) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }

  const records = (value as readonly Record<string, unknown>[]).map((record) => {
    const row: Row = {};
    for (const column of columns) row[column] = record[column] ?? null;
    return row;
  });
  return { columns, records };
}

function shapeColumnOriented(
  value: Record<string, unknown>,
  options: JsonOptions,
): { columns: string[]; records: Row[] } {
  const columns = Object.keys(value);
  if (columns.length === 0) {
    return { columns: options.columns ? [...options.columns] : [], records: [] };
  }

  const lengths = new Set<number>();
  for (const column of columns) {
    const series = value[column];
    if (!Array.isArray(series)) {
      throw new FormatError(
        `JSON object property "${column}" is not an array. A column-oriented object must map names to arrays.`,
      );
    }
    lengths.add(series.length);
  }
  if (lengths.size > 1) {
    throw new FormatError(
      `Column-oriented JSON arrays must have equal lengths; found lengths ${[...lengths].sort((a, b) => a - b).join(", ")}.`,
    );
  }

  const rowCount = lengths.values().next().value ?? 0;
  const records: Row[] = new Array(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    const row: Row = {};
    for (const column of columns) row[column] = (value[column] as readonly unknown[])[index] ?? null;
    records[index] = row;
  }
  return { columns, records };
}

function convertCell(
  raw: unknown,
  cast: ColumnCast | undefined,
  policy: ReturnType<typeof resolveNormalization>,
  onInvalid: "error" | "null",
  report: ReportBuilder,
  row: number,
  column: string,
): unknown {
  try {
    return normalizeAndCast(raw, policy, cast).value;
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

function buildCasts(schema: JsonOptions["schema"], columns: readonly string[]): Record<string, ColumnCast> {
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
