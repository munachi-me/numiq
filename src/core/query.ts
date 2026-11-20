/**
 * Structured query API.
 *
 * A `Query` is a pure description of row selection, ordering, projection, and limiting.
 * Nothing is evaluated until `execute()`, and nothing is ever parsed from a string: every
 * condition is a typed value handed to a method, so there is no SQL text to evaluate and
 * no code to run from data. A column name can never become executable code.
 *
 * ## Lifecycle
 *
 * Every builder method returns a *new* `Query`; the receiver is never modified. That makes
 * a partially built query safe to reuse as a starting point:
 *
 * ```ts
 * const base = data.query().where("region", "in", ["North", "West"]);
 * const big = base.and("revenue", ">", 1000).execute();
 * const small = base.and("revenue", "<", 100).execute();  // `base` is unchanged
 * ```
 *
 * `execute()` may be called any number of times and always returns a fresh result.
 *
 * ## Precedence
 *
 * `and` binds tighter than `or`, matching ordinary boolean algebra:
 *
 * ```ts
 * q.where("a", "=", 1).or("b", "=", 2).and("c", "=", 3)  // a OR (b AND c)
 * ```
 *
 * Parenthesise explicitly with `andGroup` / `orGroup` when you need a different shape:
 *
 * ```ts
 * q.where("a", "=", 1).andGroup((g) => g.where("b", "=", 2).or("c", "=", 3))  // a AND (b OR c)
 * ```
 *
 * ## Missing values
 *
 * `null` and `undefined` both mean "missing", as everywhere else in Numiq. A missing cell
 * never satisfies a value comparison — including `!=` and `notIn` — so
 * `where("region", "!=", "North")` excludes rows where `region` is missing, exactly as SQL
 * does. Use `isNull` / `isNotNull` to test for missingness, and combine them when you want
 * missing rows included:
 *
 * ```ts
 * q.where("region", "!=", "North").or("region", "isNull")
 * ```
 */
import type { DType, Row } from "./types.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { compareValues } from "../utils/compare.js";
import { isPresent } from "../utils/values.js";
import { formatIsoDate, isIsoDate, isIsoDateTime, parseIsoDate, parseIsoDateTime } from "../utils/temporal.js";

/** Ordered comparison operators. */
export type ComparisonOperator = "=" | "!=" | ">" | ">=" | "<" | "<=";

/** Membership operators. The value must be an array. */
export type SetOperator = "in" | "notIn";

/** Inclusive range operator. The value must be `[low, high]`. */
export type RangeOperator = "between";

/** Substring operators. Only string cells can match. */
export type StringOperator = "contains" | "startsWith" | "endsWith";

/** Missing-value operators. These take no value. */
export type NullOperator = "isNull" | "isNotNull";

/** Every operator a query accepts. */
export type QueryOperator = ComparisonOperator | SetOperator | RangeOperator | StringOperator | NullOperator;

/** Options shared by the value-taking operators. */
export interface WhereOptions {
  /** Compare strings without regard to case. Applies to text cells only. */
  ignoreCase?: boolean;
}

/** Sort order accepted by `orderBy`. */
export type QueryDirection = "asc" | "desc";

/** A dataset the query runs against, supplied by `Dataset.query()`. */
export interface QuerySource<TResult> {
  readonly columns: readonly string[];
  readonly rows: readonly Row[];
  readonly dtypes: Readonly<Record<string, DType>>;
  /** How cells in a column are actually represented. Supplied by the owning `Dataset`. */
  readonly shapeOf: (column: string) => CellShape;
  /** Rebuild a dataset from prepared rows. Supplied by the owning `Dataset`. */
  readonly build: (rows: readonly Row[], columns: readonly string[]) => TResult;
}

/**
 * How a column stores its values.
 *
 * A `date` column is either ISO strings (as imported) or `Date` objects (after `cast`),
 * and the inferred dtype alone cannot tell them apart. Comparisons need the real
 * representation, otherwise a `Date` cell compared with an ISO string silently matches
 * nothing.
 */
export type CellShape = "date-object" | "string" | "number" | "boolean" | "other" | "empty";

/** Detect a column's cell shape. Mixed and untyped columns are reported as `other`. */
export function detectCellShape(rows: readonly Row[], column: string, dtype: DType | undefined): CellShape {
  if (dtype === "mixed" || dtype === "unknown") return "other";
  for (const row of rows) {
    const value = row[column];
    if (!isPresent(value)) continue;
    if (value instanceof Date) return "date-object";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    return "other";
  }
  return "empty";
}

type Test = (row: Row) => boolean;

type ConditionNode =
  | { readonly kind: "leaf"; readonly test: Test; readonly label: string }
  | { readonly kind: "and" | "or"; readonly children: readonly ConditionNode[] };

interface OrderedColumn {
  readonly column: string;
  readonly direction: QueryDirection;
}

const COMPARISON_OPS = new Set<string>(["=", "!=", ">", ">=", "<", "<="]);
const SET_OPS = new Set<string>(["in", "notIn"]);
const RANGE_OPS = new Set<string>(["between"]);
const STRING_OPS = new Set<string>(["contains", "startsWith", "endsWith"]);
const NULL_OPS = new Set<string>(["isNull", "isNotNull"]);

function isMissing(value: unknown): boolean {
  return !isPresent(value);
}

type Category = "number" | "string" | "boolean" | "date" | "other";

function categoryOf(value: unknown): Category {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (value instanceof Date) return "date";
  return "other";
}

/**
 * Reject a value that cannot possibly match any cell of the column.
 *
 * Comparing a numeric column against a string is almost always a bug, and letting it
 * silently return no rows turns a typo into a mystery. Columns typed `mixed` or `unknown`
 * are exempt because their contents are genuinely varied.
 */
function assertValueFitsColumn(dtype: DType | undefined, value: unknown, column: string, operator: string): void {
  if (dtype === undefined || dtype === "mixed" || dtype === "unknown") return;
  const category = categoryOf(value);
  const numeric = dtype === "number" || dtype === "integer";
  const textual = dtype === "string" || dtype === "date" || dtype === "datetime" || dtype === "time";
  const boolean = dtype === "boolean";

  if (numeric && category !== "number") {
    throw new ValidationError(
      `Query compares column "${column}" (type "${dtype}") with "${operator}" against a ${category} value. ` +
        `Pass a number, or compare the column as text.`,
    );
  }
  if (textual && category !== "string" && category !== "date") {
    throw new ValidationError(
      `Query compares column "${column}" (type "${dtype}") with "${operator}" against a ${category} value. ` +
        `Pass a string, or cast the column first.`,
    );
  }
  if (boolean && category !== "boolean") {
    throw new ValidationError(
      `Query compares column "${column}" (type "boolean") with "${operator}" against a ${category} value. ` +
        `Pass true or false.`,
    );
  }
}

function normalizeText(value: string, ignoreCase: boolean): string {
  return ignoreCase ? value.toLowerCase() : value;
}

/** Strict equality by value and type, so `1` never equals `"1"`. */
function valuesEqual(actual: unknown, expected: unknown, ignoreCase: boolean): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return normalizeText(actual, ignoreCase) === normalizeText(expected, ignoreCase);
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

/**
 * Convert a query value into the column's own representation.
 *
 * A `date` column holds either ISO strings or `Date` objects, and comparing across the
 * two silently matches nothing. Rather than guess, convert the value to match the cells:
 * a strict ISO string becomes a `Date` for a `date-object` column, and a `Date` becomes an
 * ISO string for a string-backed date column. Parsing is strict, so `"next tuesday"` is
 * rejected instead of becoming an Invalid Date that matches nothing.
 */
function coerceToShape(value: unknown, shape: CellShape, column: string): unknown {
  if (shape === "date-object") {
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      if (isIsoDateTime(value)) return parseIsoDateTime(value);
      if (isIsoDate(value)) return parseIsoDate(value);
      throw new ValidationError(
        `Query compares column "${column}", whose cells are Date objects, against "${value}", ` +
          `which is not an ISO date or date-time.`,
      );
    }
    throw new ValidationError(
      `Query compares column "${column}", whose cells are Date objects, against a ${categoryOf(value)} value.`,
    );
  }
  if (shape === "string") {
    if (typeof value === "string") return value;
    if (value instanceof Date) return formatIsoDate(value);
  }
  return value;
}

/** Compare two present values, or `null` when the pair is not comparable. */
function compareIfComparable(left: unknown, right: unknown, ignoreCase: boolean): number | null {
  if (typeof left === "string" && typeof right === "string") {
    const a = normalizeText(left, ignoreCase);
    const b = normalizeText(right, ignoreCase);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof left === "number" && typeof right === "number") return compareValues(left, right);
  if (typeof left === "boolean" && typeof right === "boolean") return compareValues(left, right);
  if (left instanceof Date && right instanceof Date) return compareValues(left, right);
  return null;
}

function buildLeaf(
  column: string,
  operator: QueryOperator,
  value: unknown,
  options: WhereOptions,
  shape: CellShape,
  dtype: DType | undefined,
): ConditionNode {
  const ignoreCase = options.ignoreCase === true;
  const read = (row: Row): unknown => row[column];

  if (NULL_OPS.has(operator)) {
    const wantMissing = operator === "isNull";
    return {
      kind: "leaf",
      label: `${column} ${operator}`,
      test: (row) => isMissing(read(row)) === wantMissing,
    };
  }

  if (SET_OPS.has(operator)) {
    if (!Array.isArray(value)) {
      throw new ValidationError(`Query operator "${operator}" on "${column}" expects an array of values.`);
    }
    if (value.length === 0) {
      throw new ValidationError(`Query operator "${operator}" on "${column}" received an empty array.`);
    }
    for (const candidate of value as readonly unknown[]) {
      if (isMissing(candidate)) {
        throw new ValidationError(
          `Query operator "${operator}" on "${column}" received a missing value, which can never match. ` +
            `Use "isNull" or "isNotNull" to test for missingness.`,
        );
      }
      assertValueFitsColumn(dtype, candidate, column, operator);
    }
    const candidates = (value as readonly unknown[]).map((candidate) => coerceToShape(candidate, shape, column));
    const wantMember = operator === "in";
    return {
      kind: "leaf",
      label: `${column} ${operator} [${candidates.length} values]`,
      test: (row) => {
        const actual = read(row);
        if (isMissing(actual)) return false;
        const found = candidates.some((candidate) => valuesEqual(actual, candidate, ignoreCase));
        return found === wantMember;
      },
    };
  }

  if (RANGE_OPS.has(operator)) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ValidationError(`Query operator "between" on "${column}" expects a [low, high] pair.`);
    }
    const low = coerceToShape(value[0], shape, column);
    const high = coerceToShape(value[1], shape, column);
    if (isMissing(low) || isMissing(high)) {
      throw new ValidationError(`Query operator "between" on "${column}" cannot use a missing bound.`);
    }
    const bounds = compareIfComparable(low, high, ignoreCase);
    if (bounds === null) {
      throw new ValidationError(
        `Query operator "between" on "${column}" needs bounds of the same type, received ` +
          `${categoryOf(low)} and ${categoryOf(high)}.`,
      );
    }
    if (bounds > 0) {
      throw new ValidationError(
        `Query operator "between" on "${column}" received a low bound above its high bound, ` +
          `so no row could ever match.`,
      );
    }
    assertValueFitsColumn(dtype, low, column, operator);
    assertValueFitsColumn(dtype, high, column, operator);
    return {
      kind: "leaf",
      label: `${column} between ${String(low)} and ${String(high)}`,
      test: (row) => {
        const actual = read(row);
        if (isMissing(actual)) return false;
        const lower = compareIfComparable(actual, low, ignoreCase);
        const upper = compareIfComparable(actual, high, ignoreCase);
        return lower !== null && upper !== null && lower >= 0 && upper <= 0;
      },
    };
  }

  if (STRING_OPS.has(operator)) {
    if (typeof value !== "string") {
      throw new ValidationError(`Query operator "${operator}" on "${column}" expects a string.`);
    }
    assertValueFitsColumn(dtype, value, column, operator);
    const needle = normalizeText(value, ignoreCase);
    return {
      kind: "leaf",
      label: `${column} ${operator} "${value}"`,
      test: (row) => {
        const actual = read(row);
        if (typeof actual !== "string") return false;
        const haystack = normalizeText(actual, ignoreCase);
        if (operator === "contains") return haystack.includes(needle);
        if (operator === "startsWith") return haystack.startsWith(needle);
        return haystack.endsWith(needle);
      },
    };
  }

  // Relational and equality operators.
  if (isMissing(value)) {
    throw new ValidationError(
      `Query operator "${operator}" on "${column}" cannot compare against a missing value. ` +
        `Use "isNull" or "isNotNull" instead.`,
    );
  }

  assertValueFitsColumn(dtype, value, column, operator);
  const target = coerceToShape(value, shape, column);

  if (operator === "=" || operator === "!=") {
    const wantEqual = operator === "=";
    return {
      kind: "leaf",
      label: `${column} ${operator} ${String(value)}`,
      test: (row) => {
        const actual = read(row);
        if (isMissing(actual)) return false;
        return valuesEqual(actual, target, ignoreCase) === wantEqual;
      },
    };
  }

  return {
    kind: "leaf",
    label: `${column} ${operator} ${String(value)}`,
    test: (row) => {
      const actual = read(row);
      if (isMissing(actual)) return false;
      // A pair of different types is not comparable, so the row does not match rather
      // than throwing part-way through a scan.
      const comparison = compareIfComparable(actual, target, ignoreCase);
      if (comparison === null) return false;
      if (operator === ">") return comparison > 0;
      if (operator === ">=") return comparison >= 0;
      if (operator === "<") return comparison < 0;
      return comparison <= 0;
    },
  };
}

/** Combine sibling nodes, collapsing a single child to that child. */
function combine(kind: "and" | "or", children: readonly ConditionNode[]): ConditionNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { kind, children };
}

/**
 * A reusable, immutable description of a row query.
 *
 * Obtain one from `Dataset.query()`. See the module documentation for precedence and
 * missing-value rules.
 */
export class Query<TResult> {
  readonly #source: QuerySource<TResult>;
  /** Each entry is an AND-ed run of conditions; the runs are OR-ed together. */
  readonly #groups: readonly (readonly ConditionNode[])[];
  readonly #order: readonly OrderedColumn[];
  readonly #selection: readonly string[] | null;
  readonly #limit: number | null;

  constructor(
    source: QuerySource<TResult>,
    groups: readonly (readonly ConditionNode[])[] = [],
    order: readonly OrderedColumn[] = [],
    selection: readonly string[] | null = null,
    limit: number | null = null,
  ) {
    this.#source = source;
    this.#groups = groups;
    this.#order = order;
    this.#selection = selection;
    this.#limit = limit;
  }

  #next(changes: {
    groups?: readonly (readonly ConditionNode[])[];
    order?: readonly OrderedColumn[];
    selection?: readonly string[] | null;
    limit?: number | null;
  }): Query<TResult> {
    return new Query<TResult>(
      this.#source,
      changes.groups ?? this.#groups,
      changes.order ?? this.#order,
      changes.selection === undefined ? this.#selection : changes.selection,
      changes.limit === undefined ? this.#limit : changes.limit,
    );
  }

  #assertColumn(column: string): void {
    if (typeof column !== "string" || column === "") {
      throw new ValidationError("Query expects a non-empty column name.");
    }
    if (!this.#source.columns.includes(column)) {
      throw new ColumnNotFoundError(column, this.#source.columns);
    }
  }

  /** Validate and build a leaf, then place it in the current conjunction. */
  #addLeaf(
    combinator: "and" | "or",
    column: string,
    operator: QueryOperator,
    value: unknown,
    options: WhereOptions,
  ): Query<TResult> {
    this.#assertColumn(column);
    if (typeof operator !== "string" || !isKnownOperator(operator)) {
      throw new ValidationError(`Unknown query operator "${String(operator)}".`);
    }
    if (options !== undefined && (options === null || typeof options !== "object")) {
      throw new ValidationError("Query options must be an object.");
    }
    if (options?.ignoreCase !== undefined && typeof options.ignoreCase !== "boolean") {
      throw new ValidationError("Query option ignoreCase must be a boolean.");
    }

    if (NULL_OPS.has(operator) && value !== undefined) {
      throw new ValidationError(`Query operator "${operator}" on "${column}" takes no value.`);
    }

    const leaf = buildLeaf(
      column,
      operator,
      value,
      options ?? {},
      this.#source.shapeOf(column),
      this.#source.dtypes[column],
    );

    if (combinator === "and" && this.#groups.length > 0) {
      const lastIndex = this.#groups.length - 1;
      const groups = this.#groups.map((group, index) => (index === lastIndex ? [...group, leaf] : group));
      return this.#next({ groups });
    }
    return this.#next({ groups: [...this.#groups, [leaf]] });
  }

  /** Add a condition that must hold. AND binds tighter than `or`. */
  where(column: string, operator: NullOperator): Query<TResult>;
  where(column: string, operator: SetOperator, value: readonly unknown[], options?: WhereOptions): Query<TResult>;
  where(
    column: string,
    operator: RangeOperator,
    value: readonly [unknown, unknown],
    options?: WhereOptions,
  ): Query<TResult>;
  where(
    column: string,
    operator: ComparisonOperator | StringOperator,
    value: unknown,
    options?: WhereOptions,
  ): Query<TResult>;
  where(column: string, operator: QueryOperator, value?: unknown, options?: WhereOptions): Query<TResult> {
    return this.#addLeaf("and", column, operator, value, options ?? {});
  }

  /** Add a condition that must hold. Alias of `where`, for symmetry with `or`. */
  and(column: string, operator: NullOperator): Query<TResult>;
  and(column: string, operator: SetOperator, value: readonly unknown[], options?: WhereOptions): Query<TResult>;
  and(
    column: string,
    operator: RangeOperator,
    value: readonly [unknown, unknown],
    options?: WhereOptions,
  ): Query<TResult>;
  and(
    column: string,
    operator: ComparisonOperator | StringOperator,
    value: unknown,
    options?: WhereOptions,
  ): Query<TResult>;
  and(column: string, operator: QueryOperator, value?: unknown, options?: WhereOptions): Query<TResult> {
    return this.#addLeaf("and", column, operator, value, options ?? {});
  }

  /** Start a new alternative: this condition may hold instead of the preceding ones. */
  or(column: string, operator: NullOperator): Query<TResult>;
  or(column: string, operator: SetOperator, value: readonly unknown[], options?: WhereOptions): Query<TResult>;
  or(
    column: string,
    operator: RangeOperator,
    value: readonly [unknown, unknown],
    options?: WhereOptions,
  ): Query<TResult>;
  or(
    column: string,
    operator: ComparisonOperator | StringOperator,
    value: unknown,
    options?: WhereOptions,
  ): Query<TResult>;
  or(column: string, operator: QueryOperator, value?: unknown, options?: WhereOptions): Query<TResult> {
    return this.#addLeaf("or", column, operator, value, options ?? {});
  }

  /**
   * Add a parenthesised group that must hold alongside the current conditions.
   *
   * `q.where("a", "=", 1).andGroup(g => g.where("b", "=", 2).or("c", "=", 3))` means
   * `a AND (b OR c)`.
   */
  andGroup(build: (group: Query<TResult>) => Query<TResult>): Query<TResult> {
    const node = this.#buildGroup(build);
    if (this.#groups.length > 0) {
      const lastIndex = this.#groups.length - 1;
      const groups = this.#groups.map((group, index) => (index === lastIndex ? [...group, node] : group));
      return this.#next({ groups });
    }
    return this.#next({ groups: [[node]] });
  }

  /**
   * Add a parenthesised group as an alternative to the current conditions.
   *
   * `q.where("a", "=", 1).orGroup(g => g.where("b", "=", 2).and("c", "=", 3))` means
   * `a OR (b AND c)`.
   */
  orGroup(build: (group: Query<TResult>) => Query<TResult>): Query<TResult> {
    return this.#next({ groups: [...this.#groups, [this.#buildGroup(build)]] });
  }

  #buildGroup(build: (group: Query<TResult>) => Query<TResult>): ConditionNode {
    if (typeof build !== "function") {
      throw new ValidationError("Query group expects a builder function.");
    }
    const nested = build(new Query<TResult>(this.#source));
    if (!(nested instanceof Query)) {
      throw new ValidationError("Query group builder must return a Query.");
    }
    const node = nested.#compile();
    if (node === null) {
      throw new ValidationError("Query group must contain at least one condition.");
    }
    return node;
  }

  /** Order the result. Replaces any previous ordering. */
  orderBy(column: string, direction: QueryDirection = "asc"): Query<TResult> {
    this.#assertColumn(column);
    if (direction !== "asc" && direction !== "desc") {
      throw new ValidationError(`orderBy direction must be "asc" or "desc", received "${String(direction)}".`);
    }
    return this.#next({ order: [...this.#order, { column, direction }] });
  }

  /** Keep only `columns`, in the given order. Replaces any previous selection. */
  select(columns: readonly string[]): Query<TResult> {
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new ValidationError("Query select expects a non-empty array of column names.");
    }
    for (const column of columns) this.#assertColumn(column);
    if (new Set(columns).size !== columns.length) {
      throw new ValidationError(`Query select received duplicate column names: ${columns.join(", ")}.`);
    }
    return this.#next({ selection: [...columns] });
  }

  /** Keep at most `count` rows after ordering. */
  limit(count: number): Query<TResult> {
    if (!Number.isInteger(count) || count < 0) {
      throw new ValidationError(`Query limit expects a non-negative integer, received ${String(count)}.`);
    }
    return this.#next({ limit: count });
  }

  /** Compile the conditions into a single predicate, or `null` when there are none. */
  #compile(): ConditionNode | null {
    const groupNodes = this.#groups
      .map((group) => combine("and", group))
      .filter((node): node is ConditionNode => node !== null);
    return combine("or", groupNodes);
  }

  /** A readable rendering of the conditions, for debugging. Never evaluated. */
  toString(): string {
    return this.#render(this.#compile()) ?? "(no conditions)";
  }

  #render(node: ConditionNode | null): string | null {
    if (node === null) return null;
    if (node.kind === "leaf") return node.label;
    return `(${node.children.map((child) => this.#render(child)).join(node.kind === "and" ? " AND " : " OR ")})`;
  }

  /** Run the query and return a new dataset. */
  execute(): TResult {
    const node = this.#compile();
    const predicate = node === null ? null : toPredicate(node);
    let rows: readonly Row[] = predicate === null ? this.#source.rows : this.#source.rows.filter(predicate);
    if (this.#order.length > 0) rows = sortRows(rows, this.#order);
    if (this.#limit !== null) rows = rows.slice(0, this.#limit);

    if (this.#selection === null) {
      return this.#source.build(rows, [...this.#source.columns]);
    }
    const columns = this.#selection;
    const projected = rows.map((row) => {
      const copy: Row = {};
      for (const column of columns) copy[column] = row[column];
      return copy;
    });
    return this.#source.build(projected, [...columns]);
  }
}

function isKnownOperator(operator: string): boolean {
  return (
    COMPARISON_OPS.has(operator) ||
    SET_OPS.has(operator) ||
    RANGE_OPS.has(operator) ||
    STRING_OPS.has(operator) ||
    NULL_OPS.has(operator)
  );
}

function toPredicate(node: ConditionNode): Test {
  if (node.kind === "leaf") return node.test;
  const children = node.children.map(toPredicate);
  if (node.kind === "and") return (row) => children.every((test) => test(row));
  return (row) => children.some((test) => test(row));
}

/**
 * Sort rows by several keys.
 *
 * Missing values sort last in both directions, ties keep their original order, and each
 * key is only consulted when the previous keys are equal. The rules match
 * `Dataset.sort`, so the two never disagree about ordering.
 */
function sortRows(rows: readonly Row[], order: readonly OrderedColumn[]): Row[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((left, right) => {
    for (const { column, direction } of order) {
      const leftValue = left.row[column];
      const rightValue = right.row[column];
      const leftMissing = isMissing(leftValue);
      const rightMissing = isMissing(rightValue);
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) continue;
        return leftMissing ? 1 : -1;
      }
      const comparison = compareValues(leftValue, rightValue);
      if (comparison !== 0) return comparison * (direction === "asc" ? 1 : -1);
    }
    return left.index - right.index;
  });
  return indexed.map((entry) => entry.row);
}
