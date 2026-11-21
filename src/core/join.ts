/**
 * Dataset joins.
 *
 * A join is expressed as data (keys, strategy, suffix policy) rather than as a callback,
 * so the same call can be logged, tested, and reviewed. The implementation builds a hash
 * index on the right side and streams the left, which keeps a one-to-many join linear in
 * the left row count rather than quadratic.
 */
import type { Row } from "./types.js";
import type { PreparedTable } from "./prepare.js";
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { cloneValue, isPresent } from "../utils/values.js";

/** Supported join strategies. */
export type JoinHow = "inner" | "left" | "right" | "full";

/** Options for `join`. */
export interface JoinOptions {
  /** Key column name, or several for a composite key. */
  readonly on?: string | readonly string[];
  /** Left key columns, for keys named differently on each side. */
  readonly leftOn?: string | readonly string[];
  /** Right key columns. Must pair with `leftOn` position by position. */
  readonly rightOn?: string | readonly string[];
  /** Strategy. Defaults to `"inner"`. */
  readonly how?: JoinHow;
  /** Suffixes applied to both sides when a non-key column name collides. */
  readonly suffixes?: readonly [string, string];
  /**
   * Whether two missing keys count as equal.
   *
   * Defaults to `false`, matching SQL: `null` means "unknown", and an unknown key cannot
   * be known to match another unknown key. Setting this true joins null to null, which is
   * occasionally what a caller wants and is never what they get by accident.
   */
  readonly nullsMatch?: boolean;
  /**
   * Upper bound on result rows, guarding against an accidental Cartesian product.
   *
   * Defaults to 1,000,000. A many-to-many join on a non-unique key multiplies rows, and a
   * silent million-row result is worse than a refusal that names the cause.
   */
  readonly maxRows?: number;
}

/** How a join resolved. */
export interface JoinReport {
  readonly how: JoinHow;
  /** Left key columns used. */
  readonly leftKeys: readonly string[];
  /** Right key columns used. */
  readonly rightKeys: readonly string[];
  /** Result row count. */
  readonly rowCount: number;
  /** Left rows that found at least one match. */
  readonly matched: number;
  /** Left rows with no match. Non-zero only for `left` and `full`. */
  readonly leftUnmatched: number;
  /** Right rows with no match. Non-zero only for `right` and `full`. */
  readonly rightUnmatched: number;
  /** Non-key columns that collided and were suffixed. */
  readonly collisions: readonly string[];
}

/** Joined rows, the resulting column order, and a report. */
export interface JoinResult extends PreparedTable {
  readonly report: JoinReport;
}

const HOWS: ReadonlySet<string> = new Set(["inner", "left", "right", "full"]);
const DEFAULT_MAX_ROWS = 1_000_000;

function toArray(value: string | readonly string[] | undefined, label: string): readonly string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`join expects "${label}" to be a column name or a non-empty array of names.`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ValidationError(`join expects every "${label}" entry to be a non-empty column name.`);
    }
  }
  return value;
}

function assertPresent(columns: readonly string[], requested: readonly string[], side: string): void {
  for (const column of requested) {
    if (columns.includes(column)) continue;
    const error = new ColumnNotFoundError(column, columns);
    error.message = `join could not find ${side} key column: ${error.message}`;
    throw error;
  }
}

interface ResolvedJoin {
  leftKeys: readonly string[];
  rightKeys: readonly string[];
  how: JoinHow;
  suffixes: readonly [string, string];
  nullsMatch: boolean;
  maxRows: number;
}

function resolveOptions(
  leftColumns: readonly string[],
  rightColumns: readonly string[],
  options: JoinOptions,
): ResolvedJoin {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ValidationError("join expects an options object.");
  }

  const how = options.how ?? "inner";
  if (!HOWS.has(how)) {
    throw new ValidationError(`join expects "how" to be one of inner, left, right, full, received "${String(how)}".`);
  }

  const on = toArray(options.on, "on");
  const leftOn = toArray(options.leftOn, "leftOn");
  const rightOn = toArray(options.rightOn, "rightOn");

  let leftKeys: readonly string[];
  let rightKeys: readonly string[];

  if (on.length > 0) {
    if (leftOn.length > 0 || rightOn.length > 0) {
      throw new ValidationError('join accepts either "on" or "leftOn"/"rightOn", not both.');
    }
    leftKeys = on;
    rightKeys = on;
  } else {
    if (leftOn.length === 0 || rightOn.length === 0) {
      throw new ValidationError('join expects "on", or both "leftOn" and "rightOn".');
    }
    if (leftOn.length !== rightOn.length) {
      throw new ValidationError(
        `join expects "leftOn" and "rightOn" to have the same length, received ${leftOn.length} and ${rightOn.length}.`,
      );
    }
    leftKeys = leftOn;
    rightKeys = rightOn;
  }

  assertPresent(leftColumns, leftKeys, "left");
  assertPresent(rightColumns, rightKeys, "right");

  const suffixes = options.suffixes ?? ["_left", "_right"];
  if (!Array.isArray(suffixes) || suffixes.length !== 2) {
    throw new ValidationError("join expects two suffixes.");
  }
  if (suffixes[0] === suffixes[1]) {
    throw new ValidationError(
      `join suffixes must differ, otherwise the joined columns stay ambiguous. Received "${suffixes[0]}" twice.`,
    );
  }

  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 0) {
    throw new ValidationError(`join expects "maxRows" to be a non-negative integer, received ${String(maxRows)}.`);
  }

  return { leftKeys, rightKeys, how, suffixes, nullsMatch: options.nullsMatch === true, maxRows };
}

/**
 * Key for a row's join columns.
 *
 * Returns `null` when any component is missing and `nullsMatch` is off, which callers
 * treat as "cannot match anything" — the SQL reading of a null key. Each component is
 * tagged with its type so `1` never matches `"1"`.
 */
function keyOf(row: Row, keys: readonly string[], nullsMatch: boolean): string | null {
  const parts: string[] = [];
  for (const key of keys) {
    const value = row[key];
    if (!isPresent(value)) {
      if (!nullsMatch) return null;
      parts.push("\u0000missing");
      continue;
    }
    parts.push(`${typeof value}:${String(value)}`);
  }
  return parts.join("\u0001");
}

/** Plan the output columns, suffixing only the names that actually collide. */
function planColumns(
  leftColumns: readonly string[],
  rightColumns: readonly string[],
  leftKeys: readonly string[],
  rightKeys: readonly string[],
  suffixes: readonly [string, string],
): { columns: string[]; leftNames: string[]; rightNames: string[]; included: string[]; collisions: string[] } {
  // A right key column is redundant when it carries the same name as its left partner:
  // the values are equal by definition, so keeping both would duplicate information.
  const included = rightColumns.filter((column, position) => {
    const partner = rightKeys.indexOf(column);
    if (partner === -1) return true;
    return leftKeys[partner] !== rightColumns[position] && !leftKeys.includes(column);
  });

  const collisions = included.filter((column) => leftColumns.includes(column));
  const leftNames = leftColumns.map((column) => (collisions.includes(column) ? `${column}${suffixes[0]}` : column));
  const rightNames = included.map((column) => (collisions.includes(column) ? `${column}${suffixes[1]}` : column));

  const columns = [...leftNames, ...rightNames];
  if (new Set(columns).size !== columns.length) {
    throw new ValidationError(`join produced duplicate column names: ${columns.join(", ")}. Pass distinct "suffixes".`);
  }
  return { columns, leftNames, rightNames, included, collisions };
}

/** Join two tables on one or more key columns. */
export function joinTables(
  leftRows: readonly Row[],
  leftColumns: readonly string[],
  rightRows: readonly Row[],
  rightColumns: readonly string[],
  options: JoinOptions,
): JoinResult {
  const { leftKeys, rightKeys, how, suffixes, nullsMatch, maxRows } = resolveOptions(
    leftColumns,
    rightColumns,
    options,
  );
  const { columns, leftNames, rightNames, included, collisions } = planColumns(
    leftColumns,
    rightColumns,
    leftKeys,
    rightKeys,
    suffixes,
  );

  // `inner` emits a row only when both sides matched, so an unmatched left row is
  // dropped rather than padded with nulls.
  const keepLeftUnmatched = how === "left" || how === "full";
  const wantsRight = how === "right" || how === "full";

  const index = new Map<string, number[]>();
  rightRows.forEach((row, position) => {
    const key = keyOf(row, rightKeys, nullsMatch);
    if (key === null) return;
    const bucket = index.get(key);
    if (bucket === undefined) index.set(key, [position]);
    else bucket.push(position);
  });

  const out: Row[] = [];
  const usedRight = new Set<number>();
  let matched = 0;
  let leftUnmatched = 0;

  const guard = (): void => {
    if (out.length > maxRows) {
      throw new ValidationError(
        `join exceeded maxRows (${maxRows}) at the left row that pushed it over. ` +
          "A many-to-many join multiplies rows; deduplicate a key or raise maxRows deliberately.",
      );
    }
  };

  const emit = (left: Row | null, right: Row | null): void => {
    const row: Row = {};
    leftNames.forEach((name, position) => {
      const column = leftColumns[position] as string;
      // The right key column is not carried into the output because it equals its left
      // partner. When the left side is absent (right and full joins) the key would
      // otherwise be lost, so it is sourced from the right row instead.
      const partner = leftKeys.indexOf(column);
      const fromRight = right !== null && partner !== -1 ? right[rightKeys[partner] as string] : null;
      row[name] = cloneValue(left === null ? fromRight : left[column]);
    });
    rightNames.forEach((name, position) => {
      row[name] = cloneValue(right === null ? null : right[included[position] as string]);
    });
    out.push(row);
    guard();
  };

  for (const leftRow of leftRows) {
    const key = keyOf(leftRow, leftKeys, nullsMatch);
    const bucket = key === null ? undefined : index.get(key);
    if (bucket === undefined || bucket.length === 0) {
      leftUnmatched += 1;
      if (keepLeftUnmatched) emit(leftRow, null);
      continue;
    }
    matched += 1;
    for (const position of bucket) {
      usedRight.add(position);
      emit(leftRow, rightRows[position] as Row);
    }
  }

  let rightUnmatched = 0;
  if (wantsRight) {
    rightRows.forEach((row, position) => {
      if (usedRight.has(position)) return;
      rightUnmatched += 1;
      emit(null, row);
    });
  } else {
    rightUnmatched = rightRows.length - usedRight.size;
  }

  return {
    rows: out,
    columns,
    report: Object.freeze({
      how,
      leftKeys: Object.freeze([...leftKeys]),
      rightKeys: Object.freeze([...rightKeys]),
      rowCount: out.length,
      matched,
      leftUnmatched,
      rightUnmatched,
      collisions: Object.freeze([...collisions]),
    }),
  };
}
