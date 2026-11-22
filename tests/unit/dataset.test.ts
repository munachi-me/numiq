import { describe, it, expect } from "vitest";
import { createDataset, Dataset } from "../../src/core/dataset.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

describe("createDataset from records", () => {
  it("infers columns in first-seen order", () => {
    const data = createDataset([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    expect(data.columns).toEqual(["a", "b", "c"]);
  });

  it("fills absent keys with null", () => {
    const data = createDataset([{ a: 1 }, { a: 2, b: 3 }]);
    expect(data.data).toEqual([
      { a: 1, b: null },
      { a: 2, b: 3 },
    ]);
  });

  it("honours an explicit column order and selection", () => {
    const data = createDataset([{ a: 1, b: 2 }], { columns: ["b", "a"] });
    expect(data.columns).toEqual(["b", "a"]);
  });

  it("rejects non-object rows", () => {
    expect(() => createDataset([1 as never])).toThrow(ValidationError);
    expect(() => createDataset([null as never])).toThrow(ValidationError);
  });

  it("rejects duplicate column names", () => {
    expect(() => createDataset([{ a: 1 }], { columns: ["a", "a"] })).toThrow(/Duplicate column name/);
  });

  it("rejects blank column names", () => {
    expect(() => createDataset([{ a: 1 }], { columns: [" "] })).toThrow(/non-empty strings/);
  });

  it("builds an empty dataset with explicit columns", () => {
    const data = createDataset([], { columns: ["a", "b"] });
    expect(data.rowCount).toBe(0);
    expect(data.columnCount).toBe(2);
    expect(data.empty).toBe(true);
  });
});

describe("createDataset from column-oriented data", () => {
  it("converts parallel arrays into rows", () => {
    const data = createDataset({ name: ["Ada", "Lin"], age: [36, 41] });
    expect(data.data).toEqual([
      { name: "Ada", age: 36 },
      { name: "Lin", age: 41 },
    ]);
  });

  it("rejects arrays of unequal length", () => {
    expect(() => createDataset({ a: [1, 2], b: [3] })).toThrow(/equal length/);
  });

  it("rejects non-array properties", () => {
    expect(() => createDataset({ a: 1 } as never)).toThrow(/must be an array/);
  });
});

describe("createDataset from a Dataset", () => {
  it("copies rather than aliases", () => {
    const original = createDataset([{ a: 1 }]);
    const copy = createDataset(original);
    expect(copy.data).toEqual(original.data);
    expect(copy).not.toBe(original);
  });
});

describe("dataset properties", () => {
  const data = createDataset([
    { name: "Alice", age: 24 },
    { name: "Bob", age: 31 },
  ]);

  it("exposes columns, shape, and counts", () => {
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.shape).toEqual([2, 2]);
    expect(data.rowCount).toBe(2);
    expect(data.columnCount).toBe(2);
    expect(data.length).toBe(2);
  });

  it("exposes data as records", () => {
    expect(data.data).toEqual([
      { name: "Alice", age: 24 },
      { name: "Bob", age: 31 },
    ]);
  });

  it("returns a defensive copy from data", () => {
    const rows = data.data as Record<string, unknown>[];
    rows[0]!.name = "Mallory";
    rows.push({ name: "Eve", age: 1 });
    expect(data.data[0]!.name).toBe("Alice");
    expect(data.rowCount).toBe(2);
  });

  it("infers dtypes and schema", () => {
    expect(data.dtypes).toEqual({ name: "string", age: "integer" });
    expect(data.schema.age).toEqual({ name: "age", type: "integer", nullable: false });
  });

  it("marks nullable columns", () => {
    const sparse = createDataset([{ a: 1 }, { a: null }]);
    expect(sparse.schema.a!.nullable).toBe(true);
  });

  it("reports no import report for hand-built datasets", () => {
    expect(data.importReport).toBeNull();
  });
});

describe("inspection", () => {
  const data = createDataset(
    Array.from({ length: 10 }, (_, index) => ({ index, group: index % 2 === 0 ? "even" : "odd" })),
  );

  it("head and tail slice correctly", () => {
    expect(data.head(2).rowCount).toBe(2);
    expect(data.head(2).data[0]!.index).toBe(0);
    expect(data.tail(2).data.at(-1)!.index).toBe(9);
    expect(data.head(0).rowCount).toBe(0);
  });

  it("rejects invalid counts", () => {
    expect(() => data.head(-1)).toThrow(ValidationError);
    expect(() => data.tail(1.5)).toThrow(ValidationError);
  });

  it("info summarises the dataset", () => {
    const info = data.info();
    expect(info.rowCount).toBe(10);
    expect(info.columnCount).toBe(2);
    expect(info.missingValues).toBe(0);
    expect(info.dtypes.group).toBe("string");
  });

  it("counts missing values in info", () => {
    const sparse = createDataset([
      { a: 1, b: null },
      { a: null, b: 2 },
    ]);
    expect(sparse.info().missingValues).toBe(2);
  });

  it("describes a column", () => {
    const view = data.column("group");
    expect(view.type).toBe("string");
    expect(view.unique).toBe(2);
    expect(view.missing).toBe(0);
    expect(view.values).toHaveLength(10);
  });

  it("throws a typed error for an unknown column", () => {
    expect(() => data.column("nope")).toThrow(ColumnNotFoundError);
    try {
      data.column("nope");
    } catch (error) {
      expect((error as ColumnNotFoundError).column).toBe("nope");
      expect((error as ColumnNotFoundError).available).toEqual(["index", "group"]);
    }
  });

  it("lists distinct values in first-seen order", () => {
    expect(data.distinct("group")).toEqual(["even", "odd"]);
    expect(data.unique("group")).toBe(2);
  });

  it("excludes nulls from distinct values", () => {
    const sparse = createDataset([{ a: null }, { a: 1 }, { a: 1 }]);
    expect(sparse.distinct("a")).toEqual([1]);
    expect(sparse.unique("a")).toBe(1);
  });
});

describe("type inference", () => {
  it("distinguishes integer, number, and mixed", () => {
    expect(createDataset([{ a: 1 }, { a: 2 }]).dtypes.a).toBe("integer");
    expect(createDataset([{ a: 1.5 }]).dtypes.a).toBe("number");
    expect(createDataset([{ a: 1 }, { a: "x" }]).dtypes.a).toBe("mixed");
  });

  it("recognises booleans", () => {
    expect(createDataset([{ a: true }, { a: false }]).dtypes.a).toBe("boolean");
  });

  it("recognises ISO date, datetime, and time strings", () => {
    expect(createDataset([{ a: "2026-01-05" }]).dtypes.a).toBe("date");
    expect(createDataset([{ a: "2026-01-05T14:30:00Z" }]).dtypes.a).toBe("datetime");
    expect(createDataset([{ a: "14:30:00" }]).dtypes.a).toBe("time");
  });

  it("reports unknown for an all-null column", () => {
    expect(createDataset([{ a: null }]).dtypes.a).toBe("unknown");
  });

  it("does not claim date for mixed date and non-date strings", () => {
    expect(createDataset([{ a: "2026-01-05" }, { a: "not a date" }]).dtypes.a).toBe("string");
  });

  it("recognises Date instances produced by casting", () => {
    const midnight = createDataset([{ a: new Date("2026-01-05T00:00:00Z") }]);
    expect(midnight.dtypes.a).toBe("date");

    const timed = createDataset([{ a: new Date("2026-01-05T14:30:00Z") }]);
    expect(timed.dtypes.a).toBe("datetime");
  });

  it("recognises a whole column of Date instances", () => {
    const data = createDataset([{ a: new Date("2026-01-05T00:00:00Z") }, { a: new Date("2026-01-06T00:00:00Z") }]);
    expect(data.dtypes.a).toBe("date");
    expect(data.schema.a!.type).toBe("date");
  });

  it("does not claim date for a Date mixed with a string", () => {
    expect(createDataset([{ a: new Date("2026-01-05T00:00:00Z") }, { a: "2026-01-06" }]).dtypes.a).toBe("mixed");
  });
});

describe("immutability", () => {
  it("does not let callers mutate internal state through derived views", () => {
    const data = createDataset([{ a: 1 }]);
    const head = data.head(1);
    (head.data as Record<string, unknown>[])[0]!.a = 999;
    expect(data.data[0]!.a).toBe(1);
  });

  it("keeps metadata frozen", () => {
    const data = createDataset([{ a: 1 }], { metadata: { source: "test" } });
    expect(Object.isFrozen(data.metadata)).toBe(true);
    expect(data.metadata.source).toBe("test");
  });

  it("normalizes input values by default", () => {
    const data = createDataset([{ a: "42", b: "  x  " }]);
    expect(data.data[0]).toEqual({ a: 42, b: "  x  " });
  });

  it("produces JSON-safe output", () => {
    const data = createDataset([{ a: 1 }], { name: "t" });
    expect(JSON.parse(JSON.stringify(data))).toMatchObject({ name: "t", shape: [1, 1] });
  });
});

describe("constructor guard", () => {
  it("is exported as a class", () => {
    expect(typeof Dataset).toBe("function");
    expect(createDataset([{ a: 1 }])).toBeInstanceOf(Dataset);
  });
});

describe("runtime immutability", () => {
  it("returns a frozen column array", () => {
    const data = createDataset([{ a: 1, b: 2 }]);
    expect(Object.isFrozen(data.columns)).toBe(true);
    expect(() => (data.columns as string[]).push("injected")).toThrow();
    expect(data.columnCount).toBe(2);
  });

  it("returns a frozen schema", () => {
    const data = createDataset([{ a: 1 }]);
    expect(Object.isFrozen(data.schema)).toBe(true);
    expect(() => {
      (data.schema.a as { type: string }).type = "banana";
    }).toThrow();
    expect(data.schema.a!.type).toBe("integer");
  });

  it("deep-freezes metadata", () => {
    const data = createDataset([{ a: 1 }], { metadata: { nested: { deep: 1 } } });
    expect(Object.isFrozen(data.metadata.nested)).toBe(true);
    expect(() => {
      (data.metadata.nested as { deep: number }).deep = 999;
    }).toThrow();
    expect((data.metadata.nested as { deep: number }).deep).toBe(1);
  });

  it("does not freeze the caller's metadata object", () => {
    const metadata = { nested: { deep: 1 } };
    createDataset([{ a: 1 }], { metadata });
    expect(Object.isFrozen(metadata)).toBe(false);
    metadata.nested.deep = 2;
    expect(metadata.nested.deep).toBe(2);
  });

  it("still hands out defensive copies of rows", () => {
    const data = createDataset([{ a: 1 }]);
    const rows = data.data as { a: number }[];
    rows[0]!.a = 42;
    expect(data.data[0]!.a).toBe(1);
  });
});

describe("sort: ordering guarantees", () => {
  // The comparator now carries a precomputed key per row and relies on the language's
  // stable sort for ties. These pin the behaviour that replaces the old explicit
  // index tie-break.
  it("keeps source order for equal keys in both directions", () => {
    const data = createDataset([
      { k: 1, tag: "first" },
      { k: 1, tag: "second" },
      { k: 0, tag: "third" },
      { k: 1, tag: "fourth" },
    ]);
    expect(data.sort("k", "asc").data.map((row) => row.tag)).toEqual(["third", "first", "second", "fourth"]);
    expect(data.sort("k", "desc").data.map((row) => row.tag)).toEqual(["first", "second", "fourth", "third"]);
  });

  it("sorts missing values last in both directions", () => {
    const data = createDataset([
      { k: null, tag: "missing" },
      { k: 2, tag: "two" },
      { k: 1, tag: "one" },
    ]);
    expect(data.sort("k", "asc").data.map((row) => row.tag)).toEqual(["one", "two", "missing"]);
    expect(data.sort("k", "desc").data.map((row) => row.tag)).toEqual(["two", "one", "missing"]);
  });

  it("keeps missing values in source order among themselves", () => {
    const data = createDataset([
      { k: null, tag: "a" },
      { k: 1, tag: "one" },
      { k: null, tag: "b" },
    ]);
    expect(data.sort("k", "asc").data.map((row) => row.tag)).toEqual(["one", "a", "b"]);
  });

  it("does not mutate the source dataset", () => {
    const data = createDataset([{ k: 3 }, { k: 1 }, { k: 2 }]);
    const sorted = data.sort("k");
    expect(sorted.data.map((row) => row.k)).toEqual([1, 2, 3]);
    expect(data.data.map((row) => row.k)).toEqual([3, 1, 2]);
  });

  it("sorts strings and dates by value", () => {
    const data = createDataset([{ s: "b" }, { s: "a" }, { s: "c" }]);
    expect(data.sort("s").data.map((row) => row.s)).toEqual(["a", "b", "c"]);

    const dates = createDataset([
      { d: new Date("2024-03-01T00:00:00.000Z") },
      { d: new Date("2024-01-01T00:00:00.000Z") },
    ]);
    expect(dates.sort("d").data[0]?.d).toEqual(new Date("2024-01-01T00:00:00.000Z"));
  });
});
