import { describe, expect, it } from "vitest";
import { createDataset, useSampleDataset } from "../../src/index.js";

describe("v0.9.0 conditional columns through the public API", () => {
  it("runs the documented example", () => {
    const data = createDataset([{ age: 10 }, { age: 30 }, { age: 70 }]);
    const result = data.addConditionalColumn(
      "category",
      [
        { when: (row) => (row.age as number) < 18, then: "Child" },
        { when: (row) => (row.age as number) < 65, then: "Adult" },
        { when: (row) => (row.age as number) >= 65, then: "Elder" },
      ],
      { else: "Unknown" },
    );
    expect(result.data.map((row) => row.category)).toEqual(["Child", "Adult", "Elder"]);
  });

  it("bands a real column on the sample dataset", async () => {
    const data = await useSampleDataset();
    const result = data.addConditionalColumn(
      "size",
      [
        { when: (row) => (row.quantity as number) >= 5, then: "bulk" },
        { when: (row) => (row.quantity as number) >= 3, then: "standard" },
      ],
      { else: "single" },
    );

    expect(result.rowCount).toBe(data.rowCount);
    expect(result.columns).toEqual([...data.columns, "size"]);

    const counts = result.groupBy("size").aggregate({ n: { op: "count" } });
    const total = counts.data.reduce((sum, row) => sum + (row.n as number), 0);
    expect(total).toBe(data.rowCount);
  });

  it("composes with metrics", async () => {
    const data = await useSampleDataset();
    const banded = data.addConditionalColumn("size", [
      { when: (row) => (row.quantity as number) >= 4, then: "bulk" },
      { when: () => true, then: "standard" },
    ]);
    const bulk = banded.createMetric({
      name: "bulkRevenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["size"],
    });
    const groups = bulk.byGroup().groups;
    expect(groups.length).toBe(2);
    const grand = groups.reduce((sum, group) => sum + group.value, 0);
    expect(grand).toBeCloseTo(banded.createMetric({ name: "t", column: "revenue", aggregation: "sum" }).value, 6);
  });

  it("composes with insights", async () => {
    const data = await useSampleDataset();
    const banded = data.addConditionalColumn("size", [
      { when: (row) => (row.quantity as number) >= 4, then: "bulk" },
      { when: () => true, then: "standard" },
    ]);
    const report = banded.insights();
    expect(report.insights.length).toBeGreaterThan(0);
    expect(report.truncated).toBe(0);
  });

  it("composes with describe", async () => {
    const data = await useSampleDataset();
    const banded = data.addConditionalColumn("label", [
      { when: (row) => (row.revenue as number) > 1000, then: "high" },
      { when: () => true, then: "low" },
    ]);
    expect(banded.describe("label").unique).toBe(2);
    expect(banded.describe("label").type).toBe("string");
  });
});

describe("v0.9.0 joins through the public API", () => {
  it("joins two datasets end to end", () => {
    const orders = createDataset([
      { order: 1, customer: 10 },
      { order: 2, customer: 20 },
    ]);
    const customers = createDataset([
      { customer: 10, name: "Ada" },
      { customer: 20, name: "Bo" },
    ]);
    const result = orders.join(customers, { on: "customer" });
    expect(result.data).toEqual([
      { order: 1, customer: 10, name: "Ada" },
      { order: 2, customer: 20, name: "Bo" },
    ]);
  });

  it("joins the sample dataset to a derived lookup", async () => {
    const data = await useSampleDataset();
    const regions = data
      .groupBy("region")
      .aggregate({ revenue: { column: "revenue", op: "sum" } })
      .addConditionalColumn("size", [
        { when: (row) => (row.revenue as number) > 8000, then: "major" },
        { when: () => true, then: "minor" },
      ]);

    const joined = data.join(regions, { on: "region", how: "left" });
    expect(joined.rowCount).toBe(data.rowCount);
    expect(joined.columns).toContain("size");
    expect(joined.describe("size").missing).toBe(0);
  });

  it("leaves both sources intact after a full join", async () => {
    const data = await useSampleDataset();
    const lookup = createDataset([{ region: "North", code: "N" }]);
    const before = data.data;
    data.join(lookup, { on: "region", how: "full" });
    expect(data.data).toEqual(before);
  });
});

describe("v0.9.0 reshaping through the public API", () => {
  it("pivots and melts back to the same table", () => {
    const wide = createDataset([
      { region: "North", Q1: 10, Q2: 20 },
      { region: "South", Q1: 30, Q2: 40 },
    ]);
    const long = wide.melt({ idVars: "region" });
    expect(long.rowCount).toBe(4);

    const back = long.pivot({ columns: "variable", values: "value" });
    expect(back.columns).toEqual(["region", "Q1", "Q2"]);
    expect(back.data).toEqual(wide.data);
  });

  it("stacks sample rows with a derived slice", async () => {
    const data = await useSampleDataset();
    const head = data.head(10);
    const tail = data.tail(10);
    const stacked = head.concat(tail);
    expect(stacked.rowCount).toBe(20);
    expect(stacked.columns).toEqual(data.columns);
  });

  it("keeps a stacked dataset analysable", async () => {
    const data = await useSampleDataset();
    const stacked = data.head(10).concat(data.tail(10));
    const metric = stacked.createMetric({ name: "t", column: "revenue", aggregation: "sum" });
    expect(metric.metric.rows).toBe(20);
    expect(metric.value).toBeGreaterThan(0);
  });
});
