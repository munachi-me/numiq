import { describe, it, expect } from "vitest";
import { parseJSON } from "../../src/io/parsers/json.js";
import { FormatError, ValidationError } from "../../src/errors/index.js";

describe("array of records", () => {
  it("reads records and unions their keys", () => {
    const data = parseJSON('[{"a":1},{"b":2}]');
    expect(data.columns).toEqual(["a", "b"]);
    expect(data.data).toEqual([
      { a: 1, b: null },
      { a: null, b: 2 },
    ]);
  });

  it("accepts an already-parsed value", () => {
    expect(parseJSON([{ a: 1 }]).data).toEqual([{ a: 1 }]);
  });

  it("preserves nested objects", () => {
    const data = parseJSON('[{"a":{"b":1}}]');
    expect(data.data[0]!.a).toEqual({ b: 1 });
    expect(data.dtypes.a).toBe("mixed");
  });

  it("accepts an empty array with declared columns", () => {
    const data = parseJSON("[]", { columns: ["a"] });
    expect(data.columns).toEqual(["a"]);
    expect(data.rowCount).toBe(0);
  });

  it("rejects an empty array without columns", () => {
    expect(parseJSON("[]").columns).toEqual([]);
  });
});

describe("array of arrays", () => {
  it("maps cells onto supplied columns", () => {
    const data = parseJSON("[[1,2],[3,4]]", { columns: ["a", "b"] });
    expect(data.data).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  it("requires columns", () => {
    expect(() => parseJSON("[[1,2]]")).toThrow(/require an explicit `columns` option/);
  });

  it("pads short rows and warns", () => {
    const data = parseJSON("[[1],[2,3]]", { columns: ["a", "b"] });
    expect(data.data).toEqual([
      { a: 1, b: null },
      { a: 2, b: 3 },
    ]);
    expect(data.importReport!.warnings[0]!.code).toBe("ragged-row");
  });
});

describe("column-oriented objects", () => {
  it("converts parallel arrays into rows", () => {
    const data = parseJSON('{"name":["Ada","Lin"],"age":[36,41]}');
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.data).toEqual([
      { name: "Ada", age: 36 },
      { name: "Lin", age: 41 },
    ]);
  });

  it("rejects arrays of unequal length", () => {
    expect(() => parseJSON('{"a":[1,2],"b":[3]}')).toThrow(/equal lengths/);
  });

  it("rejects non-array properties", () => {
    expect(() => parseJSON('{"a":1}')).toThrow(/not an array/);
  });

  it("accepts an empty object", () => {
    expect(parseJSON("{}").rowCount).toBe(0);
  });
});

describe("rejected input", () => {
  it("rejects malformed JSON text", () => {
    expect(() => parseJSON("{oops")).toThrow(FormatError);
  });

  it("rejects top-level scalars", () => {
    expect(() => parseJSON("42")).toThrow(/expected an array of records/);
    expect(() => parseJSON('"text"')).toThrow(FormatError);
  });

  it("rejects null", () => {
    expect(() => parseJSON("null")).toThrow(FormatError);
  });

  it("rejects mixed record and array rows", () => {
    expect(() => parseJSON('[{"a":1},[2]]')).toThrow(/must contain only objects/);
  });
});

describe("schemas and normalization", () => {
  it("casts declared types", () => {
    const data = parseJSON('[{"amount":"10","active":"true"}]', {
      schema: { amount: "number", active: "boolean" },
    });
    expect(data.data[0]).toEqual({ amount: 10, active: true });
  });

  it("casts dates to Date objects", () => {
    const data = parseJSON('[{"d":"2026-01-05"}]', { schema: { d: "date" } });
    expect(data.data[0]!.d).toBeInstanceOf(Date);
  });

  it("does not auto-convert dates without a schema", () => {
    const data = parseJSON('[{"d":"2026-01-05"}]');
    expect(typeof data.data[0]!.d).toBe("string");
    expect(data.dtypes.d).toBe("date");
  });

  it("fails on an invalid cast by default", () => {
    expect(() => parseJSON('[{"age":"abc"}]', { schema: { age: "integer" } })).toThrow(/Row 1, column "age"/);
  });

  it("nulls invalid values when asked", () => {
    const data = parseJSON('[{"age":"abc"}]', { schema: { age: "integer" }, onInvalid: "null" });
    expect(data.data[0]!.age).toBeNull();
  });

  it("applies normalization to JSON strings too", () => {
    expect(parseJSON('[{"n":"42"}]').data[0]!.n).toBe(42);
    expect(parseJSON('[{"n":"NA"}]').data[0]!.n).toBe("NA");
  });

  it("rejects a schema for a missing column", () => {
    expect(() => parseJSON('[{"a":1}]', { schema: { nope: "number" } })).toThrow(/unknown column/);
  });

  it("supports skipRows", () => {
    const data = parseJSON('[{"a":1},{"a":2}]', { skipRows: 1 });
    expect(data.data).toEqual([{ a: 2 }]);
  });

  it("rejects a negative skipRows", () => {
    expect(() => parseJSON("[]", { skipRows: -1 })).toThrow(ValidationError);
  });
});

describe("import report", () => {
  it("records the JSON format and counts", () => {
    const report = parseJSON('[{"a":1},{"a":null}]').importReport!;
    expect(report.format).toBe("json");
    expect(report.rowsRead).toBe(2);
    expect(report.rowsImported).toBe(2);
    expect(report.missingByColumn).toEqual({ a: 1 });
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(parseJSON('[{"a":1}]').importReport)).toBe(true);
  });
});
