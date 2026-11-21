import { describe, expect, it } from "vitest";
import { loadCSV } from "../../src/node.js";
import { useSampleDataset } from "../../src/core/sample.js";

describe("grouping on a loaded dataset", () => {
  it("summarises the bundled sample by region", async () => {
    const sample = await useSampleDataset();
    const summary = sample.groupBy("region").aggregate({
      totalRevenue: { column: "revenue", op: "sum" },
      averageOrder: { column: "revenue", op: "mean" },
      orderCount: { op: "count" },
    });

    expect(summary.columns).toEqual(["region", "totalRevenue", "averageOrder", "orderCount"]);
    expect(summary.importReport).toBeNull();

    // Every source row is accounted for by exactly one group.
    const counted = summary.data.reduce((total, row) => total + Number(row.orderCount), 0);
    expect(counted).toBe(sample.rowCount);
  });

  it("produces totals that match a manual pass over the rows", async () => {
    const sample = await useSampleDataset();
    const summary = sample.groupBy("region").aggregate({
      total: { column: "revenue", op: "sum" },
      n: { op: "count" },
    });

    for (const row of summary.data) {
      const matching = sample.data.filter((source) => source.region === row.region);
      const expected = matching.reduce((total, source) => total + Number(source.revenue), 0);
      expect(row.total).toBeCloseTo(expected, 6);
      expect(row.n).toBe(matching.length);
    }
  });

  it("keeps group order deterministic across runs", async () => {
    const sample = await useSampleDataset();
    const firstRun = sample.groupBy("region").aggregate({ n: { op: "count" } }).data;
    const secondRun = sample.groupBy("region").aggregate({ n: { op: "count" } }).data;
    expect(firstRun).toEqual(secondRun);
  });

  it("groups by two columns of the sample", async () => {
    const sample = await useSampleDataset();
    const summary = sample.groupBy("region", "category").aggregate({ n: { op: "count" } });
    const counted = summary.data.reduce((total, row) => total + Number(row.n), 0);
    expect(counted).toBe(sample.rowCount);
  });

  it("groups a CSV loaded from the dataset directory", async () => {
    const sales = await loadCSV("sales.csv");
    const summary = sales.groupBy("product").aggregate({
      total: { column: "amount", op: "sum" },
      n: { op: "count" },
    });
    expect(summary.rowCount).toBe(3);
    expect(summary.columns).toEqual(["product", "total", "n"]);
  });

  it("computes the same total as a manual reduction on loaded CSV data", async () => {
    const sales = await loadCSV("sales.csv");
    const summary = sales.groupBy("product").aggregate({ total: { column: "amount", op: "sum" } });
    const grand = summary.data.reduce((total, row) => total + Number(row.total), 0);
    const manual = sales.data.reduce((total, row) => total + Number(row.amount), 0);
    expect(grand).toBeCloseTo(manual, 6);
  });

  it("aggregates a date column's range", async () => {
    const sales = await loadCSV("sales.csv");
    const summary = sales.groupBy("product").aggregate({
      earliest: { column: "ordered_on", op: "min" },
      latest: { column: "ordered_on", op: "max" },
    });
    for (const row of summary.data) {
      expect(String(row.earliest) <= String(row.latest)).toBe(true);
    }
  });

  it("composes grouping with a query and preparation", async () => {
    const sample = await useSampleDataset();
    const result = sample
      .query()
      .where("revenue", ">", 0)
      .execute()
      .groupBy("region")
      .aggregate({ total: { column: "revenue", op: "sum" } })
      .sort("total", "desc")
      .head(3);
    expect(result.rowCount).toBe(3);
  });

  it("rejects a numeric aggregation on a text column of loaded data", async () => {
    const sample = await useSampleDataset();
    expect(() => sample.groupBy("region").aggregate({ x: { column: "product", op: "sum" } })).toThrow(/numeric/);
  });
});
