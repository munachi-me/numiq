/**
 * Metric definitions: reusable, named calculations with a stated definition.
 *
 * A metric is a value plus the definition that produced it. The point is not the number —
 * `sum(values)` already returns that — but that the number travels with an account of what
 * was computed, over which column, by which aggregation. A "Total Revenue" that is a `sum`
 * of `revenue` can be printed, compared across groups, recalculated against a new dataset,
 * and audited later. A bare `31122.69` cannot.
 *
 * ## One implementation, shared
 *
 * Built-in aggregations delegate to `src/core/aggregate.ts`, the same primitives
 * `GroupedDataset.aggregate()` uses. A metric and a grouped aggregation over the same
 * column therefore cannot disagree, and there is no second copy of the arithmetic to drift.
 *
 * ## Missing values
 *
 * Every aggregation sees only the present values of its column, matching
 * `GroupedDataset.aggregate()`. A metric never counts a missing cell as zero, so `count`
 * reports present values rather than rows. Each result reports both `rows` and `values` so
 * the difference is visible.
 *
 * ## What a metric is not
 *
 * It is not a `Dataset`, a column, or a lazy promise. It is computed once at creation and
 * never changes. `recalculate` produces a *new* metric; it does not mutate this one.
 */
import {
  first,
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
  type AggregationOp,
} from "../core/aggregate.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import type { Row } from "../core/types.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";

/** How a metric's value should be presented. Hints only — Numiq renders nothing. */
export interface MetricFormat {
  /** Short suffix such as `"%"` or `" USD"`. */
  readonly suffix?: string;
  /** Short prefix such as `"$"`. */
  readonly prefix?: string;
  /** Decimal places a renderer should show. */
  readonly decimals?: number;
  /**
   * Treat the value as a fraction of `scale` for display: `0.42` with `scale: 100` and a
   * `"%"` suffix renders as `42%`. Purely presentational; the value is never rescaled.
   */
  readonly scale?: number;
  /** Named unit, for renderers that format by unit rather than by pattern. */
  readonly unit?: "number" | "percent" | "currency" | "count";
}

/** Free-form metadata carried alongside a metric. */
export type MetricMetadata = Readonly<Record<string, unknown>>;

/** Passed to custom metric callbacks so a calculation can see more than values. */
export interface MetricContext {
  /** The metric's name. */
  readonly name: string;
  /** The bound column, or `null` for a whole-row calculation. */
  readonly column: string | null;
  /** The rows the metric was computed over, frozen. */
  readonly rows: readonly Readonly<Row>[];
  /** Column names available on those rows. */
  readonly columns: readonly string[];
}

/** Keys of a spec that select the "built-in aggregation" shape. */
type AggregationOnly = {
  readonly fn?: never;
};

/** Keys of a spec that select a "custom callback" shape. */
type CallbackOnly = {
  readonly aggregation?: never;
  readonly ddof?: never;
};

/**
 * A metric definition as a caller supplies it.
 *
 * Each variant forbids the other variant's discriminant (`fn` here, `aggregation` there)
 * with `never`, so a spec carrying both is a compile error rather than something only the
 * constructor catches. Excess-property checks alone cannot do this: a union accepts any key
 * that appears in *some* member.
 */
export type MetricSpec =
  | (AggregationOnly & {
      /** Human-readable name, used as the output column when a metric becomes a column. */
      readonly name: string;
      /** Column to aggregate. Required for every aggregation except `count`. */
      readonly column?: string;
      /** Built-in aggregation to apply. */
      readonly aggregation: AggregationOp;
      /** Applies to `std` and `variance` only. */
      readonly ddof?: number;
      readonly format?: MetricFormat;
      readonly metadata?: MetricMetadata;
      /** Grouping columns, when this metric is defined over groups. */
      readonly groupBy?: readonly string[];
    })
  | (CallbackOnly & {
      readonly name: string;
      /** Column whose present values the callback receives. */
      readonly column: string;
      /** Custom calculation over that column's present values. */
      readonly fn: (values: readonly unknown[], context: MetricContext) => unknown;
      readonly format?: MetricFormat;
      readonly metadata?: MetricMetadata;
      readonly groupBy?: readonly string[];
    })
  | (CallbackOnly & {
      readonly name: string;
      /**
       * Absent by construction.
       *
       * `never` rather than `undefined` so TypeScript can tell this variant from the
       * column-bound one when a caller omits `column`. Without it, both variants match a
       * spec with no `column`, and the callback parameters degrade to `any`.
       */
      readonly column?: never;
      /** Custom calculation over the whole row set. */
      readonly fn: (rows: readonly Readonly<Row>[], context: MetricContext) => unknown;
      readonly format?: MetricFormat;
      readonly metadata?: MetricMetadata;
      readonly groupBy?: readonly string[];
    });

/** Why a metric's value is `null`. */
export type MetricReason = "empty" | "no-values" | "not-numeric";

/** A computed metric: the value, the definition, and the evidence. */
export interface MetricResult {
  /** The value the calculation produced, or `null` when it is undefined. */
  readonly value: unknown;
  /** Rows the calculation ran over. */
  readonly rows: number;
  /** Present values the calculation saw, or `null` for a whole-row calculation. */
  readonly values: number | null;
  /** Why `value` is `null`, or `null` when it is not. */
  readonly reason: MetricReason | null;
}

/** One group's metric value, for grouped metrics. */
export interface MetricGroupValue extends MetricResult {
  /** The grouping key, as an object of column to value. */
  readonly key: Readonly<Record<string, unknown>>;
}

/** Why a derived comparison field is `null`. */
export type MetricComparisonReason = "not-numeric" | "zero-baseline";

/** One metric measured against a baseline. */
export interface MetricComparison {
  /** Label for the baseline. */
  readonly other: string;
  /** This metric's value. */
  readonly value: unknown;
  /** The baseline value. */
  readonly otherValue: unknown;
  /** `value - otherValue`, when both are finite numbers. */
  readonly difference: number | null;
  /** `value / otherValue`, when both are numbers and the baseline is not zero. */
  readonly ratio: number | null;
  /**
   * `ratio * 100`: the value expressed as a percentage of the baseline, so a doubling is
   * `200`. This is *not* the conventional "percent change" of `(value - otherValue) /
   * otherValue * 100`, which would report `100` for a doubling. Kept under its historical
   * name for compatibility; prefer `percentDifference`, which is unambiguous.
   */
  readonly percentChange: number | null;
  /**
   * `(value - otherValue) / otherValue * 100`: the conventional percent change, so a
   * doubling is `100` and a halving is `-50`. `null` on the same conditions as `ratio`.
   */
  readonly percentDifference: number | null;
  /** Why a derived field is `null`, or `null` when the comparison is complete. */
  readonly reason: MetricComparisonReason | null;
}

/** Options for `Metric.compare`. */
export interface MetricCompareOptions {
  /** Compare against another metric's value, or a bare number. */
  readonly to: MetricResult | number;
  /** Label for the baseline. Defaults to `"baseline"`. */
  readonly label?: string;
}

/** A grouped metric: one value per group, in first-appearance order of the key. */
export interface GroupedMetricResult {
  /** The grouping columns. */
  readonly groupBy: readonly string[];
  /** One entry per group. */
  readonly groups: readonly MetricGroupValue[];
  /** Total groups found. */
  readonly groupCount: number;
}

/** Every built-in aggregation, for validation and error messages. */
const AGGREGATION_OPS: readonly AggregationOp[] = [
  "count",
  "sum",
  "mean",
  "min",
  "max",
  "median",
  "first",
  "last",
  "nunique",
  "std",
  "variance",
];

/** Operations that require numeric values. Mirrors `NUMERIC_OPS` in aggregate.ts. */
const NUMERIC_OPS: ReadonlySet<AggregationOp> = new Set<AggregationOp>(["sum", "mean", "median", "std", "variance"]);

/** True when `value` names a built-in aggregation. */
export function isAggregationOp(value: unknown): value is AggregationOp {
  return typeof value === "string" && (AGGREGATION_OPS as readonly string[]).includes(value);
}

/** Present values of a column, cloned so a callback cannot corrupt the retained rows. */
function presentValues(rows: readonly Readonly<Row>[], column: string): unknown[] {
  const values: unknown[] = [];
  for (const row of rows) {
    const value = row[column];
    if (isPresent(value)) values.push(cloneValue(value));
  }
  return values;
}

/** Copy and freeze rows so callbacks cannot mutate the metric's retained data. */
function freezeRows(rows: readonly Row[]): readonly Readonly<Row>[] {
  return Object.freeze(rows.map((row) => Object.freeze(cloneValue(row))));
}

/** Apply a built-in aggregation, delegating to the shared primitives. */
function applyAggregation(op: AggregationOp, values: readonly unknown[], ddof: number): unknown {
  if (op === "count") return values.length;
  if (op === "nunique") return nunique(values);
  if (op === "first") return first(values);
  if (op === "last") return last(values);
  if (op === "min") return min(values);
  if (op === "max") return max(values);

  const numbers = toNumbers(values);
  if (numbers.length === 0) return null;
  switch (op) {
    case "sum":
      return sum(numbers);
    case "mean":
      return mean(numbers);
    case "median":
      return median(numbers);
    case "variance":
      return variance(numbers, { ddof });
    case "std":
      return std(numbers, { ddof });
    default:
      return null;
  }
}

/**
 * A named, reusable calculation over a dataset.
 *
 * Construct one with `Dataset.createMetric()` or the standalone `createMetric()`. Every
 * field is readonly: a metric is a value with a definition attached, not a builder.
 */
export class Metric {
  readonly #name: string;
  readonly #aggregation: AggregationOp | null;
  readonly #column: string | null;
  readonly #ddof: number;
  readonly #format: MetricFormat;
  readonly #metadata: MetricMetadata;
  readonly #groupBy: readonly string[];
  readonly #rows: readonly Readonly<Row>[];
  readonly #columns: readonly string[];
  readonly #callback: ((input: never, context: MetricContext) => unknown) | null;
  readonly #result: MetricResult;

  constructor(spec: MetricSpec, rows: readonly Row[], columns: readonly string[]) {
    if (typeof spec !== "object" || spec === null) {
      throw new ValidationError("createMetric() needs a metric definition object.");
    }
    if (typeof spec.name !== "string" || spec.name.trim().length === 0) {
      throw new ValidationError("createMetric() needs a non-empty name.");
    }

    const available = [...columns];
    this.#name = spec.name;
    this.#format = Object.freeze({ ...(spec.format ?? {}) });
    this.#metadata = Object.freeze({ ...(spec.metadata ?? {}) });
    this.#groupBy = Object.freeze([...(spec.groupBy ?? [])]);
    this.#rows = freezeRows(rows);
    this.#columns = Object.freeze(available);

    for (const column of this.#groupBy) {
      if (!available.includes(column)) throw new ColumnNotFoundError(column, available);
    }

    const hasAggregation = "aggregation" in spec;
    const hasCallback = "fn" in spec;
    if (hasAggregation === hasCallback) {
      throw new ValidationError(`createMetric("${spec.name}") needs exactly one of "aggregation" or "fn".`);
    }

    if (hasAggregation) {
      const aggregation = spec.aggregation;
      if (!isAggregationOp(aggregation)) {
        throw new ValidationError(
          `createMetric("${spec.name}") has unknown aggregation ${JSON.stringify(aggregation)}. ` +
            `Use one of: ${AGGREGATION_OPS.join(", ")}.`,
        );
      }
      const column = spec.column ?? null;
      if (column === null && aggregation !== "count") {
        throw new ValidationError(
          `createMetric("${spec.name}") needs a column for the "${aggregation}" aggregation. ` +
            'Only "count" can run without one.',
        );
      }
      if (column !== null && !available.includes(column)) {
        throw new ColumnNotFoundError(column, available);
      }
      const ddof = spec.ddof ?? 1;
      if (!Number.isFinite(ddof) || ddof < 0) {
        throw new ValidationError(`createMetric("${spec.name}") needs a ddof of 0 or more.`);
      }
      this.#aggregation = aggregation;
      this.#column = column;
      this.#ddof = ddof;
      this.#callback = null;
    } else {
      const column = "column" in spec ? spec.column : undefined;
      if (column !== undefined && !available.includes(column)) {
        throw new ColumnNotFoundError(column, available);
      }
      this.#aggregation = null;
      this.#column = column ?? null;
      this.#ddof = 0;
      this.#callback = spec.fn as (input: never, context: MetricContext) => unknown;
    }

    this.#result = this.#evaluate(this.#rows);
  }

  /** The metric's name. */
  get name(): string {
    return this.#name;
  }

  /** The computed value, or `null` when it is undefined for the data. */
  get value(): unknown {
    return this.#result.value;
  }

  /** The metric as a structured result: value, rows, values, and a reason when null. */
  get metric(): MetricResult {
    return this.#result;
  }

  /** The aggregation used, or `null` for a custom calculation. */
  get aggregation(): AggregationOp | null {
    return this.#aggregation;
  }

  /** The column the metric reads, or `null` for a whole-row calculation. */
  get column(): string | null {
    return this.#column;
  }

  /** Presentation hints. Numiq never renders; a consumer applies these. */
  get format(): MetricFormat {
    return this.#format;
  }

  /** Arbitrary metadata, preserved as given. */
  get metadata(): MetricMetadata {
    return this.#metadata;
  }

  /** Grouping columns, when this metric is defined over groups. */
  get groupBy(): readonly string[] {
    return this.#groupBy;
  }

  /**
   * A one-line account of how the value was produced.
   *
   * This is the point of a metric: the definition travels with the number.
   */
  get definition(): string {
    if (this.#aggregation !== null) {
      const target = this.#column === null ? "rows" : `"${this.#column}"`;
      const ddofNote = this.#aggregation === "std" || this.#aggregation === "variance" ? ` (ddof ${this.#ddof})` : "";
      return `${this.#aggregation}(${target})${ddofNote}`;
    }
    return this.#column === null ? "custom(rows)" : `custom("${this.#column}")`;
  }

  /** Rows the metric was computed over. */
  get rowCount(): number {
    return this.#rows.length;
  }

  /** The retained source rows, frozen. */
  get rows(): readonly Readonly<Row>[] {
    return this.#rows;
  }

  /** Column names available to this metric. */
  get columns(): readonly string[] {
    return this.#columns;
  }

  /**
   * The metric recomputed against different rows, keeping the same definition.
   *
   * Returns a new `Metric`; this one is unchanged. The new data must contain every column
   * the definition needs, or `ColumnNotFoundError` is thrown — silently producing `null`
   * would hide a schema change.
   */
  recalculate(rows: readonly Row[], columns: readonly string[] = this.#columns): Metric {
    return new Metric(this.#spec(), rows, columns);
  }

  /**
   * Compare this metric's value with a baseline.
   *
   * Both sides must be numbers. The caller supplies the baseline explicitly rather than
   * Numiq guessing at "comparable" metrics, because a percentage change between a sum and
   * a mean is arithmetic without meaning.
   */
  compare(options: MetricCompareOptions): MetricComparison {
    const otherValue = typeof options.to === "number" ? options.to : options.to.value;
    const label = options.label ?? "baseline";
    const value = this.#result.value;

    if (typeof value !== "number" || typeof otherValue !== "number") {
      return {
        other: label,
        value,
        otherValue,
        difference: null,
        ratio: null,
        percentChange: null,
        percentDifference: null,
        reason: "not-numeric",
      };
    }

    const difference = value - otherValue;
    if (otherValue === 0) {
      return {
        other: label,
        value,
        otherValue,
        difference,
        ratio: null,
        percentChange: null,
        percentDifference: null,
        reason: "zero-baseline",
      };
    }
    const ratio = value / otherValue;
    return {
      other: label,
      value,
      otherValue,
      difference,
      ratio,
      percentChange: ratio * 100,
      percentDifference: (difference / otherValue) * 100,
      reason: null,
    };
  }

  /**
   * This metric computed per group.
   *
   * Groups appear in first-appearance order of their key, so the output is deterministic.
   * Throws when `groupBy` is empty rather than guessing a grouping.
   */
  byGroup(): GroupedMetricResult {
    if (this.#groupBy.length === 0) {
      throw new ValidationError(`Metric "${this.#name}" has no groupBy columns. Pass groupBy when creating it.`);
    }

    const order: string[] = [];
    const buckets = new Map<string, { key: Record<string, unknown>; rows: Row[] }>();
    for (const row of this.#rows) {
      const key: Record<string, unknown> = {};
      for (const column of this.#groupBy) key[column] = row[column] ?? null;
      const identity = this.#groupBy.map((column) => stableKey(key[column])).join("\u0000");
      let bucket = buckets.get(identity);
      if (bucket === undefined) {
        bucket = { key, rows: [] };
        buckets.set(identity, bucket);
        order.push(identity);
      }
      bucket.rows.push(row as Row);
    }

    const groups: MetricGroupValue[] = order.map((identity) => {
      const bucket = buckets.get(identity) as { key: Record<string, unknown>; rows: Row[] };
      return { key: Object.freeze(bucket.key), ...this.#evaluate(bucket.rows) };
    });

    return { groupBy: this.#groupBy, groups: Object.freeze(groups), groupCount: groups.length };
  }

  /**
   * One row per group: the grouping columns followed by the metric, named after the metric.
   *
   * Keeping the metric's name means the output can be joined back onto the source by the
   * grouping columns.
   */
  toDataset(): { columns: readonly string[]; rows: readonly Row[] } {
    const grouped = this.byGroup();
    const columns = [...this.#groupBy, this.#name];
    const rows = grouped.groups.map((group) => {
      const row: Record<string, unknown> = { ...group.key };
      row[this.#name] = group.value;
      return row;
    });
    return { columns: Object.freeze(columns), rows: Object.freeze(rows) };
  }

  /** Structured form, for logging or JSON output. */
  toJSON(): {
    name: string;
    value: unknown;
    definition: string;
    aggregation: AggregationOp | null;
    column: string | null;
    rows: number;
    values: number | null;
    reason: MetricReason | null;
    format: MetricFormat;
    metadata: MetricMetadata;
    groupBy: readonly string[];
  } {
    return {
      name: this.#name,
      value: this.#result.value,
      definition: this.definition,
      aggregation: this.#aggregation,
      column: this.#column,
      rows: this.#result.rows,
      values: this.#result.values,
      reason: this.#result.reason,
      format: this.#format,
      metadata: this.#metadata,
      groupBy: this.#groupBy,
    };
  }

  /** Rebuild the spec this metric was created from, for `recalculate`. */
  #spec(): MetricSpec {
    const base = {
      name: this.#name,
      format: this.#format,
      metadata: this.#metadata,
      groupBy: this.#groupBy,
    };
    if (this.#aggregation !== null) {
      return {
        ...base,
        aggregation: this.#aggregation,
        ...(this.#column === null ? {} : { column: this.#column }),
        ddof: this.#ddof,
      };
    }
    const callback = this.#callback as (input: never, context: MetricContext) => unknown;
    return this.#column === null
      ? { ...base, fn: callback as (rows: readonly Readonly<Row>[], context: MetricContext) => unknown }
      : {
          ...base,
          column: this.#column,
          fn: callback as (values: readonly unknown[], context: MetricContext) => unknown,
        };
  }

  /** Evaluate the definition over a row set. */
  #evaluate(rows: readonly Row[] | readonly Readonly<Row>[]): MetricResult {
    const frozen = (rows === this.#rows ? this.#rows : freezeRows(rows as readonly Row[])) as readonly Readonly<Row>[];

    if (this.#aggregation === null) return this.#evaluateCustom(frozen);

    if (this.#column === null) {
      if (frozen.length === 0) return { value: null, rows: 0, values: null, reason: "empty" };
      return { value: frozen.length, rows: frozen.length, values: null, reason: null };
    }

    const values = presentValues(frozen, this.#column);
    if (frozen.length === 0) return { value: null, rows: 0, values: 0, reason: "empty" };
    if (values.length === 0) return { value: null, rows: frozen.length, values: 0, reason: "no-values" };

    if (NUMERIC_OPS.has(this.#aggregation) && toNumbers(values).length === 0) {
      return { value: null, rows: frozen.length, values: values.length, reason: "not-numeric" };
    }

    const value = applyAggregation(this.#aggregation, values, this.#ddof);
    return {
      value,
      rows: frozen.length,
      values: values.length,
      reason: value === null ? "no-values" : null,
    };
  }

  /** Evaluate a custom callback. */
  #evaluateCustom(rows: readonly Readonly<Row>[]): MetricResult {
    const callback = this.#callback;
    if (callback === null) throw new ValidationError(`Metric "${this.#name}" has no custom calculation.`);

    const context: MetricContext = {
      name: this.#name,
      column: this.#column,
      rows,
      columns: this.#columns,
    };

    if (this.#column === null) {
      const value = (callback as (input: readonly Readonly<Row>[], context: MetricContext) => unknown)(rows, context);
      return { value, rows: rows.length, values: null, reason: null };
    }

    const values = Object.freeze(presentValues(rows, this.#column));
    const value = (callback as (input: readonly unknown[], context: MetricContext) => unknown)(values, context);
    return { value, rows: rows.length, values: values.length, reason: null };
  }
}

/**
 * Build a metric from a definition.
 *
 * `Dataset.createMetric()` is the usual entry point; this exists for callers holding rows
 * without a `Dataset`.
 */
export function createMetric(spec: MetricSpec, rows: readonly Row[], columns: readonly string[]): Metric {
  return new Metric(spec, rows, columns);
}
