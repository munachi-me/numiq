import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { analyze, resolveInsightOptions } from "../../src/insights/insights.js";
import type { Insight, InsightKind } from "../../src/insights/insights.js";

/** Every evidence object must be non-empty: an insight without numbers is an assertion. */
function expectEvidence(insight: Insight): void {
  expect(Object.keys(insight.evidence).length).toBeGreaterThan(0);
  expect(insight.title.length).toBeGreaterThan(0);
  expect(insight.detail.length).toBeGreaterThan(0);
}

describe("Insight thresholds", () => {
  it("applies documented defaults", () => {
    expect(resolveInsightOptions()).toEqual({
      strongCorrelation: 0.7,
      dominanceShare: 0.5,
      outlierThreshold: 1.5,
      trendStrength: 0.7,
      minGroupSize: 3,
      maxCategoryRatio: 0.5,
      minRelativeGap: 0.25,
      maxInsights: 50,
      minTrendPoints: 4,
    });
  });

  it("merges overrides without losing the rest", () => {
    const resolved = resolveInsightOptions({ strongCorrelation: 0.9 });
    expect(resolved.strongCorrelation).toBe(0.9);
    expect(resolved.dominanceShare).toBe(0.5);
  });

  it("rejects thresholds that would produce nonsense", () => {
    expect(() => resolveInsightOptions({ strongCorrelation: 2 })).toThrow(RangeError);
    expect(() => resolveInsightOptions({ dominanceShare: 0 })).toThrow(RangeError);
    expect(() => resolveInsightOptions({ outlierThreshold: 0 })).toThrow(RangeError);
    expect(() => resolveInsightOptions({ minGroupSize: 0 })).toThrow(RangeError);
    expect(() => resolveInsightOptions({ maxInsights: 0 })).toThrow(RangeError);
    expect(() => resolveInsightOptions({ minTrendPoints: 2 })).toThrow(RangeError);
  });

  it("reports the thresholds it actually used", () => {
    const report = createDataset([{ a: 1 }]).insights({ dominanceShare: 0.8 });
    expect(report.thresholds.dominanceShare).toBe(0.8);
  });
});

describe("Insight report structure", () => {
  it("returns insights, skipped, truncated and thresholds", () => {
    const report = createDataset([{ a: 1, b: "x" }]).insights();
    expect(report).toHaveProperty("insights");
    expect(report).toHaveProperty("skipped");
    expect(report).toHaveProperty("truncated");
    expect(report).toHaveProperty("thresholds");
    expect(Array.isArray(report.insights)).toBe(true);
  });

  it("gives every insight its evidence", () => {
    const data = createDataset([
      { region: "north", revenue: 10, qty: 1 },
      { region: "north", revenue: 12, qty: 2 },
      { region: "north", revenue: 11, qty: 3 },
      { region: "south", revenue: 400, qty: 4 },
      { region: "south", revenue: 410, qty: 5 },
      { region: "south", revenue: 405, qty: 6 },
      { region: "east", revenue: 11, qty: 7 },
      { region: "east", revenue: 13, qty: 8 },
      { region: "east", revenue: 12, qty: 9 },
    ]);
    const report = data.insights();
    expect(report.insights.length).toBeGreaterThan(0);
    for (const insight of report.insights) expectEvidence(insight);
  });

  it("is deterministic across runs", () => {
    const data = createDataset([
      { region: "a", v: 1 },
      { region: "b", v: 100 },
      { region: "c", v: 2 },
    ]);
    expect(JSON.stringify(data.insights())).toBe(JSON.stringify(data.insights()));
  });

  it("orders insights by a stable kind order", () => {
    const data = createDataset([
      { region: "a", v: 1, w: 1 },
      { region: "b", v: 100, w: 2 },
      { region: "c", v: 2, w: 3 },
    ]);
    const kinds = data.insights().insights.map((insight) => insight.kind);
    const order: InsightKind[] = [
      "missing-data",
      "outliers",
      "correlation",
      "category-extreme",
      "group-change",
      "dominance",
      "trend",
    ];
    const positions = kinds.map((kind) => order.indexOf(kind));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("Missing-data insights", () => {
  it("reports the count and share per column", () => {
    const data = createDataset([
      { a: 1, b: "x" },
      { a: null, b: "y" },
      { a: null, b: "z" },
      { a: 4, b: "w" },
    ]);
    const insight = data.insights().insights.find((candidate) => candidate.kind === "missing-data");
    expect(insight?.evidence).toMatchObject({ column: "a", missing: 2, total: 4, share: 0.5 });
    expect(insight?.severity).toBe("warning");
  });

  it("stays silent when nothing is missing", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    expect(data.insights().insights.some((insight) => insight.kind === "missing-data")).toBe(false);
  });

  it("does not count a missing cell as zero anywhere", () => {
    const data = createDataset([{ a: 10 }, { a: null }]);
    const missing = data.insights().insights.find((insight) => insight.kind === "missing-data");
    expect(missing?.evidence.missing).toBe(1);
    expect(data.createMetric({ name: "S", column: "a", aggregation: "sum" }).value).toBe(10);
  });
});

describe("Outlier insights", () => {
  it("reports the fence values with the count", () => {
    const data = createDataset([{ v: 10 }, { v: 11 }, { v: 12 }, { v: 13 }, { v: 12 }, { v: 11 }, { v: 1000 }]);
    const insight = data.insights().insights.find((candidate) => candidate.kind === "outliers");
    expect(insight).toBeDefined();
    expect(insight?.evidence.count).toBe(1);
    expect(insight?.evidence.fences).toBeDefined();
    expect(insight?.detail).toContain("not an error");
  });

  it("stays silent on a tight distribution", () => {
    const data = createDataset([{ v: 10 }, { v: 11 }, { v: 12 }, { v: 13 }, { v: 12 }]);
    expect(data.insights().insights.some((insight) => insight.kind === "outliers")).toBe(false);
  });

  it("honours the configured threshold", () => {
    // 20 sits outside the Tukey fence (upper 10) but inside a generous one (upper 20.5).
    const data = createDataset([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }, { v: 6 }, { v: 20 }]);
    const strict = data.insights({ outlierThreshold: 1.5 }).insights.some((i) => i.kind === "outliers");
    const loose = data.insights({ outlierThreshold: 5 }).insights.some((i) => i.kind === "outliers");
    expect(strict).toBe(true);
    expect(loose).toBe(false);
  });
});

describe("Correlation insights", () => {
  it("reports a strong relationship with r and n", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ x: index, y: index * 2 + 1 }));
    const insight = createDataset(rows)
      .insights()
      .insights.find((candidate) => candidate.kind === "correlation");
    expect(insight?.evidence).toMatchObject({ left: "x", right: "y", n: 10 });
    expect(insight?.evidence.r).toBeCloseTo(1, 10);
  });

  it("avoids a false positive on a weak relationship", () => {
    const data = createDataset([
      { x: 1, y: 5 },
      { x: 2, y: 1 },
      { x: 3, y: 9 },
      { x: 4, y: 2 },
      { x: 5, y: 8 },
    ]);
    expect(data.insights().insights.some((insight) => insight.kind === "correlation")).toBe(false);
  });

  it("never claims causation or significance", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ x: index, y: index }));
    const insight = createDataset(rows)
      .insights()
      .insights.find((candidate) => candidate.kind === "correlation");
    expect(insight?.detail).toContain("Correlation is not causation");
    expect(insight?.evidence).not.toHaveProperty("pValue");
    expect(insight?.detail).not.toMatch(/significant/i);
  });

  it("does not call a lowered-threshold relationship strong", () => {
    // r is about 0.44: reportable at a 0.4 threshold, but not conventionally strong.
    const rows = Array.from({ length: 20 }, (_, index) => ({
      x: index,
      y: index % 3 === 0 ? index * 3 : index,
    }));
    const insight = createDataset(rows)
      .insights({ strongCorrelation: 0.3 })
      .insights.find((candidate) => candidate.kind === "correlation");
    expect(insight).toBeDefined();
    expect(insight?.title).not.toContain("strongly");
    expect(insight?.title).toContain("correlated");
  });

  it("skips when fewer than two numeric columns exist", () => {
    const report = createDataset([{ a: 1, b: "x" }]).insights();
    expect(report.skipped.some((entry) => entry.kind === "correlation")).toBe(true);
  });
});

describe("Category extreme and group change", () => {
  const SPREAD = createDataset([
    { region: "north", revenue: 10 },
    { region: "north", revenue: 12 },
    { region: "north", revenue: 11 },
    { region: "south", revenue: 400 },
    { region: "south", revenue: 410 },
    { region: "south", revenue: 405 },
    { region: "east", revenue: 11 },
    { region: "east", revenue: 13 },
    { region: "east", revenue: 12 },
  ]);

  it("names the highest and lowest groups with counts", () => {
    const insight = SPREAD.insights().insights.find((candidate) => candidate.kind === "category-extreme");
    expect(insight?.evidence).toMatchObject({
      dimension: "region",
      measure: "revenue",
      highest: { key: "south" },
      lowest: { key: "north" },
    });
  });

  it("reports a large gap across three or more groups", () => {
    const insight = SPREAD.insights().insights.find((candidate) => candidate.kind === "group-change");
    expect(insight?.evidence).toMatchObject({ dimension: "region", measure: "revenue" });
    expect(insight?.evidence.gap).toBeCloseTo(394, 6);
  });

  it("suppresses a gap that is noise relative to the range", () => {
    // Means differ by 0.17 on a 1-to-7 scale; that is not a finding.
    const data = createDataset([
      { region: "a", qty: 1 },
      { region: "a", qty: 2 },
      { region: "b", qty: 2 },
      { region: "b", qty: 3 },
      { region: "c", qty: 6 },
      { region: "c", qty: 7 },
    ]);
    const report = data.insights({ minRelativeGap: 0.5 });
    expect(report.insights.some((insight) => insight.kind === "group-change")).toBe(false);
  });

  it("ignores identifier-like columns as dimensions", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      order_id: `ORD-${index}`,
      region: index % 2 === 0 ? "north" : "south",
      revenue: index * 10,
    }));
    const report = createDataset(rows).insights();
    expect(report.insights.some((insight) => insight.columns.includes("order_id"))).toBe(false);
    expect(report.insights.some((insight) => insight.columns.includes("region"))).toBe(true);
  });

  it("does not rank groups below the minimum size", () => {
    const data = createDataset([
      { region: "north", revenue: 10 },
      { region: "north", revenue: 11 },
      { region: "south", revenue: 999 },
    ]);
    const report = data.insights({ minGroupSize: 3 });
    expect(report.insights.some((insight) => insight.kind === "category-extreme")).toBe(false);
  });
});

describe("Dominance insights", () => {
  it("reports a majority value with its share", () => {
    const data = createDataset([{ region: "north" }, { region: "north" }, { region: "north" }, { region: "south" }]);
    const insight = data.insights().insights.find((candidate) => candidate.kind === "dominance");
    expect(insight?.evidence).toMatchObject({ column: "region", value: "north", count: 3, present: 4, share: 0.75 });
    // The evidence holds the value as a reader sees it, not an internal identity key.
    expect(String(insight?.evidence.value)).not.toContain("string:");
  });

  it("stays silent when no value reaches the threshold", () => {
    const data = createDataset([{ region: "a" }, { region: "b" }, { region: "c" }, { region: "d" }]);
    expect(data.insights().insights.some((insight) => insight.kind === "dominance")).toBe(false);
  });

  it("honours a stricter threshold", () => {
    const data = createDataset([{ region: "north" }, { region: "north" }, { region: "north" }, { region: "south" }]);
    expect(data.insights({ dominanceShare: 0.9 }).insights.some((i) => i.kind === "dominance")).toBe(false);
  });
});

describe("Trend insights", () => {
  const TREND = createDataset([
    { date: "2026-01-01", revenue: 10 },
    { date: "2026-02-01", revenue: 20 },
    { date: "2026-03-01", revenue: 30 },
    { date: "2026-04-01", revenue: 40 },
    { date: "2026-05-01", revenue: 50 },
  ]);

  it("reports a monotonic rise over a date column", () => {
    const insight = TREND.insights().insights.find((candidate) => candidate.kind === "trend");
    expect(insight?.evidence).toMatchObject({ timeColumn: "date", measure: "revenue", n: 5, distinctTimes: 5 });
    expect(insight?.evidence.rho).toBeCloseTo(1, 10);
    expect(insight?.detail).toContain("not a forecast");
  });

  it("reports a fall", () => {
    const data = createDataset([
      { date: "2026-01-01", v: 50 },
      { date: "2026-02-01", v: 40 },
      { date: "2026-03-01", v: 30 },
      { date: "2026-04-01", v: 20 },
    ]);
    expect(data.insights().insights.find((i) => i.kind === "trend")?.title).toContain("falling");
  });

  it("stays silent without a clear monotonic pattern", () => {
    const data = createDataset([
      { date: "2026-01-01", v: 10 },
      { date: "2026-02-01", v: 90 },
      { date: "2026-03-01", v: 15 },
      { date: "2026-04-01", v: 85 },
      { date: "2026-05-01", v: 12 },
    ]);
    expect(data.insights().insights.some((insight) => insight.kind === "trend")).toBe(false);
  });

  it("skips when there is no temporal column", () => {
    const report = createDataset([{ a: 1 }, { a: 2 }]).insights();
    expect(report.skipped.some((entry) => entry.kind === "trend")).toBe(true);
  });

  it("skips when there are too few distinct time points", () => {
    const data = createDataset([
      { date: "2026-01-01", v: 10 },
      { date: "2026-01-01", v: 20 },
      { date: "2026-01-01", v: 30 },
    ]);
    expect(data.insights().insights.some((insight) => insight.kind === "trend")).toBe(false);
  });
});

describe("Degenerate inputs", () => {
  it("returns no insights and explains every skipped check for an empty dataset", () => {
    const report = createDataset([{ a: 1 }])
      .limit(0)
      .insights();
    expect(report.insights).toEqual([]);
    expect(report.skipped.length).toBe(7);
    for (const entry of report.skipped) expect(entry.reason).toMatch(/no rows/);
  });

  it("distinguishes an empty result from a check that never ran", () => {
    const quiet = createDataset([
      { region: "a", v: 10 },
      { region: "a", v: 10 },
      { region: "a", v: 10 },
      { region: "b", v: 10 },
      { region: "b", v: 10 },
      { region: "b", v: 10 },
      { region: "c", v: 10 },
      { region: "c", v: 10 },
      { region: "c", v: 10 },
    ]).insights();
    expect(quiet.insights).toEqual([]);
    // Nothing fired, yet the report still explains which checks were inapplicable: one
    // numeric column rules out correlations, and there is no date column to trend over.
    expect(quiet.skipped.map((entry) => entry.kind).sort()).toEqual(["correlation", "trend"]);
  });

  it("truncates and reports how many were dropped", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ [`c${index}`]: null, v: index }));
    const report = createDataset(rows).insights({ maxInsights: 2 });
    expect(report.insights.length).toBe(2);
    expect(report.truncated).toBeGreaterThan(0);
  });

  it("handles a single-row dataset without inventing findings", () => {
    const report = createDataset([{ a: 1, b: "x" }]).insights();
    expect(report.insights).toEqual([]);
  });

  it("works through the standalone analyze function", () => {
    const data = createDataset([
      { region: "a", v: 1 },
      { region: "b", v: 2 },
      { region: "c", v: 3 },
    ]);
    const report = analyze({ rows: data.data, columns: data.columns, schema: data.schema });
    expect(report.thresholds.maxInsights).toBe(50);
  });
});
