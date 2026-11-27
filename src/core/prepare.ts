/**
 * Row and column preparation primitives.
 *
 * Every function here is pure: it takes rows and column names and returns new rows, so
 * `Dataset` can expose immutable, chainable methods without the logic living in one
 * oversized class. Rows arriving here are already normalized and frozen, so each function
 * builds fresh records rather than editing in place.
 */
import type { ColumnType, ColumnTypeSpec, Row } from "./types.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent, stableKey } from "../utils/values.js";
import { inferColumnType } from "./schema.js";
import { CastFailure, castCell, resolveCast } from "../io/normalization/schema.js";

/** A prepared pair of rows and the column order that describes them. */
export interface PreparedTable {
  rows: Row[];
  columns: string[];
}

/** Context handed to `replace` matchers and replacers. */
export interface ReplaceContext {
  row: Row;
  column: string;
  index: number;
}

/** One replacement rule. `from` matches by value; `match` matches by predicate. */
export type ReplaceRule =
  | { from: unknown; to: unknown }
  | { from: readonly unknown[]; to: unknown }
  | { match: (value: unknown, context: ReplaceContext) => boolean; to: unknown }
  | ((value: unknown, context: ReplaceContext) => unknown);

/** Strategy for filling missing cells. The three keywords compute from present values. */
export type FillStrategy = "mean" | "median" | "mode" | FillValue | ((row: Row, index: number) => unknown);

/** Constant values accepted by `fillMissing`. */
export type FillValue = string | number | boolean | Date | null;

/** Options for `dropMissing`. */
export interface DropMissingOptions {
  /** Columns to consider. Defaults to every column. */
  columns?: readonly string[];
  /** `any` drops a row when any considered cell is missing; `all` only when all are. */
  how?: "any" | "all";
}

/** Options for `sample`. */
export interface SampleOptions {
  /** Seed for a deterministic draw. Without a seed the draw uses `Math.random`. */
  seed?: number;
  /** Sample with replacement, allowing repeats and counts above the row count. */
  replace?: boolean;
}

/** Case conversion applied by `normalizeText`. */
export type TextCase = "lower" | "upper" | "title";

/** How a text cleanup treats whitespace. */
export type WhitespaceMode = "trim" | "collapse" | "none";

/** Options for `normalizeText`. */
export interface NormalizeTextOptions {
  /** `trim` (default) removes leading/trailing runs; `collapse` also folds inner runs to one space. */
  whitespace?: WhitespaceMode;
  /** Case conversion to apply after whitespace handling. Omit to leave case alone. */
  case?: TextCase;
  /** Extra characters treated as whitespace, e.g. `["\\u00a0"]` for non-breaking spaces. */
  extraWhitespace?: readonly string[];
}

/** One change made by a cleanup operation, used to build before/after reports. */
export interface CleaningChange {
  readonly column: string;
  /** Rows whose value changed. */
  readonly changed: number;
  /** Rows examined. */
  readonly examined: number;
  /** A few example changes, capped so a report stays readable. */
  readonly examples: readonly { readonly row: number; readonly before: unknown; readonly after: unknown }[];
}

/** Outcome of a cleanup operation: the new table plus what changed. */
export interface CleaningResult extends PreparedTable {
  readonly changes: readonly CleaningChange[];
  /** Total rows whose value changed in at least one column. */
  readonly changedRows: number;
}

const FILL_KEYWORDS = new Set(["mean", "median", "mode"]);

function isFillKeyword(value: unknown): value is "mean" | "median" | "mode" {
  return typeof value === "string" && FILL_KEYWORDS.has(value);
}

function assertKnownColumns(columns: readonly string[], requested: readonly string[], method: string): void {
  for (const column of requested) {
    if (!columns.includes(column)) throw new ColumnNotFoundError(column, columns);
  }
  if (requested.length === 0) {
    throw new ValidationError(`${method} expects at least one column.`);
  }
}

function copyRow(row: Row, columns: readonly string[]): Row {
  const copy: Row = {};
  for (const column of columns) copy[column] = row[column];
  return copy;
}

/**
 * Key used for equality in de-duplication and replacement.
 *
 * `isPresent` is the library's notion of missing, so `null` and `undefined` collapse to
 * one key; everything else is compared by value and type, so `1` never matches `"1"`.
 */
function equalityKey(value: unknown): string {
  return isPresent(value) ? stableKey(value) : "\u0000missing";
}

function assertColumnName(name: unknown, method: string): asserts name is string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError(`${method} expects a non-empty column name.`);
  }
}

/**
 * Run a user callback and, if it throws, rethrow with the operation and cell context.
 *
 * A bare `TypeError` from inside a predicate says nothing about which row caused it, so
 * the original error is kept as `cause` while the message names the operation and cell.
 */
function withContext<T>(operation: string, index: number, column: string | null, run: () => T): T {
  try {
    return run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const where = column === null ? `row ${index}` : `row ${index}, column "${column}"`;
    const wrapped = new ValidationError(`${operation} failed at ${where}: ${reason}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

/** Drop columns, keeping the order of the rest. */
export function dropColumns(
  rows: readonly Row[],
  columns: readonly string[],
  toDrop: readonly string[],
): PreparedTable {
  assertKnownColumns(columns, toDrop, "drop");
  const kept = columns.filter((column) => !toDrop.includes(column));
  if (kept.length === 0) {
    throw new ValidationError("drop would remove every column; a dataset needs at least one.");
  }
  return { rows: rows.map((row) => copyRow(row, kept)), columns: kept };
}

/** Rename columns in place, preserving their positions. */
export function renameColumns(
  rows: readonly Row[],
  columns: readonly string[],
  mapping: Readonly<Record<string, string>>,
): PreparedTable {
  const entries = Object.entries(mapping);
  if (entries.length === 0) throw new ValidationError("rename expects a non-empty mapping.");
  for (const [from] of entries) {
    if (!columns.includes(from)) throw new ColumnNotFoundError(from, columns);
  }

  const renamed = columns.map((column) => mapping[column] ?? column);
  const seen = new Set<string>();
  for (const name of renamed) {
    assertColumnName(name, "rename");
    if (seen.has(name)) {
      throw new ValidationError(`rename produces a duplicate column name: "${name}".`);
    }
    seen.add(name);
  }

  return {
    rows: rows.map((row) => {
      const copy: Row = {};
      for (const [position, column] of columns.entries()) {
        const target = renamed[position];
        if (target !== undefined) copy[target] = row[column];
      }
      return copy;
    }),
    columns: renamed,
  };
}

/** Keep rows whose considered cells are present. */
export function dropMissingRows(
  rows: readonly Row[],
  columns: readonly string[],
  options: DropMissingOptions = {},
): PreparedTable {
  const considered = options.columns ?? columns;
  assertKnownColumns(columns, considered, "dropMissing");
  const how = options.how ?? "any";
  if (how !== "any" && how !== "all") {
    throw new ValidationError(`dropMissing "how" must be "any" or "all", received "${String(how)}".`);
  }

  const kept = rows.filter((row) => {
    let missing = 0;
    for (const column of considered) if (!isPresent(row[column])) missing += 1;
    return how === "any" ? missing === 0 : missing < considered.length;
  });
  return { rows: kept.map((row) => copyRow(row, columns)), columns: [...columns] };
}

/** Compute the value used to fill a missing cell for one column. */
function resolveFiller(
  strategy: FillStrategy,
  column: string,
  values: readonly unknown[],
): (row: Row, index: number) => unknown {
  if (typeof strategy === "function") return strategy;

  if (isFillKeyword(strategy)) {
    const present = values.filter(isPresent);
    // A column with nothing to compute from has no mean, median, or mode; leaving the
    // gaps alone is the only answer that does not invent a value.
    if (present.length === 0) return () => null;

    if (strategy === "mode") {
      const counts = new Map<string, { value: unknown; count: number }>();
      for (const value of present) {
        const key = stableKey(value);
        const entry = counts.get(key);
        if (entry === undefined) counts.set(key, { value, count: 1 });
        else entry.count += 1;
      }
      let best: { value: unknown; count: number } | null = null;
      // Iteration follows first-seen order, so a tie resolves to the earliest value.
      for (const entry of counts.values()) {
        if (best === null || entry.count > best.count) best = entry;
      }
      const mode = best === null ? null : best.value;
      return () => cloneValue(mode);
    }

    const type = inferColumnType(present);
    if (type !== "number" && type !== "integer") {
      throw new ValidationError(
        `fillMissing("${strategy}") needs a numeric column, but "${column}" is "${type}". ` +
          `Pass a per-column mapping, for example { "${column}": 0 }.`,
      );
    }
    const numbers = present as number[];
    const total = numbers.reduce((sum, value) => sum + value, 0);
    if (strategy === "mean") {
      const mean = total / numbers.length;
      return () => mean;
    }
    const sorted = [...numbers].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    return () => median;
  }

  const constant = cloneValue(strategy);
  return () => cloneValue(constant);
}

/** Fill missing cells with a computed or constant value. */
export function fillMissingValues(
  rows: readonly Row[],
  columns: readonly string[],
  spec: FillStrategy | Readonly<Record<string, FillStrategy>>,
): PreparedTable {
  const isMapping = spec !== null && typeof spec === "object" && !(spec instanceof Date) && !Array.isArray(spec);

  const targets: string[] = [];
  const fillers = new Map<string, (row: Row, index: number) => unknown>();

  if (isMapping) {
    const mapping = spec as Record<string, FillStrategy>;
    const keys = Object.keys(mapping);
    if (keys.length === 0) throw new ValidationError("fillMissing expects a non-empty mapping.");
    assertKnownColumns(columns, keys, "fillMissing");
    for (const column of keys) {
      const strategy = mapping[column] as FillStrategy;
      const values = rows.map((row) => row[column]);
      fillers.set(column, resolveFiller(strategy, column, values));
      targets.push(column);
    }
  } else {
    for (const column of columns) {
      const values = rows.map((row) => row[column]);
      fillers.set(column, resolveFiller(spec as FillStrategy, column, values));
      targets.push(column);
    }
  }

  const filled = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    for (const column of targets) {
      if (isPresent(row[column])) continue;
      const filler = fillers.get(column);
      if (filler === undefined) continue;
      copy[column] = withContext("fillMissing", index, column, () => filler(row, index));
    }
    return copy;
  });

  return { rows: filled, columns: [...columns] };
}

/** Apply replacement rules, per column, in order. */
export function replaceValues(
  rows: readonly Row[],
  columns: readonly string[],
  rules: Readonly<Record<string, ReplaceRule | readonly ReplaceRule[]>>,
): PreparedTable {
  const keys = Object.keys(rules);
  if (keys.length === 0) throw new ValidationError("replace expects a non-empty mapping.");
  assertKnownColumns(columns, keys, "replace");

  const prepared = new Map<string, ReplaceRule[]>();
  for (const column of keys) {
    const entry = rules[column];
    const list = Array.isArray(entry) ? (entry as readonly ReplaceRule[]) : [entry as ReplaceRule];
    if (list.length === 0) throw new ValidationError(`replace received an empty rule list for "${column}".`);
    for (const rule of list) validateReplaceRule(rule, column);
    prepared.set(column, list as ReplaceRule[]);
  }

  const out = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    for (const [column, list] of prepared) {
      let value = copy[column];
      for (const rule of list) {
        value = withContext("replace", index, column, () => applyReplaceRule(rule, value, { row, column, index }));
      }
      copy[column] = value;
    }
    return copy;
  });

  return { rows: out, columns: [...columns] };
}

function validateReplaceRule(rule: ReplaceRule, column: string): void {
  if (typeof rule === "function") return;
  if (rule === null || typeof rule !== "object") {
    throw new ValidationError(`replace rule for "${column}" must be a function or an object.`);
  }
  const hasMatch = typeof (rule as { match?: unknown }).match === "function";
  const hasFrom = Object.hasOwn(rule, "from");
  if (hasMatch === hasFrom) {
    throw new ValidationError(`replace rule for "${column}" must have exactly one of "from" or "match".`);
  }
  if (!Object.hasOwn(rule, "to")) {
    throw new ValidationError(`replace rule for "${column}" must define "to".`);
  }
}

function applyReplaceRule(rule: ReplaceRule, value: unknown, context: ReplaceContext): unknown {
  if (typeof rule === "function") return rule(value, context);
  if ("match" in rule) return rule.match(value, context) ? cloneValue(rule.to) : value;
  const candidates = Array.isArray(rule.from) ? rule.from : [rule.from];
  const key = equalityKey(value);
  for (const candidate of candidates) {
    if (equalityKey(candidate) === key) return cloneValue(rule.to);
  }
  return value;
}

/** Transform one column's values. */
export function mapColumn(
  rows: readonly Row[],
  columns: readonly string[],
  column: string,
  callback: (value: unknown, row: Row, index: number) => unknown,
): PreparedTable {
  assertKnownColumns(columns, [column], "map");
  if (typeof callback !== "function") throw new ValidationError("map expects a callback function.");

  const out = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    copy[column] = withContext("map", index, column, () => callback(row[column], row, index));
    return copy;
  });
  return { rows: out, columns: [...columns] };
}

/** Append a column computed from each row, or supplied as a value list. */
export function addColumn(
  rows: readonly Row[],
  columns: readonly string[],
  name: string,
  spec: ((row: Row, index: number) => unknown) | readonly unknown[],
): PreparedTable {
  assertColumnName(name, "addColumn");
  if (columns.includes(name)) {
    throw new ValidationError(`addColumn cannot overwrite the existing column "${name}".`);
  }

  let produce: (row: Row, index: number) => unknown;
  if (typeof spec === "function") {
    produce = spec;
  } else if (Array.isArray(spec)) {
    if (spec.length !== rows.length) {
      throw new ValidationError(`addColumn expects ${rows.length} values for "${name}", received ${spec.length}.`);
    }
    produce = (_row, index) => spec[index];
  } else {
    throw new ValidationError("addColumn expects a callback function or an array of values.");
  }

  const nextColumns = [...columns, name];
  const out = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    copy[name] = withContext("addColumn", index, name, () => cloneValue(produce(row, index)));
    return copy;
  });
  return { rows: out, columns: nextColumns };
}

/** Convert columns to explicit types. */
export function castColumns(
  rows: readonly Row[],
  columns: readonly string[],
  schema: Readonly<Record<string, ColumnType | ColumnTypeSpec>>,
): PreparedTable {
  const keys = Object.keys(schema);
  if (keys.length === 0) throw new ValidationError("cast expects a non-empty schema.");
  assertKnownColumns(columns, keys, "cast");

  const casts = keys.map((column) => {
    const entry = schema[column];
    if (entry === undefined) throw new ValidationError(`cast is missing a type for "${column}".`);
    return { column, cast: resolveCast(entry, column) };
  });

  const out = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    for (const { column, cast } of casts) {
      try {
        copy[column] = castCell(row[column], cast);
      } catch (error) {
        const reason = error instanceof CastFailure ? error.message : String(error);
        const wrapped = new ValidationError(`cast failed at row ${index}, column "${column}": ${reason}`);
        wrapped.cause = error;
        throw wrapped;
      }
    }
    return copy;
  });
  return { rows: out, columns: [...columns] };
}

/** Keep the first row for each distinct combination of the chosen columns. */
export function dropDuplicateRows(
  rows: readonly Row[],
  columns: readonly string[],
  subset?: readonly string[],
): PreparedTable {
  const considered = subset ?? columns;
  assertKnownColumns(columns, considered, "dropDuplicates");

  const seen = new Set<string>();
  const kept: Row[] = [];
  for (const row of rows) {
    const key = JSON.stringify(considered.map((column) => equalityKey(row[column])));
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(copyRow(row, columns));
  }
  return { rows: kept, columns: [...columns] };
}

/** Deterministic 32-bit PRNG, so a seeded sample is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a sample of rows, deterministically when a seed is given. */
export function sampleRows(
  rows: readonly Row[],
  columns: readonly string[],
  count: number,
  options: SampleOptions = {},
): PreparedTable {
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError(`sample expects a non-negative integer count, received ${String(count)}.`);
  }
  const replace = options.replace ?? false;
  if (options.seed !== undefined && !Number.isFinite(options.seed)) {
    throw new ValidationError(`sample seed must be a finite number, received ${String(options.seed)}.`);
  }
  if (count > 0 && rows.length === 0) {
    throw new ValidationError("sample cannot draw rows from an empty dataset.");
  }
  if (!replace && count > rows.length) {
    throw new ValidationError(
      `sample cannot draw ${count} rows from ${rows.length} without replacement; pass { replace: true }.`,
    );
  }

  const random = options.seed === undefined ? Math.random : mulberry32(options.seed);
  const picked: Row[] = [];

  if (replace) {
    for (let draw = 0; draw < count; draw += 1) {
      const row = rows[Math.floor(random() * rows.length)];
      if (row !== undefined) picked.push(copyRow(row, columns));
    }
  } else {
    // Partial Fisher-Yates over a copy: shuffle only the prefix that will be returned,
    // so drawing 10 rows from 100 costs ten swaps rather than a full shuffle.
    const pool = [...rows];
    for (let draw = 0; draw < count; draw += 1) {
      const offset = Math.floor(random() * (pool.length - draw));
      const swapIndex = draw + offset;
      const current = pool[draw];
      const other = pool[swapIndex];
      if (current !== undefined && other !== undefined) {
        pool[draw] = other;
        pool[swapIndex] = current;
      }
      const chosen = pool[draw];
      if (chosen !== undefined) picked.push(copyRow(chosen, columns));
    }
  }

  return { rows: picked, columns: [...columns] };
}

// ---------------------------------------------------------------- text cleanup

const MAX_EXAMPLES = 5;

/** Characters stripped when the caller supplies extra whitespace beyond `String.trim`. */
function buildWhitespacePattern(extra: readonly string[]): RegExp | null {
  const parts: string[] = [];
  for (const character of extra) {
    if (typeof character !== "string" || character.length === 0) {
      throw new ValidationError(
        `normalizeText expects non-empty strings in extraWhitespace, received ${String(character)}.`,
      );
    }
    parts.push(character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  return parts.length === 0 ? null : new RegExp(`[${parts.join("")}]`, "g");
}

function applyCase(value: string, mode: TextCase): string {
  switch (mode) {
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "title":
      // Capitalise each word without touching the rest, so "o'brien" becomes "O'brien"
      // rather than losing its apostrophe casing.
      return value.replace(/(^|\s)(\S)/g, (_match, lead: string, first: string) => lead + first.toUpperCase());
    default:
      return value;
  }
}

function normalizeTextValue(value: unknown, options: NormalizeTextOptions, extra: RegExp | null): unknown {
  if (typeof value !== "string") return value;
  let text = value;
  if (extra !== null) text = text.replace(extra, " ");
  const mode = options.whitespace ?? "trim";
  if (mode === "trim") text = text.trim();
  else if (mode === "collapse") text = text.trim().replace(/\s+/g, " ");
  if (options.case !== undefined) text = applyCase(text, options.case);
  return text;
}

/**
 * Normalize text columns: whitespace, optional case, and optional extra whitespace
 * characters.
 *
 * Non-string cells are left untouched rather than coerced. A number `5` and a string
 * `" 5 "` are different problems, and silently turning the number into text would make a
 * numeric column stop being numeric.
 *
 * Returns the new table plus a per-column change report, so a caller can see what moved
 * before accepting it.
 */
export function normalizeText(
  rows: readonly Row[],
  columns: readonly string[],
  targets: readonly string[],
  options: NormalizeTextOptions = {},
): CleaningResult {
  assertKnownColumns(columns, targets, "normalizeText");
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ValidationError("normalizeText expects an options object.");
  }
  if (options.whitespace !== undefined && !["trim", "collapse", "none"].includes(options.whitespace)) {
    throw new ValidationError(
      `normalizeText expects whitespace to be "trim", "collapse" or "none", received ${String(options.whitespace)}.`,
    );
  }
  if (options.case !== undefined && !["lower", "upper", "title"].includes(options.case)) {
    throw new ValidationError(
      `normalizeText expects case to be "lower", "upper" or "title", received ${String(options.case)}.`,
    );
  }
  const extra = buildWhitespacePattern(options.extraWhitespace ?? []);

  const changed = new Map<string, { count: number; examples: { row: number; before: unknown; after: unknown }[] }>();
  for (const column of targets) changed.set(column, { count: 0, examples: [] });
  const changedRows = new Set<number>();

  const out = rows.map((row, index) => {
    const copy = copyRow(row, columns);
    for (const column of targets) {
      const before = copy[column];
      const after = withContext("normalizeText", index, column, () => normalizeTextValue(before, options, extra));
      if (after === before) continue;
      copy[column] = after;
      changedRows.add(index);
      const entry = changed.get(column);
      if (entry === undefined) continue;
      entry.count += 1;
      if (entry.examples.length < MAX_EXAMPLES) {
        entry.examples.push({ row: index, before: cloneValue(before), after: cloneValue(after) });
      }
    }
    return copy;
  });

  const changes: CleaningChange[] = targets.map((column) => {
    const entry = changed.get(column) ?? { count: 0, examples: [] };
    return Object.freeze({
      column,
      changed: entry.count,
      examined: rows.length,
      examples: Object.freeze(entry.examples.map((example) => Object.freeze(example))),
    });
  });

  return { rows: out, columns: [...columns], changes, changedRows: changedRows.size };
}
