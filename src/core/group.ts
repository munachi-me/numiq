/**
 * Grouped aggregation.
 *
 * `Dataset.groupBy(...)` returns a `GroupedDataset`: a pure description of how to split
 * rows into groups. Nothing is computed until `aggregate()` runs, which returns an ordinary
 * `Dataset`, so a grouped result composes with queries, sorting, and preparation like any
 * other dataset.
 *
 * ## Group ordering
 *
 * Groups appear in **first-appearance order** of their key, which makes the output
 * deterministic and independent of any hash or sort. Rows keep their source order inside
 * each group, so `first` and `last` are meaningful.
 *
 * ## Missing keys
 *
 * Rows whose key column is missing form their own group rather than being dropped. Silently
 * discarding them is a common source of totals that do not add up, so the group is kept and
 * its key is `null` in the result. Filter it out with `.query().where(key, "isNotNull")`
 * when it is not wanted.
 *
 * ## Missing values inside a group
 *
 * Missing cells are excluded from every aggregation, so a group of `[1, null, 3]` has a
 * `mean` of `2`, not `1.33`. `count` counts rows, while the other aggregations count
 * present values; `nunique` and `count` are the only operations that see a group with no
 * present values as anything other than `null`.
 */
import type { DType, Row } from "./types.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";
import {
  NUMERIC_OPS,
  first,
  isAggregationFn,
  isCustomAggregation,
  last,
  max,
  mean,
  median,
  min,
  nunique,
  std,
  sum,
  toNumbers,
  variance,
} from "./aggregate.js";
import type { AggregateSpec, AggregationEntry, AggregationOp } from "./aggregate.js";

/** A dataset the grouping runs against, supplied by `Dataset.groupBy()`. */
export interface GroupSource<TResult> {
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
  readonly dtypes: Readonly<Record<string, DType>>;
  /** Rebuild a dataset from prepared rows. Supplied by the owning `Dataset`. */
  readonly build: (rows: readonly Row[], columns: readonly string[]) => TResult;
}

/** One resolved group: its key values, in `columns` order, and its rows. */
interface Group {
  readonly key: readonly unknown[];
  readonly rows: readonly Row[];
}

/**
 * Rows split by one or more columns.
 *
 * Instances are immutable; every method returns a new value and the source dataset is never
 * modified.
 */
export class GroupedDataset<TResult> {
  readonly #source: GroupSource<TResult>;
  readonly #columns: readonly string[];

  constructor(source: GroupSource<TResult>, columns: readonly string[]) {
    this.#source = source;
    this.#columns = columns;
  }

  /** The grouping columns, in order. */
  get columns(): readonly string[] {
    return this.#columns;
  }

  /** Number of groups, counting a missing-key group if one exists. */
  get groupCount(): number {
    return this.#groups().length;
  }

  /** Row count of the underlying data, before grouping. */
  get rowCount(): number {
    return this.#source.rows.length;
  }

  /**
   * Number of rows in each group, in group order.
   *
   * A shorthand for the most common aggregation, kept because it needs no spec.
   */
  get sizes(): readonly number[] {
    return this.#groups().map((group) => group.rows.length);
  }

  /** Group keys in order, each as a record of the grouping columns. */
  get keys(): readonly Readonly<Record<string, unknown>>[] {
    return this.#groups().map((group) => {
      const record: Record<string, unknown> = {};
      for (const [index, column] of this.#columns.entries()) record[column] = group.key[index] ?? null;
      return record;
    });
  }

  /**
   * Compute one output column per entry in `spec`.
   *
   * The result is a `Dataset` whose columns are the grouping columns followed by the spec's
   * keys, in the order given. Missing key columns are reported as `null`.
   *
   * ```ts
   * data.groupBy("region").aggregate({
   *   totalRevenue: { column: "revenue", op: "sum" },
   *   orderCount: { op: "count" },
   * });
   * ```
   */
  aggregate(spec: AggregateSpec): TResult {
    const entries = Object.entries(spec);
    if (entries.length === 0) {
      throw new ValidationError("aggregate() needs at least one aggregation.");
    }

    const groups = this.#groups();
    const resolved = entries.map(([name, entry]) => this.#resolve(name, entry));

    const rows: Row[] = groups.map((group) => {
      const row: Row = {};
      for (const [index, column] of this.#columns.entries()) row[column] = cloneValue(group.key[index] ?? null);
      for (const aggregation of resolved) row[aggregation.name] = aggregation.compute(group);
      return row;
    });

    const columns = [...this.#columns, ...resolved.map((aggregation) => aggregation.name)];
    return this.#source.build(rows, columns);
  }

  /**
   * Rows of each group, as a `Dataset` with the grouping columns first.
   *
   * Useful for inspecting a group without aggregating, and for feeding one group back into
   * the rest of the API.
   */
  toDataset(): TResult {
    const rows: Row[] = [];
    for (const group of this.#groups()) {
      for (const source of group.rows) {
        const row: Row = {};
        for (const [index, column] of this.#columns.entries()) row[column] = cloneValue(group.key[index] ?? null);
        for (const column of this.#source.columns) {
          if (!this.#columns.includes(column)) row[column] = cloneValue(source[column]);
        }
        rows.push(row);
      }
    }
    const remaining = this.#source.columns.filter((column) => !this.#columns.includes(column));
    return this.#source.build(rows, [...this.#columns, ...remaining]);
  }

  /**
   * Apply a function to each group and concatenate the results.
   *
   * The callback receives a frozen, copied set of rows, so it cannot corrupt the source
   * dataset by mutating its argument. It may return rows of any shape: the result's columns
   * are the union of the returned rows' keys in first-appearance order, so nothing is
   * silently dropped. When every callback returns nothing, the source columns are kept so
   * the result is still a valid, empty dataset.
   */
  mapGroups(fn: (rows: readonly Readonly<Row>[], key: Readonly<Record<string, unknown>>) => readonly Row[]): TResult {
    if (typeof fn !== "function") {
      throw new ValidationError("mapGroups() expects a function.");
    }
    const rows: Row[] = [];
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const group of this.#groups()) {
      const key: Record<string, unknown> = {};
      for (const [index, column] of this.#columns.entries()) key[column] = cloneValue(group.key[index] ?? null);
      const frozen = Object.freeze(group.rows.map((row) => Object.freeze(cloneValue(row))));
      const produced = fn(frozen, Object.freeze(key));
      if (!Array.isArray(produced)) {
        throw new ValidationError("mapGroups() callback must return an array of rows.");
      }
      for (const row of produced) {
        const copy = cloneValue(row);
        rows.push(copy);
        for (const column of Object.keys(copy)) {
          if (!seen.has(column)) {
            seen.add(column);
            columns.push(column);
          }
        }
      }
    }
    return this.#source.build(rows, columns.length > 0 ? columns : this.#source.columns);
  }

  /** Split rows into groups, preserving first-appearance order of each key. */
  #groups(): Group[] {
    const byKey = new Map<string, { key: unknown[]; rows: Row[] }>();
    for (const row of this.#source.rows) {
      const key = this.#columns.map((column) => row[column] ?? null);
      const identity = key.map((value) => encodeKeyPart(stableKey(value))).join("");
      let bucket = byKey.get(identity);
      if (bucket === undefined) {
        bucket = { key, rows: [] };
        byKey.set(identity, bucket);
      }
      bucket.rows.push(row);
    }
    return [...byKey.values()].map((bucket) => ({ key: bucket.key, rows: bucket.rows }));
  }

  /** Validate one spec entry and bind it to a compute function. */
  #resolve(name: string, entry: AggregationEntry): { name: string; compute: (group: Group) => unknown } {
    if (name.length === 0) {
      throw new ValidationError("aggregate() output names must be non-empty.");
    }
    if (this.#columns.includes(name)) {
      throw new ValidationError(`aggregate() output "${name}" collides with a grouping column. Choose another name.`);
    }

    if (isAggregationFn(entry)) {
      return {
        name,
        compute: (group) => {
          const rows = Object.freeze(group.rows.map((row) => Object.freeze(cloneValue(row))));
          return entry(rows, { column: null, rows });
        },
      };
    }

    if (isCustomAggregation(entry)) {
      const column = entry.column;
      if (column !== undefined && !this.#source.columns.includes(column)) {
        throw new ColumnNotFoundError(column, this.#source.columns);
      }
      return {
        name,
        compute: (group) => {
          const rows = Object.freeze(group.rows.map((row) => Object.freeze(cloneValue(row))));
          const values =
            column === undefined
              ? rows
              : Object.freeze(group.rows.map((row) => cloneValue(row[column])).filter(isPresent));
          return entry.fn(values, { column: column ?? null, rows });
        },
      };
    }

    if (entry === null || typeof entry !== "object") {
      throw new ValidationError(`aggregate() entry "${name}" must be an aggregation object or a function.`);
    }

    const op = entry.op;
    if (typeof op !== "string" || !isAggregationOp(op)) {
      throw new ValidationError(
        `aggregate() entry "${name}" has unknown operation ${JSON.stringify(op)}. ` +
          `Use one of: count, sum, mean, min, max, median, first, last, nunique, std, variance.`,
      );
    }

    const column = entry.column;
    if (column !== undefined) {
      if (typeof column !== "string" || column.length === 0) {
        throw new ValidationError(`aggregate() entry "${name}" has an invalid column name.`);
      }
      if (!this.#source.columns.includes(column)) {
        throw new ColumnNotFoundError(column, this.#source.columns);
      }
    } else if (op !== "count") {
      throw new ValidationError(
        `aggregate() entry "${name}" needs a column: only "count" may omit one, ` +
          `where it counts rows in the group.`,
      );
    }

    if (column !== undefined && NUMERIC_OPS.has(op)) {
      const dtype = this.#source.dtypes[column];
      if (dtype !== undefined && dtype !== "number" && dtype !== "integer" && dtype !== "unknown") {
        throw new ValidationError(
          `aggregate() entry "${name}" uses "${op}", which needs a numeric column, ` + `but "${column}" is ${dtype}.`,
        );
      }
    }

    const ddof = entry.ddof;
    if (ddof !== undefined && (typeof ddof !== "number" || !Number.isInteger(ddof) || ddof < 0)) {
      throw new ValidationError(`aggregate() entry "${name}" needs a non-negative integer ddof.`);
    }

    const valuesOf = (group: Group): unknown[] =>
      column === undefined ? group.rows.map((row) => row) : group.rows.map((row) => row[column]).filter(isPresent);

    return { name, compute: (group) => applyOp(op, valuesOf(group), ddof) };
  }
}

/**
 * Encode one key component with its length.
 *
 * Concatenating raw values would let a separator inside a value forge a boundary, so
 * `["x\u0000y", "z"]` and `["x", "y\u0000z"]` would collide and merge into one group.
 * Prefixing the length makes the encoding injective regardless of content.
 */
function encodeKeyPart(value: string): string {
  return `${value.length}:${value}`;
}

function isAggregationOp(value: string): value is AggregationOp {
  return (
    value === "count" ||
    value === "sum" ||
    value === "mean" ||
    value === "min" ||
    value === "max" ||
    value === "median" ||
    value === "first" ||
    value === "last" ||
    value === "nunique" ||
    value === "std" ||
    value === "variance"
  );
}

/** Apply a built-in operation to one group's present values. */
function applyOp(op: AggregationOp, values: readonly unknown[], ddof: number | undefined): unknown {
  if (op === "count") return values.length;
  if (op === "nunique") return nunique(values);
  if (op === "first") return first(values);
  if (op === "last") return last(values);
  if (op === "min") return min(values);
  if (op === "max") return max(values);

  const numbers = toNumbers(values);
  const options = ddof === undefined ? undefined : { ddof };
  switch (op) {
    case "sum":
      return sum(numbers);
    case "mean":
      return mean(numbers);
    case "median":
      return median(numbers);
    case "variance":
      return options === undefined ? variance(numbers) : variance(numbers, options);
    case "std":
      return options === undefined ? std(numbers) : std(numbers, options);
  }
}
