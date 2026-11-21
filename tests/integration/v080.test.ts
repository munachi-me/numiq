import { describe, expect, it } from "vitest";
import { createDataset, useSampleDataset } from "../../src/index.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

describe("v0.8.0 metrics through the public API", () => {
  it("builds the documented metric from the sample dataset", async () => {
    const data = await useSampleDataset();
    const revenue = data.createMetric({ name: "Total Revenue", column: "revenue", aggregation: "sum" });
    expect(revenue.name).toBe("Total Revenue");
    expect(revenue.metric.value).toBeCloseTo(31122.69, 6);
    expect(revenue.metric.rows).toBe(50);
    expect(revenue.metric.values).toBe(50);
    expect(revenue.definition).toBe('sum("revenue")');
  });

  it("agrees with describe() for the same column", async () => {
    const data = await useSampleDataset();
    const metric = data.createMetric({ name: "Total Revenue", column: "revenue", aggregation: "sum" });
    expect(metric.value).toBe(data.describe("revenue").sum);
  });

  it("agrees with a grouped aggregation", async () => {
    const data = await useSampleDataset();
    const metric = data.createMetric({
      name: "Region Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const grouped = data.groupBy("region").aggregate({ revenue: { column: "revenue", op: "sum" } });
    const fromMetric = new Map(metric.byGroup().groups.map((group) => [group.key.region, group.value]));
    expect(grouped.rowCount).toBe(metric.byGroup().groupCount);
    for (const row of grouped.data) expect(fromMetric.get(row.region)).toBe(row.revenue);
  });

  it("recalculates a metric against a filtered dataset", async () => {
    const data = await useSampleDataset();
    const total = data.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    const north = data.filter((row) => row.region === "North");
    const scoped = total.recalculate(north.data, north.columns);
    expect(scoped.value).toBeLessThan(total.value as number);
    expect(scoped.rowCount).toBe(north.rowCount);
  });

  it("compares two regions' revenue", async () => {
    const data = await useSampleDataset();
    const metric = data.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const groups = metric.byGroup().groups;
    const west = groups.find((group) => group.key.region === "West");
    const east = groups.find((group) => group.key.region === "East");
    expect(west?.value).toBeGreaterThan(east?.value as number);
  });

  it("exposes metric results on the default namespace too", async () => {
    const Numiq = (await import("../../src/index.js")).default;
    const data = await useSampleDataset();
    const metric = data.createMetric({ name: "Rows", aggregation: "count" });
    expect(metric).toBeInstanceOf(Numiq.Metric);
    expect(Numiq.createMetric({ name: "Rows", aggregation: "count" }, data.data, data.columns).value).toBe(50);
  });
});

describe("v0.8.0 insights through the public API", () => {
  it("analyses the sample dataset deterministically", async () => {
    const data = await useSampleDataset();
    const first = data.insights();
    const second = data.insights();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.insights.length).toBeGreaterThan(0);
  });

  it("gives every insight evidence that names its columns", async () => {
    const data = await useSampleDataset();
    for (const insight of data.insights().insights) {
      expect(Object.keys(insight.evidence).length).toBeGreaterThan(0);
      expect(insight.columns.length).toBeGreaterThan(0);
      for (const column of insight.columns) expect(data.columns).toContain(column);
    }
  });

  it("finds the revenue outliers the statistics layer reports", async () => {
    const data = await useSampleDataset();
    const outliers = data.insights().insights.find((insight) => insight.kind === "outliers");
    const direct = data.outliers("revenue");
    expect(outliers?.evidence.count).toBe(direct.outliers.length);
  });

  it("does not report a correlation below the threshold", async () => {
    const data = await useSampleDataset();
    // quantity against revenue is r = 0.4372, under the 0.7 default.
    expect(data.correlation("quantity", "revenue").r).toBeCloseTo(0.4372, 3);
    expect(data.insights().insights.some((insight) => insight.kind === "correlation")).toBe(false);
  });

  it("reports the same correlation when the threshold is lowered", async () => {
    const data = await useSampleDataset();
    const report = data.insights({ strongCorrelation: 0.4 });
    const correlation = report.insights.find((insight) => insight.kind === "correlation");
    expect(correlation?.evidence.r).toBeCloseTo(0.4372, 3);
    expect(correlation?.evidence.n).toBe(50);
  });

  it("treats the order id as an identifier, not a category", async () => {
    const data = await useSampleDataset();
    expect(data.unique("order_id")).toBe(data.rowCount);
    expect(data.insights().insights.some((insight) => insight.columns.includes("order_id"))).toBe(false);
  });

  it("never invents a trend without a date column", () => {
    const report = createDataset([{ a: 1 }, { a: 2 }, { a: 3 }]).insights();
    expect(report.insights.some((insight) => insight.kind === "trend")).toBe(false);
    expect(report.skipped.some((entry) => entry.kind === "trend")).toBe(true);
  });
});

describe("v0.8.0 error handling", () => {
  it("names a missing column", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.createMetric({ name: "Bad", column: "nope", aggregation: "sum" })).toThrow(ColumnNotFoundError);
  });

  it("rejects an unknown aggregation", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      // @ts-expect-error unknown aggregations are rejected at runtime
      data.createMetric({ name: "Bad", column: "a", aggregation: "total" }),
    ).toThrow(ValidationError);
  });

  it("rejects a threshold outside its range", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.insights({ strongCorrelation: 1.5 })).toThrow(RangeError);
  });

  it("handles an empty dataset without throwing", () => {
    const empty = createDataset([{ a: 1 }]).limit(0);
    expect(empty.createMetric({ name: "Rows", aggregation: "count" }).value).toBeNull();
    expect(empty.insights().insights).toEqual([]);
  });
});
