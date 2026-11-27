/**
 * The 2.0.0 API contract.
 *
 * `unique()` changed meaning: it returned a count and now returns the values, matching
 * `distinct()` and the pandas idiom. The count moved to `uniqueCount()`. This is the one
 * silent behaviour change in 2.0.0, so it is pinned here explicitly.
 */
import { describe, expect, it } from "vitest";
import { createDataset, createDataSpace } from "../../src/index.js";

const data = () =>
  createDataset([
    { region: "north", revenue: 100 },
    { region: "south", revenue: 200 },
    { region: "north", revenue: 300 },
    { region: "east", revenue: null },
  ]);

describe("2.0.0 — unique() returns values", () => {
  it("returns the distinct values, like distinct()", () => {
    expect(data().unique("region")).toEqual(["north", "south", "east"]);
    expect(data().unique("region")).toEqual(data().distinct("region"));
  });

  it("no longer returns a number", () => {
    expect(typeof data().unique("region")).toBe("object");
    expect(Array.isArray(data().unique("region"))).toBe(true);
  });

  it("keeps the count in uniqueCount()", () => {
    expect(data().uniqueCount("region")).toBe(3);
    expect(data().unique("region")).toHaveLength(data().uniqueCount("region"));
  });

  it("excludes nulls from both", () => {
    expect(data().unique("revenue")).toEqual([100, 200, 300]);
    expect(data().uniqueCount("revenue")).toBe(3);
  });

  it("agrees with the nunique aggregation", () => {
    const grouped = data()
      .groupBy("region")
      .aggregate({ n: { column: "revenue", op: "nunique" } });
    const total = grouped.data.reduce((sum, row) => sum + Number(row.n), 0);
    expect(total).toBe(data().uniqueCount("revenue"));
  });

  it("rejects an unknown column in both", () => {
    expect(() => data().unique("nope")).toThrow();
    expect(() => data().uniqueCount("nope")).toThrow();
  });
});

describe("2.0.0 — deprecated aliases still work", () => {
  it("getQualityReport delegates to qualityReport", () => {
    const report = data().getQualityReport();
    expect(report).toEqual(data().qualityReport());
  });

  it("toTable delegates to table", () => {
    expect(data().toTable()).toBe(data().table());
  });
});

describe("2.0.0 — existing surface is unchanged", () => {
  it("shape and counts keep their names", () => {
    expect(data().rowCount).toBe(4);
    expect(data().columnCount).toBe(2);
    expect(data().length).toBe(4);
    expect(data().shape).toEqual([4, 2]);
  });

  it("data spaces keep working", () => {
    const space = createDataSpace("s");
    space.addDataset("d", data());
    expect(space.size).toBe(1);
    expect(space.describeDataset("d").rowCount).toBe(4);
  });
});
