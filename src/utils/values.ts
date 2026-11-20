/** True for plain objects (not arrays, not `Date`, not class instances with other prototypes). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Deep copy that preserves `Date` instances and does not share nested references. */
export function cloneValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source)) output[key] = cloneValue(source[key]);
    return output as unknown as T;
  }
  return value;
}

/** Deterministic key for a value, used for equality and de-duplication. */
export function stableKey(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    return `object:{${keys.map((key) => `${JSON.stringify(key)}:${stableKey(source[key])}`).join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

/** Deep freeze that tolerates cycles and non-plain values. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Present = not `null` and not `undefined`. */
export function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Count occurrences of each distinct present value. */
export function countBy<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const k = key(value);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
