import { describe, it, expect } from "vitest";
import { normalizeCell } from "../../src/io/normalization/values.js";
import { resolveNormalization, DEFAULT_NORMALIZATION } from "../../src/io/normalization/policy.js";
import { castCell, resolveCast, CastFailure } from "../../src/io/normalization/schema.js";
import { ValidationError } from "../../src/errors/index.js";

const policy = resolveNormalization(undefined);

describe("normalizeCell defaults", () => {
  it("does not trim by default", () => {
    expect(normalizeCell("  Ada  ", policy).value).toBe("  Ada  ");
  });

  it("trims when asked", () => {
    const trimmed = resolveNormalization({ trimStrings: true });
    expect(normalizeCell("  Ada  ", trimmed).value).toBe("Ada");
  });

  it("maps the empty string to null", () => {
    expect(normalizeCell("", policy).value).toBeNull();
  });

  it("preserves NA, null, and N/A as data", () => {
    expect(normalizeCell("NA", policy).value).toBe("NA");
    expect(normalizeCell("null", policy).value).toBe("null");
    expect(normalizeCell("N/A", policy).value).toBe("N/A");
  });

  it("treats opted-in markers as null, case-insensitively", () => {
    const custom = resolveNormalization({ nullValues: ["", "NA", "n/a"] });
    expect(normalizeCell("NA", custom).value).toBeNull();
    expect(normalizeCell("n/a", custom).value).toBeNull();
    expect(normalizeCell("null", custom).value).toBe("null");
  });

  it("infers numbers and booleans", () => {
    expect(normalizeCell("42", policy).value).toBe(42);
    expect(normalizeCell("-3.5", policy).value).toBe(-3.5);
    expect(normalizeCell("1e5", policy).value).toBe(100000);
    expect(normalizeCell("TRUE", policy).value).toBe(true);
    expect(normalizeCell("false", policy).value).toBe(false);
  });

  it("keeps leading-zero identifiers as strings", () => {
    expect(normalizeCell("007", policy).value).toBe("007");
    expect(normalizeCell("0012", policy).value).toBe("0012");
  });

  it("keeps plus-prefixed values as strings so phone numbers survive", () => {
    expect(normalizeCell("+26481234", policy).value).toBe("+26481234");
  });

  it("keeps unsafe integers as strings and reports the issue", () => {
    const result = normalizeCell("9007199254740993", policy);
    expect(result.value).toBe("9007199254740993");
    expect(result.issue).toBe("unsafe-integer");
  });

  it("accepts safe integers as numbers", () => {
    const result = normalizeCell("9007199254740991", policy);
    expect(result.value).toBe(9007199254740991);
    expect(result.issue).toBeUndefined();
  });

  it("leaves non-numeric text alone", () => {
    expect(normalizeCell("1_000", policy).value).toBe("1_000");
    expect(normalizeCell("abc", policy).value).toBe("abc");
  });

  it("skips inference when inferTypes is false", () => {
    const literal = resolveNormalization({ inferTypes: false });
    expect(normalizeCell("42", literal).value).toBe("42");
    expect(normalizeCell("true", literal).value).toBe("true");
  });

  it("passes non-string values through untouched", () => {
    const date = new Date("2026-01-05T00:00:00Z");
    expect(normalizeCell(date, policy).value).toBe(date);
    expect(normalizeCell(7, policy).value).toBe(7);
    expect(normalizeCell(null, policy).value).toBeNull();
  });
});

describe("normalization policy", () => {
  it("exposes a frozen default with only the empty string as a null marker", () => {
    expect(DEFAULT_NORMALIZATION.nullValues).toEqual([""]);
    expect(Object.isFrozen(DEFAULT_NORMALIZATION)).toBe(true);
  });

  it("merges partial overrides over the defaults", () => {
    const merged = resolveNormalization({ trimStrings: true });
    expect(merged.trimStrings).toBe(true);
    expect(merged.inferTypes).toBe(true);
  });
});

describe("castCell", () => {
  it("casts to string, number, and integer", () => {
    expect(castCell(42, { type: "string" })).toBe("42");
    expect(castCell("42", { type: "number" })).toBe(42);
    expect(castCell("42", { type: "integer" })).toBe(42);
  });

  it("rejects non-integer values for integer columns", () => {
    expect(() => castCell("4.5", { type: "integer" })).toThrow(CastFailure);
  });

  it("rejects non-numeric text for number columns", () => {
    expect(() => castCell("abc", { type: "number" })).toThrow(CastFailure);
  });

  it("casts booleans from strings and 0/1", () => {
    expect(castCell("true", { type: "boolean" })).toBe(true);
    expect(castCell("0", { type: "boolean" })).toBe(false);
    expect(castCell(1, { type: "boolean" })).toBe(true);
    expect(() => castCell("yes", { type: "boolean" })).toThrow(CastFailure);
  });

  it("casts ISO dates to UTC-midnight Date objects", () => {
    const value = castCell("2026-01-05", { type: "date" }) as Date;
    expect(value).toBeInstanceOf(Date);
    expect(value.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("rejects non-ISO dates", () => {
    expect(() => castCell("05/01/2026", { type: "date" })).toThrow(CastFailure);
  });

  it("casts datetimes to Date objects", () => {
    const value = castCell("2026-01-05T14:30:00Z", { type: "datetime" }) as Date;
    expect(value.toISOString()).toBe("2026-01-05T14:30:00.000Z");
  });

  it("canonicalizes times to HH:MM:SS strings", () => {
    expect(castCell("14:30", { type: "time" })).toBe("14:30:00");
    expect(castCell("14:30:05", { type: "time" })).toBe("14:30:05");
  });

  it("returns null for nullish input", () => {
    expect(castCell(null, { type: "number" })).toBeNull();
    expect(castCell(undefined, { type: "date" })).toBeNull();
  });
});

describe("resolveCast", () => {
  it("accepts type names and aliases", () => {
    expect(resolveCast("int", "c").type).toBe("integer");
    expect(resolveCast("float", "c").type).toBe("number");
    expect(resolveCast("text", "c").type).toBe("string");
    expect(resolveCast("bool", "c").type).toBe("boolean");
  });

  it("accepts descriptors with a format", () => {
    expect(resolveCast({ type: "date", format: "YYYY-MM-DD" }, "c")).toEqual({
      type: "date",
      format: "YYYY-MM-DD",
    });
  });

  it("rejects unknown types", () => {
    expect(() => resolveCast("uuid", "c")).toThrow(ValidationError);
  });

  it("rejects unsupported descriptor keys", () => {
    expect(() => resolveCast({ type: "date", timezone: "UTC" } as never, "c")).toThrow(ValidationError);
  });
});
