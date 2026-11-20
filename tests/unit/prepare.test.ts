import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const rows = () => [
  { id: 1, qty: 2, price: 10, note: "a" },
  { id: 2, qty: null, price: 5, note: null },
  { id: 3, qty: 4, price: 2.5, note: "b" },
  { id: 4, qty: null, price: null, note: null },
];

describe("drop", () => {
  it("removes columns and keeps the rest in order", () => {
    const data = createDataset(rows()).drop(["note", "price"]);
    expect(data.columns).toEqual(["id", "qty"]);
    expect(data.data[0]).toEqual({ id: 1, qty: 2 });
  });

  it("accepts a single column name", () => {
    expect(createDataset(rows()).drop("note").columns).toEqual(["id", "qty", "price"]);
  });

  it("is a no-op for a column that is already absent from the values", () => {
    const data = createDataset([{ a: 1, b: 2 }, { a: 3 }]);
    expect(data.drop(["b"]).data).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset(rows()).drop(["nope"])).toThrow(ColumnNotFoundError);
  });

  it("rejects dropping every column", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.drop(["a"])).toThrow(/remove every column/);
  });

  it("rejects an empty list", () => {
    expect(() => createDataset(rows()).drop([])).toThrow(ValidationError);
  });

  it("leaves the source untouched", () => {
    const source = createDataset(rows());
    source.drop(["note"]);
    expect(source.columns).toEqual(["id", "qty", "price", "note"]);
    expect(source.rowCount).toBe(4);
  });
});

describe("rename", () => {
  it("renames in place, preserving position and values", () => {
    const data = createDataset(rows()).rename({ qty: "quantity" });
    expect(data.columns).toEqual(["id", "quantity", "price", "note"]);
    expect(data.data[0]).toEqual({ id: 1, quantity: 2, price: 10, note: "a" });
  });

  it("supports several renames at once", () => {
    const data = createDataset([{ a: 1, b: 2, c: 3 }]).rename({ a: "x", c: "z" });
    expect(data.columns).toEqual(["x", "b", "z"]);
    expect(data.data[0]).toEqual({ x: 1, b: 2, z: 3 });
  });

  it("rejects an unknown source column", () => {
    expect(() => createDataset(rows()).rename({ nope: "x" })).toThrow(ColumnNotFoundError);
  });

  it("rejects a mapping that collides with an existing name", () => {
    expect(() => createDataset([{ a: 1, b: 2 }]).rename({ a: "b" })).toThrow(/duplicate column name/);
  });

  it("rejects a swap that resolves to the same name", () => {
    expect(() => createDataset([{ a: 1, b: 2 }]).rename({ a: "b", b: "a" })).not.toThrow();
  });

  it("rejects a blank target name", () => {
    expect(() => createDataset([{ a: 1 }]).rename({ a: "  " })).toThrow(/non-empty column name/);
  });

  it("rejects an empty mapping", () => {
    expect(() => createDataset([{ a: 1 }]).rename({})).toThrow(/non-empty mapping/);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ a: 1 }]);
    source.rename({ a: "b" });
    expect(source.columns).toEqual(["a"]);
  });
});

describe("dropMissing", () => {
  it("drops a row when any cell is missing by default", () => {
    expect(createDataset(rows()).dropMissing().rowCount).toBe(2);
  });

  it("drops a row only when every cell is missing with how: all", () => {
    const data = createDataset(rows()).dropMissing({ how: "all" });
    expect(data.rowCount).toBe(4);
  });

  it("considers only the listed columns", () => {
    const data = createDataset(rows()).dropMissing({ columns: ["qty"] });
    expect(data.data.map((row) => row.id)).toEqual([1, 3]);
  });

  it("keeps rows that are missing values outside the listed columns", () => {
    const data = createDataset(rows()).dropMissing({ columns: ["id"] });
    expect(data.rowCount).toBe(4);
  });

  it("handles a dataset where every cell is missing", () => {
    const data = createDataset([{ a: null, b: null }]);
    expect(data.dropMissing().rowCount).toBe(0);
    expect(data.dropMissing({ how: "all" }).rowCount).toBe(0);
  });

  it("returns an empty dataset rather than throwing when nothing survives", () => {
    const data = createDataset(rows()).dropMissing();
    expect(data.rowCount).toBe(2);
    expect(data.columns).toEqual(["id", "qty", "price", "note"]);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset(rows()).dropMissing({ columns: ["nope"] })).toThrow(ColumnNotFoundError);
  });

  it("rejects an invalid how value", () => {
    expect(() => createDataset(rows()).dropMissing({ how: "some" as never })).toThrow(/"any" or "all"/);
  });

  it("leaves the source untouched", () => {
    const source = createDataset(rows());
    source.dropMissing();
    expect(source.rowCount).toBe(4);
  });
});

describe("fillMissing", () => {
  it("fills with a constant", () => {
    const data = createDataset(rows()).fillMissing({ qty: 0 });
    expect(data.data.map((row) => row.qty)).toEqual([2, 0, 4, 0]);
  });

  it("fills with the mean of present values", () => {
    const data = createDataset([{ v: 1 }, { v: null }, { v: 3 }]).fillMissing({ v: "mean" });
    expect(data.data.map((row) => row.v)).toEqual([1, 2, 3]);
  });

  it("fills with the median of an odd number of present values", () => {
    // Present values 1, 9, 2 sort to [1, 2, 9]; the middle value is 2.
    const data = createDataset([{ v: 1 }, { v: null }, { v: 9 }, { v: 2 }]).fillMissing({ v: "median" });
    expect(data.data.map((row) => row.v)).toEqual([1, 2, 9, 2]);
  });

  it("fills with the median of an even number of present values", () => {
    // Present values 1, 9, 5, 3 sort to [1, 3, 5, 9]; the midpoint of 3 and 5 is 4.
    const data = createDataset([{ v: 1 }, { v: null }, { v: 9 }, { v: 5 }, { v: 3 }]).fillMissing({
      v: "median",
    });
    expect(data.data.map((row) => row.v)).toEqual([1, 4, 9, 5, 3]);
  });

  it("fills with the mode, resolving ties to the first seen value", () => {
    const data = createDataset([{ v: "b" }, { v: null }, { v: "a" }, { v: "a" }, { v: "b" }]).fillMissing({
      v: "mode",
    });
    expect(data.data.map((row) => row.v)).toEqual(["b", "b", "a", "a", "b"]);
  });

  it("fills with a callback that sees the row", () => {
    const data = createDataset(rows()).fillMissing({ qty: (row) => Number(row.id) * 10 });
    expect(data.data.map((row) => row.qty)).toEqual([2, 20, 4, 40]);
  });

  it("applies one strategy to every column", () => {
    const data = createDataset([
      { a: 1, b: 2 },
      { a: null, b: null },
    ]).fillMissing(0);
    expect(data.data[1]).toEqual({ a: 0, b: 0 });
  });

  it("rejects mean on a non-numeric column", () => {
    expect(() => createDataset(rows()).fillMissing({ note: "mean" })).toThrow(/needs a numeric column/);
  });

  it("rejects median on a non-numeric column", () => {
    expect(() => createDataset(rows()).fillMissing({ note: "median" })).toThrow(/needs a numeric column/);
  });

  it("does not coerce text into numbers", () => {
    // inferTypes off keeps the column as strings, so a numeric strategy must refuse it.
    const strings = createDataset([{ v: "1" }, { v: null }], { normalization: { inferTypes: false } });
    expect(() => strings.fillMissing({ v: "mean" })).toThrow(/needs a numeric column/);
  });

  it("leaves an all-missing column alone instead of inventing a value", () => {
    const data = createDataset([{ v: null }, { v: null }]).fillMissing({ v: "mean" });
    expect(data.data.map((row) => row.v)).toEqual([null, null]);
  });

  it("leaves present values untouched", () => {
    const data = createDataset([{ v: 5 }, { v: null }]).fillMissing({ v: 0 });
    expect(data.data[0]?.v).toBe(5);
  });

  it("rejects an unknown column in the mapping", () => {
    expect(() => createDataset(rows()).fillMissing({ nope: 0 })).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty mapping", () => {
    expect(() => createDataset(rows()).fillMissing({})).toThrow(/non-empty mapping/);
  });

  it("names the column when a callback throws", () => {
    const source = createDataset([{ v: null }]);
    expect(() =>
      source.fillMissing({
        v: () => {
          throw new Error("boom");
        },
      }),
    ).toThrow(/fillMissing failed at row 0, column "v": boom/);
  });

  it("keeps the original error as cause", () => {
    const original = new Error("boom");
    try {
      createDataset([{ v: null }]).fillMissing({
        v: () => {
          throw original;
        },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).cause).toBe(original);
    }
  });

  it("leaves the source untouched", () => {
    const source = createDataset(rows());
    source.fillMissing({ qty: 0 });
    expect(source.data[1]?.qty).toBeNull();
  });
});

describe("replace", () => {
  it("replaces a single value", () => {
    const data = createDataset(rows()).replace({ note: { from: null, to: "none" } });
    expect(data.data.map((row) => row.note)).toEqual(["a", "none", "b", "none"]);
  });

  it("replaces from a list of values", () => {
    const data = createDataset([{ v: "a" }, { v: "b" }, { v: "c" }]).replace({
      v: { from: ["a", "c"], to: "x" },
    });
    expect(data.data.map((row) => row.v)).toEqual(["x", "b", "x"]);
  });

  it("matches by predicate", () => {
    const data = createDataset([{ v: 1 }, { v: 5 }, { v: 10 }]).replace({
      v: { match: (value) => Number(value) >= 5, to: 99 },
    });
    expect(data.data.map((row) => row.v)).toEqual([1, 99, 99]);
  });

  it("transforms with a callback", () => {
    const data = createDataset([{ v: 1 }, { v: 2 }]).replace({ v: (value) => Number(value) * 10 });
    expect(data.data.map((row) => row.v)).toEqual([10, 20]);
  });

  it("applies rules in order", () => {
    const data = createDataset([{ v: "a" }]).replace({
      v: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(data.data[0]?.v).toBe("c");
  });

  it("compares by value and type, so 1 does not match '1'", () => {
    const data = createDataset([{ v: 1 }, { v: "1" }], { normalization: { inferTypes: false } }).replace({
      v: { from: 1, to: "one" },
    });
    expect(data.data.map((row) => row.v)).toEqual(["one", "1"]);
  });

  it("treats null and undefined as the same missing value", () => {
    const data = createDataset([{ v: null }]).replace({ v: { from: undefined, to: "x" } });
    expect(data.data[0]?.v).toBe("x");
  });

  it("only touches the listed columns", () => {
    const data = createDataset([{ a: 1, b: 1 }]).replace({ a: { from: 1, to: 2 } });
    expect(data.data[0]).toEqual({ a: 2, b: 1 });
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset(rows()).replace({ nope: { from: 1, to: 2 } })).toThrow(ColumnNotFoundError);
  });

  it("rejects a rule with both from and match", () => {
    expect(() => createDataset([{ v: 1 }]).replace({ v: { from: 1, match: () => true, to: 2 } as never })).toThrow(
      /exactly one of "from" or "match"/,
    );
  });

  it("rejects a rule with neither from nor match", () => {
    expect(() => createDataset([{ v: 1 }]).replace({ v: { to: 2 } as never })).toThrow(
      /exactly one of "from" or "match"/,
    );
  });

  it("rejects a rule without to", () => {
    expect(() => createDataset([{ v: 1 }]).replace({ v: { from: 1 } as never })).toThrow(/must define "to"/);
  });

  it("rejects an empty rule list", () => {
    expect(() => createDataset([{ v: 1 }]).replace({ v: [] })).toThrow(/empty rule list/);
  });

  it("rejects an empty mapping", () => {
    expect(() => createDataset([{ v: 1 }]).replace({})).toThrow(/non-empty mapping/);
  });

  it("names the column when a callback throws", () => {
    expect(() =>
      createDataset([{ v: 1 }]).replace({
        v: () => {
          throw new Error("boom");
        },
      }),
    ).toThrow(/replace failed at row 0, column "v": boom/);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ v: 1 }]);
    source.replace({ v: { from: 1, to: 2 } });
    expect(source.data[0]?.v).toBe(1);
  });
});

describe("map", () => {
  it("transforms one column and keeps the rest", () => {
    const data = createDataset([{ a: 1, b: 2 }]).map("a", (value) => Number(value) * 3);
    expect(data.data[0]).toEqual({ a: 3, b: 2 });
  });

  it("passes the value, row, and index", () => {
    const seen: unknown[] = [];
    createDataset([{ a: 1 }, { a: 2 }]).map("a", (value, row, index) => {
      seen.push([value, row.a, index]);
      return value;
    });
    expect(seen).toEqual([
      [1, 1, 0],
      [2, 2, 1],
    ]);
  });

  it("shows the row as it was before the transformation", () => {
    const data = createDataset([{ a: 1 }]).map("a", (_value, row) => Number(row.a) + 1);
    expect(data.data[0]?.a).toBe(2);
  });

  it("allows a column to become a different type", () => {
    const data = createDataset([{ a: 1 }]).map("a", (value) => String(value));
    expect(data.data[0]?.a).toBe("1");
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset([{ a: 1 }]).map("nope", (value) => value)).toThrow(ColumnNotFoundError);
  });

  it("rejects a non-function callback", () => {
    expect(() => createDataset([{ a: 1 }]).map("a", 5 as never)).toThrow(/callback function/);
  });

  it("names the operation, row, and column when the callback throws", () => {
    expect(() =>
      createDataset([{ a: 1 }, { a: 2 }]).map("a", (value) => {
        if (value === 2) throw new Error("bad");
        return value;
      }),
    ).toThrow(/map failed at row 1, column "a": bad/);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ a: 1 }]);
    source.map("a", (value) => Number(value) + 1);
    expect(source.data[0]?.a).toBe(1);
  });
});

describe("addColumn", () => {
  it("appends a computed column last", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]).addColumn("double", (row) => Number(row.a) * 2);
    expect(data.columns).toEqual(["a", "double"]);
    expect(data.data.map((row) => row.double)).toEqual([2, 4]);
  });

  it("appends a column from a value list", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]).addColumn("tag", ["x", "y"]);
    expect(data.data.map((row) => row.tag)).toEqual(["x", "y"]);
  });

  it("accepts null and undefined in a value list", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]).addColumn("tag", [null, undefined]);
    expect(data.data.map((row) => row.tag)).toEqual([null, null]);
  });

  it("passes the index to the callback", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]).addColumn("i", (_row, index) => index);
    expect(data.data.map((row) => row.i)).toEqual([0, 1]);
  });

  it("rejects overwriting an existing column", () => {
    expect(() => createDataset([{ a: 1 }]).addColumn("a", () => 2)).toThrow(/cannot overwrite/);
  });

  it("rejects a value list of the wrong length", () => {
    expect(() => createDataset([{ a: 1 }, { a: 2 }]).addColumn("x", [1])).toThrow(/expects 2 values/);
  });

  it("rejects a blank name", () => {
    expect(() => createDataset([{ a: 1 }]).addColumn(" ", () => 1)).toThrow(/non-empty column name/);
  });

  it("rejects an invalid spec", () => {
    expect(() => createDataset([{ a: 1 }]).addColumn("x", 5 as never)).toThrow(/callback function or an array/);
  });

  it("names the column when the callback throws", () => {
    expect(() =>
      createDataset([{ a: 1 }]).addColumn("x", () => {
        throw new Error("boom");
      }),
    ).toThrow(/addColumn failed at row 0, column "x": boom/);
  });

  it("works on an empty dataset", () => {
    const data = createDataset([], { columns: ["a"] }).addColumn("b", []);
    expect(data.columns).toEqual(["a", "b"]);
    expect(data.rowCount).toBe(0);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ a: 1 }]);
    source.addColumn("b", () => 2);
    expect(source.columns).toEqual(["a"]);
  });
});

describe("cast", () => {
  it("converts a column to a number", () => {
    const data = createDataset([{ v: "1" }, { v: "2" }]).cast({ v: "number" });
    expect(data.data.map((row) => row.v)).toEqual([1, 2]);
  });

  it("converts a column to an integer", () => {
    const data = createDataset([{ v: "42" }]).cast({ v: "integer" });
    expect(data.data[0]?.v).toBe(42);
  });

  it("converts a column to a date", () => {
    const data = createDataset([{ v: "2024-01-02" }]).cast({ v: "date" });
    expect(data.data[0]?.v).toBeInstanceOf(Date);
  });

  it("converts a column to a boolean", () => {
    const data = createDataset([{ v: "true" }, { v: "false" }]).cast({ v: "boolean" });
    expect(data.data.map((row) => row.v)).toEqual([true, false]);
  });

  it("converts a column to a string", () => {
    const data = createDataset([{ v: 1 }]).cast({ v: "string" });
    expect(data.data[0]?.v).toBe("1");
  });

  it("keeps missing cells as null", () => {
    const data = createDataset([{ v: null }]).cast({ v: "number" });
    expect(data.data[0]?.v).toBeNull();
  });

  it("accepts type aliases", () => {
    const data = createDataset([{ v: "1" }]).cast({ v: "float" });
    expect(data.data[0]?.v).toBe(1);
  });

  it("rejects a value that cannot be converted, naming row and column", () => {
    expect(() => createDataset([{ v: "abc" }]).cast({ v: "number" })).toThrow(/cast failed at row 0, column "v"/);
  });

  it("rejects a fractional value for an integer column", () => {
    expect(() => createDataset([{ v: "1.5" }]).cast({ v: "integer" })).toThrow(/not an integer/);
  });

  it("rejects an unknown type", () => {
    expect(() => createDataset([{ v: 1 }]).cast({ v: "nope" as never })).toThrow(/Unknown type/);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset([{ v: 1 }]).cast({ nope: "number" })).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty schema", () => {
    expect(() => createDataset([{ v: 1 }]).cast({})).toThrow(/non-empty schema/);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ v: "1" }], { normalization: { inferTypes: false } });
    source.cast({ v: "number" });
    expect(source.data[0]?.v).toBe("1");
  });
});

describe("dropDuplicates", () => {
  it("keeps the first row of each distinct full row", () => {
    const data = createDataset([{ a: 1 }, { a: 1 }, { a: 2 }]).dropDuplicates();
    expect(data.data).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("considers only the listed columns", () => {
    const data = createDataset([
      { a: 1, b: "x" },
      { a: 1, b: "y" },
      { a: 2, b: "z" },
    ]).dropDuplicates(["a"]);
    expect(data.data).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "z" },
    ]);
  });

  it("keeps the first occurrence, not the last", () => {
    const data = createDataset([
      { a: 1, b: "first" },
      { a: 1, b: "second" },
    ]).dropDuplicates(["a"]);
    expect(data.data[0]?.b).toBe("first");
  });

  it("compares by type, so 1 and '1' stay distinct", () => {
    const data = createDataset([{ v: 1 }, { v: "1" }], { normalization: { inferTypes: false } }).dropDuplicates(["v"]);
    expect(data.rowCount).toBe(2);
  });

  it("treats null and undefined as the same missing value", () => {
    const data = createDataset([{ v: null }, { v: undefined }]).dropDuplicates(["v"]);
    expect(data.rowCount).toBe(1);
  });

  it("accepts a single column name", () => {
    expect(createDataset([{ a: 1 }, { a: 1 }]).dropDuplicates("a").rowCount).toBe(1);
  });

  it("returns an empty dataset for empty input", () => {
    const data = createDataset([], { columns: ["a"] }).dropDuplicates();
    expect(data.rowCount).toBe(0);
    expect(data.columns).toEqual(["a"]);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset([{ a: 1 }]).dropDuplicates(["nope"])).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty list", () => {
    expect(() => createDataset([{ a: 1 }]).dropDuplicates([])).toThrow(ValidationError);
  });

  it("leaves the source untouched", () => {
    const source = createDataset([{ a: 1 }, { a: 1 }]);
    source.dropDuplicates();
    expect(source.rowCount).toBe(2);
  });
});

describe("sample", () => {
  const numbered = () => createDataset(Array.from({ length: 20 }, (_value, index) => ({ i: index })));

  it("returns the requested number of rows", () => {
    expect(numbered().sample(5).rowCount).toBe(5);
  });

  it("is deterministic for a given seed", () => {
    const first = numbered().sample(5, { seed: 7 }).data;
    const second = numbered().sample(5, { seed: 7 }).data;
    expect(first).toEqual(second);
  });

  it("produces a different draw for a different seed", () => {
    const first = numbered().sample(5, { seed: 1 }).data;
    const second = numbered().sample(5, { seed: 999 }).data;
    expect(first).not.toEqual(second);
  });

  it("draws distinct rows without replacement", () => {
    const picked = numbered()
      .sample(10, { seed: 3 })
      .data.map((row) => row.i);
    expect(new Set(picked).size).toBe(10);
  });

  it("allows repeats with replace", () => {
    const data = createDataset([{ v: 1 }]).sample(5, { replace: true });
    expect(data.rowCount).toBe(5);
    expect(data.data.every((row) => row.v === 1)).toBe(true);
  });

  it("allows more rows than the source with replace", () => {
    expect(numbered().sample(50, { replace: true }).rowCount).toBe(50);
  });

  it("draws every row when the count equals the row count", () => {
    const picked = numbered()
      .sample(20, { seed: 11 })
      .data.map((row) => row.i)
      .sort((a, b) => Number(a) - Number(b));
    expect(picked).toEqual(Array.from({ length: 20 }, (_value, index) => index));
  });

  it("returns an empty dataset for a zero count", () => {
    const data = numbered().sample(0);
    expect(data.rowCount).toBe(0);
    expect(data.columns).toEqual(["i"]);
  });

  it("rejects a count above the row count without replace", () => {
    expect(() => numbered().sample(21)).toThrow(/without replacement/);
  });

  it("rejects a negative or fractional count", () => {
    expect(() => numbered().sample(-1)).toThrow(ValidationError);
    expect(() => numbered().sample(1.5)).toThrow(ValidationError);
  });

  it("rejects a non-finite seed", () => {
    expect(() => numbered().sample(2, { seed: Number.NaN })).toThrow(/finite number/);
  });

  it("rejects drawing from an empty dataset", () => {
    expect(() => createDataset([], { columns: ["a"] }).sample(1)).toThrow(/empty dataset/);
  });

  it("leaves the source untouched", () => {
    const source = numbered();
    source.sample(5, { seed: 1 });
    expect(source.rowCount).toBe(20);
  });
});

describe("preparation chains", () => {
  it("runs the documented example end to end", () => {
    const data = createDataset([
      { order_id: 1, qty: 2, unit_price: 10, internal_note: "x" },
      { order_id: 1, qty: null, unit_price: 5, internal_note: null },
      { order_id: 2, qty: 4, unit_price: 2.5, internal_note: "y" },
    ]);

    const prepared = data
      .drop(["internal_note"])
      .rename({ qty: "quantity" })
      .fillMissing({ quantity: 0 })
      .dropDuplicates(["order_id"])
      .addColumn("total", (row) => Number(row.quantity) * Number(row.unit_price));

    expect(prepared.columns).toEqual(["order_id", "quantity", "unit_price", "total"]);
    expect(prepared.data).toEqual([
      { order_id: 1, quantity: 2, unit_price: 10, total: 20 },
      { order_id: 2, quantity: 4, unit_price: 2.5, total: 10 },
    ]);
  });

  it("composes with the existing transformations", () => {
    const data = createDataset([
      { a: 1, b: 10 },
      { a: 2, b: 20 },
      { a: 3, b: 30 },
    ]);
    const out = data
      .filter((row) => Number(row.a) > 1)
      .map("b", (value) => Number(value) * 2)
      .sort("b", "desc")
      .select(["a", "b"])
      .limit(1);
    expect(out.data).toEqual([{ a: 3, b: 60 }]);
  });

  it("keeps every intermediate dataset independent", () => {
    const source = createDataset([{ a: 1, b: 2 }]);
    const dropped = source.drop(["b"]);
    const renamed = source.rename({ a: "x" });
    const added = source.addColumn("c", () => 3);
    expect(source.columns).toEqual(["a", "b"]);
    expect(dropped.columns).toEqual(["a"]);
    expect(renamed.columns).toEqual(["x", "b"]);
    expect(added.columns).toEqual(["a", "b", "c"]);
  });

  it("carries the dataset name and metadata through a chain", () => {
    const source = createDataset([{ a: 1, b: 2 }], { name: "sales", metadata: { origin: "test" } });
    const out = source.drop(["b"]).addColumn("c", () => 3);
    expect(out.name).toBe("sales");
    expect(out.metadata).toEqual({ origin: "test" });
  });

  it("reports importReport as null on prepared datasets", () => {
    const source = createDataset([{ a: 1, b: 2 }]);
    expect(source.importReport).toBeNull();
    expect(source.drop(["b"]).importReport).toBeNull();
  });

  it("survives a long chain", () => {
    let data = createDataset(Array.from({ length: 100 }, (_value, index) => ({ i: index, v: index % 5 })));
    for (let step = 0; step < 10; step += 1) {
      data = data.map("v", (value) => Number(value) + 1);
    }
    expect(data.data[0]?.v).toBe(10);
    expect(data.rowCount).toBe(100);
  });
});

describe("preparation on large data", () => {
  const big = () =>
    createDataset(
      Array.from({ length: 5000 }, (_value, index) => ({
        id: index,
        group: index % 7,
        value: index % 3 === 0 ? null : index,
      })),
    );

  it("prepares 5000 rows without losing any", () => {
    const data = big();
    expect(data.rowCount).toBe(5000);
    const filled = data.fillMissing({ value: 0 });
    expect(filled.rowCount).toBe(5000);
    expect(filled.data.filter((row) => row.value === 0).length).toBeGreaterThan(0);
  });

  it("de-duplicates a large dataset", () => {
    const data = big().dropDuplicates(["group"]);
    expect(data.rowCount).toBe(7);
  });

  it("samples deterministically from a large dataset", () => {
    const first = big().sample(100, { seed: 42 }).data;
    const second = big().sample(100, { seed: 42 }).data;
    expect(first).toEqual(second);
  });
});
