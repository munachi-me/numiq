import { describe, expect, it } from "vitest";
import { createDataset, max, min, mode, nunique } from "../../src/index.js";

/**
 * The free aggregate functions take the raw cells of a column, missing ones included,
 * while `Dataset`, `describe()` and `groupBy()` filter missing cells before aggregating.
 * They disagreed: `nunique` counted `null` as a distinct value and `max` let a leading
 * `null` win outright. These tests pin the free functions to the same answers.
 */
describe("v1.0.6 missing values in the free aggregates", () => {
  const rows = [{ a: 1 }, { a: null }, { a: 1 }, { a: 2 }, { a: 3 }];
  const data = createDataset(rows);
  const cells = data.data.map((row) => row.a);

  it("agrees with Dataset.unique and describe().unique", () => {
    expect(nunique(cells)).toBe(data.unique("a"));
    expect(nunique(cells)).toBe(data.describe("a").unique);
    expect(nunique(cells)).toBe(3);
  });

  it("agrees with groupBy's nunique aggregation", () => {
    const grouped = createDataset([
      { k: "x", a: 1 },
      { k: "x", a: null },
      { k: "x", a: 2 },
    ])
      .groupBy("k")
      .aggregate({ n: { column: "a", op: "nunique" } }).data;
    expect(grouped).toEqual([{ k: "x", n: 2 }]);
    expect(nunique([1, null, 2])).toBe(2);
  });

  it("agrees with describe() on the extremes and the mode", () => {
    const profile = data.describe("a");
    expect(min(cells)).toBe(profile.min);
    expect(max(cells)).toBe(profile.max);
    expect(mode(cells)).toBe(profile.mode);
    expect(max(cells)).toBe(3);
  });

  it("finds the extremes of an imported column with a leading missing cell", () => {
    const imported = createDataset([{ v: null }, { v: 10 }, { v: 4 }]);
    expect(max(imported.data.map((row) => row.v))).toBe(10);
    expect(min(imported.data.map((row) => row.v))).toBe(4);
  });
});
