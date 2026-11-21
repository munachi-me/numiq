/**
 * Reshaping: pivot wide, melt long, and bind rows.
 *
 * Each function returns a fresh table; none mutates its input. Column order is derived
 * from the data in first-appearance order rather than from a sort, so a reshape is
 * reproducible without assuming anything about the value types.
 */
import type { Row } from "./types.js";
import type { PreparedTable } from "./prepare.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";

/** Aggregation applied when several rows land in one pivot cell. */
export type PivotAggregation = "first" | "last" | "sum" | "mean" | "min" | "max" | "count";

/** Options for `pivot`. */
export interface PivotOptions {
  /** Column whose distinct values become the new column names. */
  readonly columns: string;
  /** Column holding the cell values. */
  readonly values: string;
  /** How to combine multiple rows per cell. Defaults to `"first"`. */
  readonly aggregate?: PivotAggregation;
  /**
   * Columns kept as row identity. Defaults to every column not named by `columns` or
   * `values`, which is usually what a caller means.
   */
  readonly index?: string | readonly string[];
  /** Name for the column that collects the original value-column names in `melt`. */
  readonly prefix?: string;
}

/** Result of a pivot, with the generated column names reported. */
export interface PivotResult extends PreparedTable {
  /** Generated columns, in first-appearance order of the pivoted values. */
  readonly pivoted: readonly string[];
  /** Number of input rows that shared a cell and had to be combined. */
  readonly collapsed: number;
}

/** Options for `melt`. */
export interface MeltOptions {
  /** Columns kept as-is; every other column is unpivoted. */
  readonly idVars?: string | readonly string[];
  /** Columns to unpivot. Defaults to every column not in `idVars`. */
  readonly valueVars?: string | readonly string[];
  /** Name of the column holding the former column names. Defaults to `"variable"`. */
  readonly variableName?: string;
  /** Name of the column holding the former cell values. Defaults to `"value"`. */
  readonly valueName?: string;
  /** Drop rows whose value is missing rather than emitting a null. */
  readonly dropMissing?: boolean;
}

const AGGREGATIONS: ReadonlySet<string> = new Set(["first", "last", "sum", "mean", "min", "max", "count"]);

function toArray(value: string | readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) throw new ValidationError("Expected a column name or an array of names.");
  return value;
}

function requireColumn(columns: readonly string[], column: string, method: string): void {
  if (!columns.includes(column)) {
    const error = new ColumnNotFoundError(column, columns);
    error.message = `${method}: ${error.message}`;
    throw error;
  }
}

function combine(values: readonly unknown[], aggregation: PivotAggregation): unknown {
  if (aggregation === "first") return values[0] ?? null;
  if (aggregation === "last") return values[values.length - 1] ?? null;
  if (aggregation === "count") return values.length;

  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  }
  if (numbers.length === 0) return null;

  if (aggregation === "sum") return numbers.reduce((total, value) => total + value, 0);
  if (aggregation === "mean") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (aggregation === "min") return numbers.reduce((best, value) => (value < best ? value : best));
  return numbers.reduce((best, value) => (value > best ? value : best));
}

/** Pivot long data into one column per distinct value of `columns`. */
export function pivotRows(rows: readonly Row[], columns: readonly string[], options: PivotOptions): PivotResult {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ValidationError("pivot expects an options object.");
  }
  const { columns: keyColumn, values: valueColumn } = options;
  if (typeof keyColumn !== "string" || keyColumn.trim() === "") {
    throw new ValidationError('pivot expects "columns" to name a column.');
  }
  if (typeof valueColumn !== "string" || valueColumn.trim() === "") {
    throw new ValidationError('pivot expects "values" to name a column.');
  }
  requireColumn(columns, keyColumn, "pivot");
  requireColumn(columns, valueColumn, "pivot");
  if (keyColumn === valueColumn) {
    throw new ValidationError('pivot expects "columns" and "values" to name different columns.');
  }

  const aggregation = options.aggregate ?? "first";
  if (!AGGREGATIONS.has(aggregation)) {
    throw new ValidationError(
      `pivot expects "aggregate" to be one of ${[...AGGREGATIONS].join(", ")}, received "${String(aggregation)}".`,
    );
  }

  const indexColumns = toArray(options.index) ?? columns.filter((c) => c !== keyColumn && c !== valueColumn);

  const buckets = new Map<string, Map<string, unknown[]>>();
  const indexOrder = new Map<string, Row>();
  const pivoted: string[] = [];
  const seenPivots = new Set<string>();

  for (const row of rows) {
    const key = row[keyColumn];
    // A missing pivot key has no column name to become, so those rows are dropped rather
    // than collected under a "null" column that would look like a real category.
    if (!isPresent(key)) continue;

    const label = String(key);
    if (!seenPivots.has(label)) {
      seenPivots.add(label);
      pivoted.push(label);
    }

    const identity = indexColumns.map((column) => stableKey(row[column])).join("\u0001");
    let bucket = buckets.get(identity);
    if (bucket === undefined) {
      bucket = new Map<string, unknown[]>();
      buckets.set(identity, bucket);
      indexOrder.set(identity, row);
    }
    const cell = bucket.get(label);
    if (cell === undefined) bucket.set(label, [row[valueColumn]]);
    else cell.push(row[valueColumn]);
  }

  let collapsed = 0;
  const out: Row[] = [];
  for (const [identity, bucket] of buckets) {
    const source = indexOrder.get(identity) as Row;
    const row: Row = {};
    for (const column of indexColumns) row[column] = cloneValue(source[column]);
    for (const label of pivoted) {
      const cell = bucket.get(label);
      if (cell === undefined) {
        row[label] = null;
        continue;
      }
      if (cell.length > 1) collapsed += cell.length - 1;
      row[label] = cloneValue(combine(cell, aggregation));
    }
    out.push(row);
  }

  const nextColumns = [...indexColumns, ...pivoted];
  const clash = nextColumns.filter((column, position) => nextColumns.indexOf(column) !== position);
  if (clash.length > 0) {
    throw new ValidationError(
      `pivot produced columns that collide with the index columns: ${[...new Set(clash)].join(", ")}. ` +
        "Rename them or exclude them from the index.",
    );
  }

  return {
    rows: out,
    columns: nextColumns,
    pivoted: Object.freeze([...pivoted]),
    collapsed,
  };
}

/** Unpivot wide data into variable/value pairs. */
export function meltRows(rows: readonly Row[], columns: readonly string[], options: MeltOptions = {}): PreparedTable {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ValidationError("melt expects an options object.");
  }

  const idVars = toArray(options.idVars);
  const valueVars = toArray(options.valueVars);

  let ids: readonly string[];
  let values: readonly string[];

  if (idVars !== undefined && valueVars !== undefined) {
    ids = idVars;
    values = valueVars;
  } else if (idVars !== undefined) {
    ids = idVars;
    values = columns.filter((column) => !ids.includes(column));
  } else if (valueVars !== undefined) {
    values = valueVars;
    ids = columns.filter((column) => !values.includes(column));
  } else {
    throw new ValidationError('melt expects "idVars", "valueVars", or both.');
  }

  for (const column of ids) requireColumn(columns, column, "melt");
  for (const column of values) requireColumn(columns, column, "melt");

  const overlap = ids.filter((column) => values.includes(column));
  if (overlap.length > 0) {
    throw new ValidationError(`melt cannot treat a column as both an id and a value: ${overlap.join(", ")}.`);
  }
  if (values.length === 0) {
    throw new ValidationError("melt has no value columns to unpivot.");
  }

  const variableName = options.variableName ?? "variable";
  const valueName = options.valueName ?? "value";
  if (variableName.trim() === "" || valueName.trim() === "") {
    throw new ValidationError("melt expects non-empty variable and value column names.");
  }
  if (variableName === valueName) {
    throw new ValidationError("melt expects distinct variable and value column names.");
  }
  const nextColumns = [...ids, variableName, valueName];
  if (new Set(nextColumns).size !== nextColumns.length) {
    throw new ValidationError(
      `melt produced duplicate column names: ${nextColumns.join(", ")}. Pass distinct "variableName" and "valueName".`,
    );
  }

  const out: Row[] = [];
  for (const row of rows) {
    for (const column of values) {
      const value = row[column];
      if (options.dropMissing === true && !isPresent(value)) continue;
      const next: Row = {};
      for (const id of ids) next[id] = cloneValue(row[id]);
      next[variableName] = column;
      next[valueName] = cloneValue(value);
      out.push(next);
    }
  }

  return { rows: out, columns: nextColumns };
}

/** Options for `concat`. */
export interface ConcatOptions {
  /**
   * Whether columns must match exactly.
   *
   * Defaults to `"union"`, which takes the union of column names in first-appearance
   * order and fills gaps with `null`. `"strict"` requires identical column sets and
   * rejects anything else, which catches a schema drift that a union would hide.
   */
  readonly columns?: "union" | "strict";
}

/** Stack rows from several tables. */
export function concatRows(
  tables: readonly { rows: readonly Row[]; columns: readonly string[] }[],
  options: ConcatOptions = {},
): PreparedTable {
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new ValidationError("concat expects at least one dataset.");
  }
  const mode = options.columns ?? "union";
  if (mode !== "union" && mode !== "strict") {
    throw new ValidationError(`concat expects "columns" to be "union" or "strict", received "${String(mode)}".`);
  }

  const first = tables[0] as { rows: readonly Row[]; columns: readonly string[] };
  if (mode === "strict") {
    tables.forEach((table, position) => {
      const expected = first.columns;
      const same =
        table.columns.length === expected.length &&
        table.columns.every((column: string, index: number) => column === expected[index]);
      if (!same) {
        throw new ValidationError(
          `concat with "strict" columns requires identical column sets; dataset ${position} has ` +
            `${table.columns.join(", ")} but the first has ${first.columns.join(", ")}.`,
        );
      }
    });
  }

  const columns: string[] = [...first.columns];
  if (mode === "union") {
    for (const table of tables) {
      for (const column of table.columns) if (!columns.includes(column)) columns.push(column);
    }
  }

  const out: Row[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      const next: Row = {};
      for (const column of columns) next[column] = table.columns.includes(column) ? cloneValue(row[column]) : null;
      out.push(next);
    }
  }

  return { rows: out, columns };
}
