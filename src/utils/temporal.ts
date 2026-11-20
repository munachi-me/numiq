const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;
const TIME_ONLY = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;

/** True when the string is an ISO calendar date such as `2026-11-03`. */
export function isIsoDate(value: string): boolean {
  return DATE_ONLY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** True when the string is an ISO date-time with optional zone designator. */
export function isIsoDateTime(value: string): boolean {
  return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value.replace(" ", "T")));
}

/** True when the string is a wall-clock time such as `14:30:00`. */
export function isIsoTime(value: string): boolean {
  return TIME_ONLY.test(value);
}

/** Parse an ISO date into a UTC-midnight `Date`. Throws on invalid input. */
export function parseIsoDate(value: string): Date {
  if (!isIsoDate(value)) throw new RangeError(`Not an ISO date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Parse an ISO date-time into a `Date`. Throws on invalid input. */
export function parseIsoDateTime(value: string): Date {
  if (!isIsoDateTime(value)) throw new RangeError(`Not an ISO date-time: ${value}`);
  return new Date(value.replace(" ", "T"));
}

/** Format a `Date` as an ISO calendar date in UTC. */
export function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
