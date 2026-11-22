import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { inferSchema, validateRows } from "../../src/core/validation.js";
import { ValidationError } from "../../src/errors/index.js";

const people = () => [
  { name: "Ada", age: 36, role: "admin" },
  { name: "Grace", age: 45, role: "user" },
];

describe("validateRows — required columns", () => {
  it("passes when every named column exists", () => {
    const report = createDataset(people()).validate({ name: { type: "string" }, age: { type: "number" } });
    expect(report.valid).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.rowCount).toBe(2);
    expect(report.columnCount).toBe(2);
  });

  it("reports a missing column once rather than once per row", () => {
    const report = createDataset(people()).validate({ missing: { type: "string" } });
    expect(report.valid).toBe(false);
    expect(report.issueCount).toBe(1);
    expect(report.issues[0]?.code).toBe("MISSING_COLUMN");
    expect(report.issues[0]?.column).toBe("missing");
    expect(report.issues[0]?.row).toBeUndefined();
  });

  it("names the available columns in the missing-column message", () => {
    const report = createDataset(people()).validate({ nope: {} });
    expect(report.issues[0]?.message).toContain("name");
    expect(report.issues[0]?.message).toContain("age");
  });

  it("treats a column listed with no rules as a presence check", () => {
    expect(createDataset(people()).validate({ name: {} }).valid).toBe(true);
    expect(createDataset(people()).validate({ absent: {} }).valid).toBe(false);
  });
});

describe("validateRows — types", () => {
  it("accepts matching types", () => {
    const report = createDataset(people()).validate({
      name: { type: "string" },
      age: { type: "integer" },
      role: { type: "string" },
    });
    expect(report.valid).toBe(true);
  });

  it("rejects a mismatched type with row and column context", () => {
    // Normalization would turn "36" into 36 before validation, so disable inference to
    // keep the string that this test is about.
    const raw = createDataset([{ age: "36" }], { normalization: { inferTypes: false } });
    const report = raw.validate({ age: { type: "number" } });
    expect(report.valid).toBe(false);
    expect(report.issues[0]?.code).toBe("TYPE_MISMATCH");
    expect(report.issues[0]?.row).toBe(0);
    expect(report.issues[0]?.column).toBe("age");
    expect(report.issues[0]?.value).toBe("36");
    expect(report.issues[0]?.expected).toBe("number");
  });

  it("does not accept a float where an integer is required", () => {
    expect(createDataset([{ n: 1.5 }]).validate({ n: { type: "integer" } }).valid).toBe(false);
  });

  it("rejects NaN and Infinity for number", () => {
    expect(createDataset([{ n: Number.NaN }]).validate({ n: { type: "number" } }).valid).toBe(false);
    expect(createDataset([{ n: Number.POSITIVE_INFINITY }]).validate({ n: { type: "number" } }).valid).toBe(false);
  });

  it("accepts booleans only for boolean", () => {
    expect(createDataset([{ b: true }]).validate({ b: { type: "boolean" } }).valid).toBe(true);
    const raw = createDataset([{ b: "true" }], { normalization: { inferTypes: false } });
    expect(raw.validate({ b: { type: "boolean" } }).valid).toBe(false);
  });

  it("accepts both a Date and an ISO string for a date column", () => {
    const asDate = createDataset([{ d: new Date("2026-11-20T00:00:00Z") }], { columns: ["d"] });
    const asText = createDataset([{ d: "2026-11-20" }]);
    expect(asDate.validate({ d: { type: "date" } }).valid).toBe(true);
    expect(asText.validate({ d: { type: "date" } }).valid).toBe(true);
  });

  it("rejects an invalid Date instance for a date column", () => {
    const data = createDataset([{ d: new Date("nope") }], { columns: ["d"] });
    expect(data.validate({ d: { type: "date" } }).valid).toBe(false);
  });

  it("checks a datetime column against ISO date-times", () => {
    expect(createDataset([{ t: "2026-11-20T10:00:00Z" }]).validate({ t: { type: "datetime" } }).valid).toBe(true);
    expect(createDataset([{ t: "2026-11-20" }]).validate({ t: { type: "datetime" } }).valid).toBe(false);
  });

  it("checks a time column against ISO times", () => {
    // Seconds are optional, matching `inferColumnType`, so validation and inference agree
    // on what a time column is.
    expect(createDataset([{ t: "10:30:00" }]).validate({ t: { type: "time" } }).valid).toBe(true);
    expect(createDataset([{ t: "10:30" }]).validate({ t: { type: "time" } }).valid).toBe(true);
    expect(createDataset([{ t: "25:00:00" }]).validate({ t: { type: "time" } }).valid).toBe(false);
    expect(createDataset([{ t: "10:30 pm" }]).validate({ t: { type: "time" } }).valid).toBe(false);
  });

  it("stops checking a cell after a type mismatch", () => {
    const report = createDataset([{ age: "old" }]).validate({ age: { type: "number", min: 0 } });
    expect(report.issueCount).toBe(1);
    expect(report.issues[0]?.code).toBe("TYPE_MISMATCH");
  });
});

describe("validateRows — nullability", () => {
  it("allows missing values by default", () => {
    expect(createDataset([{ a: null }]).validate({ a: { type: "number" } }).valid).toBe(true);
  });

  it("rejects missing values when nullable is false", () => {
    const report = createDataset([{ a: null }, { a: 1 }]).validate({ a: { nullable: false } });
    expect(report.valid).toBe(false);
    expect(report.issueCount).toBe(1);
    expect(report.issues[0]?.code).toBe("NULL_NOT_ALLOWED");
    expect(report.issues[0]?.row).toBe(0);
  });

  it("does not apply type or range rules to a missing value", () => {
    const report = createDataset([{ a: null }]).validate({ a: { type: "number", min: 10 } });
    expect(report.valid).toBe(true);
  });
});

describe("validateRows — ranges", () => {
  it("accepts values inside an inclusive range", () => {
    const report = createDataset([{ n: 0 }, { n: 10 }]).validate({ n: { min: 0, max: 10 } });
    expect(report.valid).toBe(true);
  });

  it("reports a value below the minimum", () => {
    const report = createDataset([{ n: -1 }]).validate({ n: { min: 0 } });
    expect(report.issues[0]?.code).toBe("BELOW_MINIMUM");
    expect(report.issues[0]?.expected).toBe(">= 0");
  });

  it("reports a value above the maximum", () => {
    const report = createDataset([{ n: 11 }]).validate({ n: { max: 10 } });
    expect(report.issues[0]?.code).toBe("ABOVE_MAXIMUM");
    expect(report.issues[0]?.expected).toBe("<= 10");
  });

  it("compares dates by instant", () => {
    const data = createDataset([{ d: "2026-11-20" }]);
    expect(data.validate({ d: { min: "2026-11-01", max: "2026-11-30" } }).valid).toBe(true);
    expect(data.validate({ d: { min: "2026-12-01" } }).valid).toBe(false);
  });

  it("reports a value that cannot be ordered against a bound", () => {
    const report = createDataset([{ d: "not-a-date" }]).validate({ d: { type: "string", min: "2026-01-01" } });
    expect(report.issues[0]?.code).toBe("NOT_ORDERABLE");
  });
});

describe("validateRows — allowed values", () => {
  it("accepts a value from the list", () => {
    expect(createDataset([{ r: "admin" }]).validate({ r: { allowed: ["admin", "user"] } }).valid).toBe(true);
  });

  it("rejects a value outside the list", () => {
    const report = createDataset([{ r: "root" }]).validate({ r: { allowed: ["admin", "user"] } });
    expect(report.issues[0]?.code).toBe("NOT_ALLOWED");
    expect(report.issues[0]?.expected).toBe("admin, user");
  });

  it('does not treat 1 and "1" as the same allowed value', () => {
    // `compareValues` would call these equal; an allow-list must not. Normalization is
    // disabled so the string stays a string.
    const raw = createDataset([{ n: "1" }], { normalization: { inferTypes: false } });
    expect(raw.validate({ n: { allowed: [1] } }).valid).toBe(false);
    expect(createDataset([{ n: 1 }]).validate({ n: { allowed: [1] } }).valid).toBe(true);
  });

  it("matches dates in an allow-list by instant", () => {
    const data = createDataset([{ d: new Date("2026-11-20T00:00:00Z") }], { columns: ["d"] });
    expect(data.validate({ d: { allowed: [new Date("2026-11-20T00:00:00Z")] } }).valid).toBe(true);
  });
});

describe("validateRows — pattern and length", () => {
  it("matches the whole value, not a substring", () => {
    expect(createDataset([{ s: "abc123" }]).validate({ s: { pattern: "[a-z]+\\d+" } }).valid).toBe(true);
    expect(createDataset([{ s: "abc123xyz" }]).validate({ s: { pattern: "[a-z]+\\d+" } }).valid).toBe(false);
  });

  it("reports a pattern mismatch", () => {
    const report = createDataset([{ s: "ABC" }]).validate({ s: { pattern: "[a-z]+" } });
    expect(report.issues[0]?.code).toBe("PATTERN_MISMATCH");
    expect(report.issues[0]?.expected).toBe("[a-z]+");
  });

  it("rejects a non-string where a pattern is required", () => {
    const report = createDataset([{ s: 5 }]).validate({ s: { pattern: "\\d+" } });
    expect(report.issues[0]?.code).toBe("PATTERN_NOT_APPLICABLE");
  });

  it("checks string length bounds", () => {
    expect(createDataset([{ s: "abc" }]).validate({ s: { minLength: 2, maxLength: 4 } }).valid).toBe(true);
    expect(createDataset([{ s: "a" }]).validate({ s: { minLength: 2 } }).issues[0]?.code).toBe("TOO_SHORT");
    expect(createDataset([{ s: "abcde" }]).validate({ s: { maxLength: 4 } }).issues[0]?.code).toBe("TOO_LONG");
  });

  it("counts length in code units, so an emoji is two", () => {
    expect(createDataset([{ s: "😀" }]).validate({ s: { minLength: 2, maxLength: 2 } }).valid).toBe(true);
  });
});

describe("validateRows — custom validators", () => {
  it("accepts a true return", () => {
    const report = createDataset([{ n: 4 }]).validate({ n: { validate: (value) => (value as number) % 2 === 0 } });
    expect(report.valid).toBe(true);
  });

  it("rejects a false return", () => {
    const report = createDataset([{ n: 3 }]).validate({ n: { validate: (value) => (value as number) % 2 === 0 } });
    expect(report.issues[0]?.code).toBe("CUSTOM_VALIDATOR_FAILED");
  });

  it("uses a returned string as the message", () => {
    const report = createDataset([{ n: 3 }]).validate({ n: { validate: () => "must be even" } });
    expect(report.issues[0]?.message).toContain("must be even");
  });

  it("passes the row and index to the validator", () => {
    const seen: Array<[unknown, number]> = [];
    createDataset(people()).validate({
      age: {
        validate: (value, row, index) => {
          seen.push([row.name, index]);
          return true;
        },
      },
    });
    expect(seen).toEqual([
      ["Ada", 0],
      ["Grace", 1],
    ]);
  });

  it("reports a validator that throws instead of letting it escape", () => {
    const report = createDataset([{ n: 1 }]).validate({
      n: {
        validate: () => {
          throw new Error("boom");
        },
      },
    });
    expect(report.issues[0]?.code).toBe("CUSTOM_VALIDATOR_THREW");
    expect(report.issues[0]?.message).toContain("boom");
  });
});

describe("validateRows — reports", () => {
  it("counts invalid rows, not invalid cells", () => {
    const data = createDataset([
      { a: -1, b: -1 },
      { a: 5, b: 5 },
    ]);
    const report = data.validate({ a: { min: 0 }, b: { min: 0 } });
    expect(report.issueCount).toBe(2);
    expect(report.invalidRows).toBe(1);
  });

  it("groups counts by code", () => {
    const report = createDataset([{ a: "x" }, { a: "y" }]).validate({ a: { type: "number" } });
    expect(report.byCode).toEqual({ TYPE_MISMATCH: 2 });
  });

  it("caps the issue list and says it truncated", () => {
    const rows = Array.from({ length: 10 }, () => ({ a: "x" }));
    const report = createDataset(rows).validate({ a: { type: "number" } }, { maxIssues: 3 });
    expect(report.issues).toHaveLength(3);
    expect(report.issueCount).toBe(10);
    expect(report.truncated).toBe(true);
  });

  it("does not mark a report truncated when nothing was cut", () => {
    const report = createDataset([{ a: "x" }]).validate({ a: { type: "number" } });
    expect(report.truncated).toBe(false);
  });

  it("counts every cell it checked", () => {
    const report = createDataset(people()).validate({ name: {}, age: {} });
    expect(report.checked).toBe(4);
  });

  it("checks no cells with columnsOnly", () => {
    const report = createDataset(people()).validate({ name: { type: "number" } }, { columnsOnly: true });
    expect(report.valid).toBe(true);
    expect(report.checked).toBe(0);
  });

  it("reports an empty dataset as valid", () => {
    const report = createDataset([], { columns: ["a"] }).validate({ a: { type: "number" } });
    expect(report.valid).toBe(true);
    expect(report.rowCount).toBe(0);
  });
});

describe("validateRows — schema errors", () => {
  it("rejects a non-object schema", () => {
    expect(() => validateRows([], [], null as never)).toThrow(ValidationError);
    expect(() => validateRows([], [], [] as never)).toThrow(ValidationError);
  });

  it("rejects a non-object column rules value", () => {
    expect(() => validateRows([], ["a"], { a: "number" as never })).toThrow(ValidationError);
  });

  it("rejects an unknown type", () => {
    expect(() => validateRows([], ["a"], { a: { type: "float" as never } })).toThrow(/not a supported type/);
  });

  it("rejects an invalid pattern", () => {
    expect(() => validateRows([], ["a"], { a: { pattern: "[" } })).toThrow(/not a valid regular expression/);
  });

  it("rejects min greater than max", () => {
    expect(() => validateRows([], ["a"], { a: { min: 10, max: 1 } })).toThrow(/exceeds/);
  });

  it("rejects minLength greater than maxLength", () => {
    expect(() => validateRows([], ["a"], { a: { minLength: 5, maxLength: 2 } })).toThrow(/exceeds/);
  });

  it("rejects a negative length bound", () => {
    expect(() => validateRows([], ["a"], { a: { minLength: -1 } })).toThrow(/non-negative integer/);
  });

  it("rejects a non-positive maxIssues", () => {
    expect(() => validateRows([], ["a"], { a: {} }, { maxIssues: 0 })).toThrow(ValidationError);
  });

  it("rejects a non-function validator", () => {
    expect(() => validateRows([], ["a"], { a: { validate: "no" as never } })).toThrow(/must be a function/);
  });
});

describe("Dataset.validate", () => {
  it("returns the report without modifying the dataset", () => {
    const data = createDataset(people());
    const before = data.data;
    data.validate({ age: { type: "number" } });
    expect(data.data).toEqual(before);
  });

  it("throws from validateOrThrow and names the first issue", () => {
    const data = createDataset([{ age: "x" }]);
    expect(() => data.validateOrThrow({ age: { type: "number" } })).toThrow(/First issue/);
  });

  it("returns the same dataset from validateOrThrow on success", () => {
    const data = createDataset(people());
    expect(data.validateOrThrow({ name: {} })).toBe(data);
  });
});

describe("inferSchema", () => {
  it("infers types and nullability from data", () => {
    const data = createDataset([
      { a: 1, b: "x", c: true },
      { a: null, b: "y", c: false },
    ]);
    const schema = inferSchema(data.data, data.columns);
    expect(schema.a).toEqual({ type: "integer", nullable: true });
    expect(schema.b).toEqual({ type: "string", nullable: false });
    expect(schema.c).toEqual({ type: "boolean", nullable: false });
  });

  it("leaves a mixed column untyped", () => {
    const data = createDataset([{ a: 1 }, { a: "x" }]);
    const schema = inferSchema(data.data, data.columns);
    expect(schema.a?.type).toBeUndefined();
  });

  it("produces a schema that the same data passes", () => {
    const data = createDataset(people());
    const schema = inferSchema(data.data, data.columns);
    expect(data.validate(schema).valid).toBe(true);
  });
});
