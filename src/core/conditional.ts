/**
 * Conditional column creation.
 *
 * `addConditionalColumn` is the declarative counterpart to `addColumn`: instead of one
 * callback that must encode every branch, the caller lists ordered rules and the first
 * match wins. Keeping the rules as data makes the decision table inspectable and lets a
 * caller log or test it, which a nested ternary inside a callback does not.
 */
import type { Row } from "./types.js";
import type { PreparedTable } from "./prepare.js";
import { ValidationError } from "../errors/index.js";
import { cloneValue } from "../utils/values.js";

/** Context handed to a rule's `when` predicate. */
export interface ConditionalRuleContext {
  /** The row being evaluated. Read-only by convention; the row is not copied per rule. */
  readonly row: Readonly<Row>;
  /** Zero-based position of the row in the dataset. */
  readonly index: number;
  /** Name of the column being created, so a predicate can name itself in an error. */
  readonly column: string;
}

/**
 * A value a rule can produce: a static value, or a callback computing one per row.
 *
 * `unknown` is deliberately absent from this union. A union containing `unknown` collapses
 * to `unknown`, which would leave a callback's parameters without contextual types and
 * silently make them `any`. Listing the value kinds keeps static values broad while giving
 * the callback member a real signature to infer from.
 */
export type ConditionalThen =
  | string
  | number
  | boolean
  | Date
  | null
  | readonly unknown[]
  | Readonly<Record<string, unknown>>
  | ((row: Readonly<Row>, index: number, context: ConditionalRuleContext) => unknown);

/** A single ordered rule: the first one whose `when` is true supplies the value. */
export interface ConditionalRule {
  /**
   * Predicate deciding whether this rule applies.
   *
   * A predicate that throws aborts the operation with a `ValidationError` naming the
   * operation, the row, and the rule position. The error is not swallowed into `else`,
   * because a broken predicate is a bug rather than a non-match.
   */
  readonly when: (row: Readonly<Row>, index: number, context: ConditionalRuleContext) => boolean;
  /**
   * Value used when `when` returns true.
   *
   * Either a static value, or a callback receiving the same arguments as `when`. The value
   * is cloned per row, so a shared object or `Date` is never aliased across rows.
   */
  readonly then: ConditionalThen;
}

/** Options for `addConditionalColumn`. */
export interface ConditionalColumnOptions {
  /**
   * Value for rows no rule matched.
   *
   * Defaults to `null` — the library's representation of a missing cell. Pass a function
   * to compute it per row, which is useful when the fallback depends on the row itself.
   */
  readonly else?: ConditionalThen | ((row: Readonly<Row>, index: number) => unknown);
}

/**
 * Name of the branch a row took.
 *
 * Reported back so a caller can audit coverage: a rule that never fires is usually a
 * mistake in the predicates rather than a property of the data.
 */
export interface ConditionalColumnReport {
  /** The generated column. */
  readonly column: string;
  /** Total rows evaluated. */
  readonly rowCount: number;
  /** How many rows each rule matched, in rule order. */
  readonly matched: readonly number[];
  /** How many rows fell through to `else`. */
  readonly unmatched: number;
}

/** A generated column plus the report describing how it was produced. */
export interface ConditionalColumnResult extends PreparedTable {
  readonly report: ConditionalColumnReport;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `the string "${value}"`;
  if (typeof value === "function") return "a function";
  if (Array.isArray(value)) return "an array";
  if (value instanceof Date) return "a Date";
  if (typeof value === "object") return "an object";
  return `a ${typeof value} (${String(value)})`;
}

function assertColumnName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("addConditionalColumn expects a non-empty column name.");
  }
}

/**
 * Validate the rule list up front.
 *
 * Every rule is checked before any row is evaluated, so a malformed list fails
 * immediately instead of after partially evaluating the data. The message names the
 * offending position because a long list is otherwise hard to debug.
 */
function resolveRules(rules: unknown): readonly ConditionalRule[] {
  if (!Array.isArray(rules)) {
    throw new ValidationError(`addConditionalColumn expects an array of rules, received ${describeValue(rules)}.`);
  }
  if (rules.length === 0) {
    throw new ValidationError(
      "addConditionalColumn expects at least one rule. Use addColumn for an unconditional column.",
    );
  }

  rules.forEach((rule, position) => {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      throw new ValidationError(
        `addConditionalColumn rule ${position} must be an object, received ${describeValue(rule)}.`,
      );
    }
    const { when, then } = rule as { when?: unknown; then?: unknown };
    if (typeof when !== "function") {
      throw new ValidationError(
        `addConditionalColumn rule ${position} expects "when" to be a function, received ${describeValue(when)}.`,
      );
    }
    if (then === undefined) {
      throw new ValidationError(
        `addConditionalColumn rule ${position} is missing "then". Use null for a deliberate empty value.`,
      );
    }
  });

  return rules as readonly ConditionalRule[];
}

/** Build a column from ordered rules, using the first rule whose `when` returns true. */
export function addConditionalColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  rules: readonly ConditionalRule[],
  options: ConditionalColumnOptions = {},
): ConditionalColumnResult {
  assertColumnName(name);
  if (columns.includes(name)) {
    throw new ValidationError(`addConditionalColumn cannot overwrite the existing column "${name}".`);
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ValidationError(`addConditionalColumn expects an options object, received ${describeValue(options)}.`);
  }

  const resolved = resolveRules(rules);
  const fallback = options.else;

  const matched = resolved.map(() => 0);
  let unmatched = 0;

  const out = rows.map((row, index) => {
    const context: ConditionalRuleContext = { row, index, column: name };

    for (let position = 0; position < resolved.length; position += 1) {
      const rule = resolved[position] as ConditionalRule;
      const applies = evaluate(rule, context, position, name);
      if (!applies) continue;

      matched[position] = (matched[position] as number) + 1;
      return finish(row, index, name, columns, rule.then, position, context);
    }

    unmatched += 1;
    return finish(row, index, name, columns, fallback, null, context);
  });

  return {
    rows: out,
    columns: [...columns, name],
    report: Object.freeze({
      column: name,
      rowCount: rows.length,
      matched: Object.freeze([...matched]),
      unmatched,
    }),
  };
}

/**
 * Evaluate one rule's predicate, converting a throw into a contextual error.
 *
 * `false`-like returns are honoured exactly: only a strict `false` means "did not match".
 * A predicate returning `undefined` or a non-boolean is a mistake the caller should see,
 * so it is rejected rather than silently treated as a non-match.
 */
function evaluate(rule: ConditionalRule, context: ConditionalRuleContext, position: number, column: string): boolean {
  let result: unknown;
  try {
    result = rule.when(context.row, context.index, context);
  } catch (error) {
    throw contextualError(column, position, context.index, error);
  }
  if (typeof result !== "boolean") {
    const message =
      `addConditionalColumn rule ${position} for "${column}" returned ${describeValue(result)} ` +
      `at row ${context.index}. A "when" predicate must return a boolean.`;
    throw new ValidationError(message);
  }
  return result;
}

function finish(
  row: Row,
  index: number,
  name: string,
  columns: readonly string[],
  source: unknown,
  position: number | null,
  context: ConditionalRuleContext,
): Row {
  const copy: Row = {};
  for (const column of columns) copy[column] = row[column];

  let value: unknown;
  try {
    value =
      typeof source === "function"
        ? (source as (row: Row, index: number, ctx: ConditionalRuleContext) => unknown)(row, index, context)
        : source;
  } catch (error) {
    if (position === null) {
      const message = `addConditionalColumn failed in "else" for "${name}" at row ${index}: ${errorMessage(error)}`;
      throw wrap(message, error);
    }
    throw contextualError(name, position, index, error);
  }

  copy[name] = cloneValue(value);
  return copy;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(column: string, position: number, index: number, error: unknown): ValidationError {
  const message = `addConditionalColumn rule ${position} for "${column}" threw at row ${index}: ${errorMessage(error)}`;
  return wrap(message, error);
}

function wrap(message: string, cause: unknown): ValidationError {
  const wrapped = new ValidationError(message);
  wrapped.cause = cause;
  return wrapped;
}
