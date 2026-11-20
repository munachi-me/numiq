/**
 * Ordering shared by `Dataset.sort` and `Query.orderBy`.
 *
 * Both must agree on what "smaller" means, otherwise a sorted dataset and a query ordered
 * by the same column would disagree. One comparator keeps that guarantee in one place.
 */

/**
 * Compare two present values.
 *
 * Numbers and dates compare numerically, booleans compare false < true, and everything
 * else compares as text. `Dataset.sort` handles nullish values before calling this, so
 * callers must not pass `null` or `undefined`.
 */
export function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return Math.sign(left.getTime() - right.getTime());
  if (typeof left === "number" && typeof right === "number") return Math.sign(left - right);
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}
