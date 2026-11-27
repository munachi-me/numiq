import type { ColumnType, DType, Row } from "./types.js";
import { inferColumnType } from "./schema.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { isPresent, stableKey } from "../utils/values.js";
import { isIsoDate, isIsoDateTime, isIsoTime } from "../utils/temporal.js";

/**
 * Rules for one column.
 *
 * Every field is optional: a schema may assert only the parts it cares about. A column
 * listed with no rules still has its presence checked, which is the point of listing it.
 */
export interface ColumnRules {
  /** Expected type. Checked per value, not from the inferred column dtype. */
  type?: ColumnType;
  /** `false` rejects any missing value. `true` (default) allows them. */
  nullable?: boolean;
  /** Inclusive lower bound for numeric and temporal values. */
  min?: number | Date | string;
  /** Inclusive upper bound for numeric and temporal values. */
  max?: number | Date | string;
  /** Closed set of permitted values. */
  allowed?: readonly unknown[];
  /** Regular expression source the whole value must match; strings only. */
  pattern?: string;
  /** Inclusive bounds on string length. */
  minLength?: number;
  maxLength?: number;
  /**
   * Reject repeated values, compared by `Dataset.unique`'s equality.
   *
   * `true` requires every present value to be distinct; an array names the columns whose
   * combination must be unique. Missing values are exempt — "no value" repeated is not a
   * duplicate, and a nullable column would otherwise be impossible to make unique.
   */
  unique?: boolean | readonly string[];
  /** Extra check. Return `false` or a message to reject a value. */
  validate?: (value: unknown, row: Row, index: number) => boolean | string;
}

/** A validation schema: column name to its rules. */
export type ValidationSchema = Readonly<Record<string, ColumnRules>>;

/** One failed check, with enough context to locate the offending cell. */
export interface ValidationIssue {
  /** Machine-readable category, stable across releases. */
  code: string;
  message: string;
  column: string;
  /** Zero-based row index. Absent for column-level issues such as a missing column. */
  row?: number;
  /** The offending value, cloned so callers cannot mutate dataset state. */
  value?: unknown;
  /** What the schema asked for, when the issue is a mismatch. */
  expected?: string;
}

/** Outcome of validating a dataset. */
export interface ValidationReport {
  valid: boolean;
  /** Number of rows examined. */
  rowCount: number;
  /** Number of columns the schema named. */
  columnCount: number;
  /** Number of cells checked, including missing ones. */
  checked: number;
  issues: readonly ValidationIssue[];
  /** Total issues found, which may exceed `issues.length` when the list was capped. */
  issueCount: number;
  /** True when `issues` was truncated by `maxIssues`. */
  truncated: boolean;
  /** Number of rows rejected by at least one issue. */
  invalidRows: number;
  /** Issue counts keyed by `code`, for a quick summary. */
  byCode: Readonly<Record<string, number>>;
}

/** Options controlling how a validation runs. */
export interface ValidateOptions {
  /** Stop collecting issues after this many. The report records that it truncated. */
  maxIssues?: number;
  /** Skip every check except column presence. */
  columnsOnly?: boolean;
}

const DEFAULT_MAX_ISSUES = 100;

const NUMERIC_TYPES: ReadonlySet<string> = new Set(["number", "integer"]);

/**
 * Check a value against one declared type.
 *
 * Temporal columns are the awkward case: Numiq stores a `date` as either a `Date` or an
 * ISO string depending on how the value arrived (a CSV cell stays a string, `cast` makes
 * a `Date`). Both are the same logical type here, so both are accepted — rejecting one
 * would make validation depend on the import path rather than the data.
 */
function matchesType(value: unknown, type: ColumnType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return typeof value === "string" && isIsoDate(value);
    case "datetime":
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return typeof value === "string" && isIsoDateTime(value);
    case "time":
      return typeof value === "string" && isIsoTime(value);
    default:
      return false;
  }
}

/** Coerce a bound to a comparable number or timestamp; `null` when it cannot be compared. */
function boundValue(value: number | Date | string): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Equality for `allowed` membership.
 *
 * Deliberately stricter than `compareValues`: that comparator orders values by text as a
 * fallback, so it reports `1` and `"1"` as equal. For an allow-list that would silently
 * accept the wrong type, so numbers, strings, and booleans must match exactly, while
 * dates compare by instant.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (typeof left !== typeof right) return false;
  if (left !== null && typeof left === "object") return stableKey(left) === stableKey(right);
  return left === right;
}

/** Comparable form of a cell for range checks, or `null` when it has no order. */
function orderableValue(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Validate one cell. Returns the issues it raised (empty when the value is fine). */
function checkCell(column: string, rules: ColumnRules, value: unknown, rowIndex: number, row: Row): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string, extra: Partial<ValidationIssue> = {}): void => {
    issues.push({ code, message, column, row: rowIndex, value, ...extra });
  };

  if (!isPresent(value)) {
    if (rules.nullable === false) push("NULL_NOT_ALLOWED", `Column "${column}" does not allow missing values.`);
    return issues;
  }

  if (rules.type !== undefined && !matchesType(value, rules.type)) {
    push("TYPE_MISMATCH", `Column "${column}" expects type "${rules.type}".`, {
      expected: rules.type,
    });
    // A type mismatch makes the remaining checks meaningless: a value that is not a
    // number cannot meaningfully fail a numeric range check, and reporting both would
    // bury the real cause under noise.
    return issues;
  }

  if (rules.min !== undefined || rules.max !== undefined) {
    const actual = orderableValue(value);
    if (actual === null) {
      // The value passed its declared type, so it is a string that does not parse as a
      // date. Saying "cannot be compared" points at the bound check the caller asked for;
      // silently skipping it would let an unparseable date slip past a range rule.
      push("NOT_ORDERABLE", `Column "${column}" value cannot be compared to a bound.`);
    } else {
      if (rules.min !== undefined) {
        const bound = boundValue(rules.min);
        if (bound !== null && actual < bound) {
          push("BELOW_MINIMUM", `Column "${column}" value is below the minimum ${String(rules.min)}.`, {
            expected: `>= ${String(rules.min)}`,
          });
        }
      }
      if (rules.max !== undefined) {
        const bound = boundValue(rules.max);
        if (bound !== null && actual > bound) {
          push("ABOVE_MAXIMUM", `Column "${column}" value is above the maximum ${String(rules.max)}.`, {
            expected: `<= ${String(rules.max)}`,
          });
        }
      }
    }
  }

  if (rules.allowed !== undefined) {
    const permitted = rules.allowed.some((candidate) => sameValue(candidate, value));
    if (!permitted) {
      push("NOT_ALLOWED", `Column "${column}" value is not one of the allowed values.`, {
        expected: rules.allowed.map((item) => String(item)).join(", "),
      });
    }
  }

  if (rules.pattern !== undefined) {
    if (typeof value !== "string") {
      push("PATTERN_NOT_APPLICABLE", `Column "${column}" pattern check needs a string value.`, {
        expected: "string",
      });
    } else {
      // Anchored so `pattern: "\\d+"` means the whole value, not a substring of it. A
      // caller wanting a substring match can write `.*` around the expression.
      const expression = new RegExp(`^(?:${rules.pattern})$`);
      if (!expression.test(value)) {
        push("PATTERN_MISMATCH", `Column "${column}" value does not match the required pattern.`, {
          expected: rules.pattern,
        });
      }
    }
  }

  if (rules.minLength !== undefined || rules.maxLength !== undefined) {
    if (typeof value !== "string") {
      push("LENGTH_NOT_APPLICABLE", `Column "${column}" length check needs a string value.`, {
        expected: "string",
      });
    } else {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        push("TOO_SHORT", `Column "${column}" value is shorter than ${rules.minLength} characters.`, {
          expected: `length >= ${rules.minLength}`,
        });
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        push("TOO_LONG", `Column "${column}" value is longer than ${rules.maxLength} characters.`, {
          expected: `length <= ${rules.maxLength}`,
        });
      }
    }
  }

  if (rules.validate !== undefined) {
    let outcome: boolean | string;
    try {
      outcome = rules.validate(value, row, rowIndex);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      push("CUSTOM_VALIDATOR_THREW", `Column "${column}" validator threw: ${reason}`);
      return issues;
    }
    if (outcome === false) {
      push("CUSTOM_VALIDATOR_FAILED", `Column "${column}" failed its custom validator.`);
    } else if (typeof outcome === "string") {
      push("CUSTOM_VALIDATOR_FAILED", `Column "${column}": ${outcome}`);
    }
  }

  return issues;
}

/** Reject rule objects that could never pass, so a typo fails loudly instead of silently. */
function assertRules(column: string, rules: ColumnRules): void {
  const numericBounds: Array<[string, unknown]> = [
    ["minLength", rules.minLength],
    ["maxLength", rules.maxLength],
  ];
  for (const [label, value] of numericBounds) {
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
      throw new ValidationError(`Schema for column "${column}": "${label}" must be a non-negative integer.`);
    }
  }
  if (rules.minLength !== undefined && rules.maxLength !== undefined && rules.minLength > rules.maxLength) {
    throw new ValidationError(
      `Schema for column "${column}": "minLength" (${rules.minLength}) exceeds "maxLength" (${rules.maxLength}).`,
    );
  }
  if (rules.pattern !== undefined) {
    if (typeof rules.pattern !== "string") {
      throw new ValidationError(`Schema for column "${column}": "pattern" must be a string.`);
    }
    try {
      new RegExp(rules.pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ValidationError(
        `Schema for column "${column}": "pattern" is not a valid regular expression: ${reason}.`,
      );
    }
  }
  if (rules.allowed !== undefined && !Array.isArray(rules.allowed)) {
    throw new ValidationError(`Schema for column "${column}": "allowed" must be an array.`);
  }
  if (rules.validate !== undefined && typeof rules.validate !== "function") {
    throw new ValidationError(`Schema for column "${column}": "validate" must be a function.`);
  }
  if (rules.unique !== undefined && !Array.isArray(rules.unique) && typeof rules.unique !== "boolean") {
    throw new ValidationError(`Schema for column "${column}": "unique" must be a boolean or an array of column names.`);
  }
  if (rules.type !== undefined && !isColumnType(rules.type)) {
    throw new ValidationError(
      `Schema for column "${column}": "${String(rules.type)}" is not a supported type. ` +
        `Use string, number, integer, boolean, date, datetime, or time.`,
    );
  }
  if (rules.min !== undefined && rules.max !== undefined) {
    const min = boundValue(rules.min);
    const max = boundValue(rules.max);
    if (min !== null && max !== null && min > max) {
      throw new ValidationError(
        `Schema for column "${column}": "min" (${String(rules.min)}) exceeds "max" (${String(rules.max)}).`,
      );
    }
  }
}

const COLUMN_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
]);

function isColumnType(value: unknown): value is ColumnType {
  return typeof value === "string" && COLUMN_TYPES.has(value);
}

/**
 * Validate rows against a schema.
 *
 * Returns a report rather than throwing: a caller usually wants every problem at once,
 * not the first one. Throwing is reserved for a malformed schema, which is a programming
 * error and would otherwise look like a data problem.
 */
export function validateRows(
  rows: readonly Row[],
  columns: readonly string[],
  schema: ValidationSchema,
  options: ValidateOptions = {},
): ValidationReport {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new ValidationError("validate expects a schema object mapping column names to rules.");
  }
  const maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
  if (!Number.isInteger(maxIssues) || maxIssues < 1) {
    throw new ValidationError(`"maxIssues" must be a positive integer, received ${String(maxIssues)}.`);
  }

  const entries = Object.entries(schema);
  for (const [column, rules] of entries) {
    if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
      throw new ValidationError(`Schema for column "${column}" must be an object of rules.`);
    }
    assertRules(column, rules);
  }

  const issues: ValidationIssue[] = [];
  const byCode: Record<string, number> = {};
  let issueCount = 0;
  const invalidRowIndexes = new Set<number>();

  const record = (issue: ValidationIssue): void => {
    issueCount += 1;
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
    if (issue.row !== undefined) invalidRowIndexes.add(issue.row);
    if (issues.length < maxIssues) issues.push(issue);
  };

  // A missing column is a schema-level failure: every row would fail it, so reporting it
  // once with the available names is both clearer and smaller than one issue per row.
  const present = new Set(columns);
  for (const [column] of entries) {
    if (!present.has(column)) {
      const error = new ColumnNotFoundError(column, columns);
      record({
        code: "MISSING_COLUMN",
        message: error.message,
        column,
        expected: "column present in the dataset",
      });
    }
  }

  let checked = 0;
  if (options.columnsOnly !== true) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) continue;
      for (const [column, rules] of entries) {
        if (!present.has(column)) continue;
        checked += 1;
        const found = checkCell(column, rules, row[column], index, row);
        for (const issue of found) record(issue);
      }
    }

    // Uniqueness needs cross-row state, so it runs as its own pass rather than per cell.
    // One issue is raised per repeated occurrence, naming the first row it collided with,
    // which is what a caller needs to go fix it.
    for (const [column, rules] of entries) {
      if (rules.unique === undefined || rules.unique === false) continue;
      if (!present.has(column)) continue;
      const keys: readonly string[] = Array.isArray(rules.unique) && rules.unique.length > 0 ? rules.unique : [column];
      const missing = keys.filter((key) => !present.has(key));
      if (missing.length > 0) {
        record({
          code: "MISSING_COLUMN",
          message: new ColumnNotFoundError(missing[0] ?? column, columns).message,
          column: missing[0] ?? column,
          expected: "column present in the dataset",
        });
        continue;
      }
      const firstSeen = new Map<string, number>();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row === undefined) continue;
        const values = keys.map((key) => row[key]);
        // A row with any missing key part is exempt: it is incomplete, not duplicated.
        if (values.some((value) => !isPresent(value))) continue;
        const key = stableKey(values);
        const previous = firstSeen.get(key);
        if (previous === undefined) {
          firstSeen.set(key, index);
          continue;
        }
        record({
          code: "DUPLICATE_VALUE",
          message: `Column "${column}" repeats a value from row ${previous}${keys.length > 1 ? ` (on ${keys.join(", ")})` : ""}.`,
          column,
          row: index,
          value: values.length === 1 ? values[0] : values,
          expected: "unique value",
        });
      }
    }
  }

  return {
    valid: issueCount === 0,
    rowCount: rows.length,
    columnCount: entries.length,
    checked,
    issues,
    issueCount,
    truncated: issueCount > issues.length,
    invalidRows: invalidRowIndexes.size,
    byCode,
  };
}

/** Infer a schema from data, for use as a starting point in a pipeline. */
export function inferSchema(rows: readonly Row[], columns: readonly string[]): Record<string, ColumnRules> {
  const schema: Record<string, ColumnRules> = {};
  for (const column of columns) {
    const values: unknown[] = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) values[index] = rows[index]?.[column];
    const type = inferColumnType(values);
    let nullable = false;
    for (const value of values) {
      if (!isPresent(value)) {
        nullable = true;
        break;
      }
    }
    // `mixed` and `unknown` have no per-value check that would be meaningful, so they are
    // left untyped rather than turned into a type that would reject half the column.
    const declared: ColumnRules = { nullable };
    if (type !== "mixed" && type !== "unknown") declared.type = type;
    schema[column] = declared;
  }
  return schema;
}

/** Describe a dataset's inferred dtype in schema terms. */
export function dtypeToColumnType(type: DType): ColumnType | null {
  return isColumnType(type) ? type : null;
}

/** True when a numeric dtype is expected, used by callers building range checks. */
export function isNumericColumnType(type: ColumnType | undefined): boolean {
  return type !== undefined && NUMERIC_TYPES.has(type);
}
