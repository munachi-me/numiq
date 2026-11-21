import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { concatRows, meltRows, pivotRows } from "../../src/core/reshape.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const long = () => [
  { region: "North", quarter: "Q1", revenue: 10 },
  { region: "North", quarter: "Q2", revenue: 20 },
  { region: "South", quarter: "Q1", revenue: 30 },
  { region: "South", quarter: "Q2", revenue: 40 },
];

describe("pivot", () => {
  it("turns distinct values into columns", () => {
    const result = createDataset(long()).pivot({ columns: "quarter", values: "revenue" });
    expect(result.columns).toEqual(["region", "Q1", "Q2"]);
    expect(result.data).toEqual([
      { region: "North", Q1: 10, Q2: 20 },
      { region: "South", Q1: 30, Q2: 40 },
    ]);
  });

  it("keeps column order as first appearance, not sorted", () => {
    const data = createDataset([
      { id: 1, key: "z", v: 1 },
      { id: 1, key: "a", v: 2 },
    ]);
    expect(data.pivot({ columns: "key", values: "v" }).columns).toEqual(["id", "z", "a"]);
  });

  it("fills a missing combination with null", () => {
    const data = createDataset([
      { region: "North", quarter: "Q1", revenue: 10 },
      { region: "South", quarter: "Q2", revenue: 40 },
    ]);
    expect(data.pivot({ columns: "quarter", values: "revenue" }).data).toEqual([
      { region: "North", Q1: 10, Q2: null },
      { region: "South", Q1: null, Q2: 40 },
    ]);
  });

  it("drops rows whose pivot key is missing", () => {
    const data = createDataset([
      { region: "North", quarter: null, revenue: 10 },
      { region: "South", quarter: "Q1", revenue: 40 },
    ]);
    const result = data.pivot({ columns: "quarter", values: "revenue" });
    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(["region", "Q1"]);
  });

  it("keeps the first value per cell by default", () => {
    const data = createDataset([
      { region: "North", quarter: "Q1", revenue: 10 },
      { region: "North", quarter: "Q1", revenue: 99 },
    ]);
    expect(data.pivot({ columns: "quarter", values: "revenue" }).data).toEqual([{ region: "North", Q1: 10 }]);
  });

  it("aggregates with sum", () => {
    const data = createDataset([
      { region: "North", quarter: "Q1", revenue: 10 },
      { region: "North", quarter: "Q1", revenue: 5 },
    ]);
    expect(data.pivot({ columns: "quarter", values: "revenue", aggregate: "sum" }).data).toEqual([
      { region: "North", Q1: 15 },
    ]);
  });

  it("aggregates with mean, min, max, last, and count", () => {
    const data = createDataset([
      { region: "N", quarter: "Q1", revenue: 10 },
      { region: "N", quarter: "Q1", revenue: 20 },
    ]);
    const cell = (aggregate: "mean" | "min" | "max" | "last" | "count") =>
      data.pivot({ columns: "quarter", values: "revenue", aggregate }).data[0]?.Q1;
    expect(cell("mean")).toBe(15);
    expect(cell("min")).toBe(10);
    expect(cell("max")).toBe(20);
    expect(cell("last")).toBe(20);
    expect(cell("count")).toBe(2);
  });

  it("returns null when summing no numeric values", () => {
    const data = createDataset([{ region: "N", quarter: "Q1", revenue: "n/a" }]);
    expect(data.pivot({ columns: "quarter", values: "revenue", aggregate: "sum" }).data[0]?.Q1).toBeNull();
  });

  it("honours an explicit index", () => {
    const data = createDataset([
      { region: "North", city: "A", quarter: "Q1", revenue: 10 },
      { region: "North", city: "B", quarter: "Q1", revenue: 20 },
    ]);
    const result = data.pivot({ columns: "quarter", values: "revenue", index: "region" });
    expect(result.columns).toEqual(["region", "Q1"]);
    expect(result.data).toEqual([{ region: "North", Q1: 10 }]);
  });

  it("supports several index columns", () => {
    const data = createDataset([
      { region: "N", city: "A", quarter: "Q1", revenue: 10 },
      { region: "N", city: "B", quarter: "Q1", revenue: 20 },
    ]);
    const result = data.pivot({ columns: "quarter", values: "revenue", index: ["region", "city"] });
    expect(result.columns).toEqual(["region", "city", "Q1"]);
    expect(result.rowCount).toBe(2);
  });

  it("reports pivoted columns and collapses", () => {
    const data = createDataset([
      { region: "N", quarter: "Q1", revenue: 10 },
      { region: "N", quarter: "Q1", revenue: 5 },
      { region: "N", quarter: "Q2", revenue: 7 },
    ]);
    const { pivoted, collapsed } = data.pivotReport({ columns: "quarter", values: "revenue" });
    expect(pivoted).toEqual(["Q1", "Q2"]);
    expect(collapsed).toBe(1);
  });

  it("leaves the source untouched", () => {
    const data = createDataset(long());
    const before = data.data;
    data.pivot({ columns: "quarter", values: "revenue" });
    expect(data.data).toEqual(before);
  });

  it("rejects an unknown columns argument", () => {
    expect(() => createDataset(long()).pivot({ columns: "nope", values: "revenue" })).toThrow(ColumnNotFoundError);
  });

  it("rejects an unknown values argument", () => {
    expect(() => createDataset(long()).pivot({ columns: "quarter", values: "nope" })).toThrow(ColumnNotFoundError);
  });

  it("rejects the same column for both", () => {
    expect(() => createDataset(long()).pivot({ columns: "quarter", values: "quarter" })).toThrow(/different columns/);
  });

  it("rejects an unknown aggregation", () => {
    expect(() =>
      createDataset(long()).pivot({ columns: "quarter", values: "revenue", aggregate: "median" as never }),
    ).toThrow(/aggregate/);
  });

  it("rejects a pivot column that collides with an index column", () => {
    const data = createDataset([{ id: 1, key: "id", v: 1 }]);
    expect(() => data.pivot({ columns: "key", values: "v" })).toThrow(/collide/);
  });
});

describe("melt", () => {
  it("unpivots with explicit idVars", () => {
    const data = createDataset([{ id: 1, a: 10, b: 20 }]);
    expect(data.melt({ idVars: "id" }).data).toEqual([
      { id: 1, variable: "a", value: 10 },
      { id: 1, variable: "b", value: 20 },
    ]);
  });

  it("derives idVars when only valueVars is given", () => {
    const data = createDataset([{ id: 1, a: 10, b: 20 }]);
    const result = data.melt({ valueVars: ["a", "b"] });
    expect(result.columns).toEqual(["id", "variable", "value"]);
    expect(result.rowCount).toBe(2);
  });

  it("honours custom variable and value names", () => {
    const data = createDataset([{ id: 1, a: 10 }]);
    const result = data.melt({ idVars: "id", variableName: "metric", valueName: "amount" });
    expect(result.data).toEqual([{ id: 1, metric: "a", amount: 10 }]);
  });

  it("keeps missing values as null by default", () => {
    const data = createDataset([{ id: 1, a: null }]);
    expect(data.melt({ idVars: "id" }).data).toEqual([{ id: 1, variable: "a", value: null }]);
  });

  it("drops missing values when asked", () => {
    const data = createDataset([{ id: 1, a: null }]);
    expect(data.melt({ idVars: "id", dropMissing: true }).rowCount).toBe(0);
  });

  it("round trips with pivot", () => {
    const wide = createDataset([
      { region: "North", Q1: 10, Q2: 20 },
      { region: "South", Q1: 30, Q2: 40 },
    ]);
    const back = wide.melt({ idVars: "region" }).pivot({ columns: "variable", values: "value" });
    expect(back.columns).toEqual(["region", "Q1", "Q2"]);
    expect(back.data).toEqual(wide.data);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset([{ id: 1 }]).melt({ idVars: "nope" })).toThrow(ColumnNotFoundError);
  });

  it("rejects a column that is both an id and a value", () => {
    const data = createDataset([{ id: 1, a: 2 }]);
    expect(() => data.melt({ idVars: "id", valueVars: ["id"] })).toThrow(/both an id and a value/);
  });

  it("rejects no options at all", () => {
    expect(() => createDataset([{ id: 1, a: 2 }]).melt()).toThrow(/idVars/);
  });

  it("rejects identical variable and value names", () => {
    const data = createDataset([{ id: 1, a: 2 }]);
    expect(() => data.melt({ idVars: "id", variableName: "x", valueName: "x" })).toThrow(/distinct/);
  });

  it("rejects generated names that collide with id columns", () => {
    // The id column is literally called "value", so the generated value column collides.
    const data = createDataset([{ value: 1, a: 2 }]);
    expect(() => data.melt({ idVars: "value" })).toThrow(/duplicate column names/);
  });

  it("has nothing to unpivot when every column is an id", () => {
    const data = createDataset([{ id: 1 }]);
    expect(() => data.melt({ idVars: "id" })).toThrow(/no value columns/);
  });
});

describe("concat", () => {
  it("stacks rows keeping this dataset first", () => {
    const a = createDataset([{ id: 1 }]);
    const b = createDataset([{ id: 2 }]);
    expect(a.concat(b).data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("accepts an array", () => {
    const a = createDataset([{ id: 1 }]);
    const result = a.concat([createDataset([{ id: 2 }]), createDataset([{ id: 3 }])]);
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("takes the union of columns by default and fills gaps", () => {
    const a = createDataset([{ id: 1, x: 1 }]);
    const b = createDataset([{ id: 2, y: 2 }]);
    const result = a.concat(b);
    expect(result.columns).toEqual(["id", "x", "y"]);
    expect(result.data).toEqual([
      { id: 1, x: 1, y: null },
      { id: 2, x: null, y: 2 },
    ]);
  });

  it("rejects differing columns in strict mode", () => {
    const a = createDataset([{ id: 1, x: 1 }]);
    const b = createDataset([{ id: 2, y: 2 }]);
    expect(() => a.concat(b, { columns: "strict" })).toThrow(/identical column sets/);
  });

  it("accepts identical columns in strict mode", () => {
    const a = createDataset([{ id: 1 }]);
    const b = createDataset([{ id: 2 }]);
    expect(a.concat(b, { columns: "strict" }).data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("rejects a non-Dataset argument", () => {
    expect(() => createDataset([{ id: 1 }]).concat({} as never)).toThrow(/expects Datasets/);
  });

  it("leaves sources untouched", () => {
    const a = createDataset([{ id: 1 }]);
    const b = createDataset([{ id: 2 }]);
    a.concat(b);
    expect(a.data).toEqual([{ id: 1 }]);
    expect(b.data).toEqual([{ id: 2 }]);
  });

  it("works through the standalone function", () => {
    const result = concatRows([
      { rows: [{ id: 1 }], columns: ["id"] },
      { rows: [{ id: 2 }], columns: ["id"] },
    ]);
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("rejects an empty table list", () => {
    expect(() => concatRows([])).toThrow(/at least one dataset/);
  });

  it("clones values so a stacked row cannot mutate its source", () => {
    const nested = { n: 1 };
    const a = createDataset([{ id: 1, meta: nested }]);
    const result = a.concat(createDataset([{ id: 2 }]));
    (result.data[0]?.meta as { n: number }).n = 99;
    expect(nested.n).toBe(1);
  });
});

describe("reshape standalone functions", () => {
  it("pivotRows works on raw rows", () => {
    const result = pivotRows([{ id: 1, k: "a", v: 2 }], ["id", "k", "v"], { columns: "k", values: "v" });
    expect(result.rows).toEqual([{ id: 1, a: 2 }]);
    expect(result.pivoted).toEqual(["a"]);
  });

  it("meltRows works on raw rows", () => {
    const result = meltRows([{ id: 1, a: 2 }], ["id", "a"], { idVars: "id" });
    expect(result.rows).toEqual([{ id: 1, variable: "a", value: 2 }]);
  });

  it("rejects a non-object options argument", () => {
    expect(() => pivotRows([], [], null as never)).toThrow(ValidationError);
  });
});
