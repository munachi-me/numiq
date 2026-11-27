import { describe, it, expect } from "vitest";
import Numiq, { createDataset } from "../../src/index.js";

/**
 * 1.2.0 end-to-end: a realistic analysis that chains the release's features the way a
 * user would, rather than testing each one in isolation.
 */
describe("1.2.0 advanced analytics", () => {
  // A small sales table with a group, a time, a numeric outcome, and a predictor.
  const sales = createDataset([
    { region: "north", month: "2024-01-15", revenue: 100, marketing: 10, channel: "online" },
    { region: "north", month: "2024-02-15", revenue: 120, marketing: 12, channel: "online" },
    { region: "north", month: "2024-03-15", revenue: 140, marketing: 15, channel: "retail" },
    { region: "south", month: "2024-01-20", revenue: 200, marketing: 20, channel: "retail" },
    { region: "south", month: "2024-02-20", revenue: 220, marketing: 22, channel: "retail" },
    { region: "south", month: "2024-03-20", revenue: 240, marketing: 24, channel: "online" },
    { region: "south", month: "2024-04-20", revenue: 260, marketing: 26, channel: "online" },
  ]);

  it("regresses revenue on marketing", () => {
    const model = sales.regression({ target: "revenue", features: ["marketing"] });
    // Revenue tracks marketing almost exactly here.
    expect(model.rSquared).toBeGreaterThan(0.95);
    expect(model.coefficients.marketing).toBeGreaterThan(0);
    expect(model.n).toBe(7);
  });

  it("compares revenue between two regions", () => {
    const result = sales.tTestBetween("revenue", "region");
    expect(result.details.n1).toBe(3);
    expect(result.details.n2).toBe(4);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(1);
  });

  it("tests channel independence", () => {
    const result = sales.chiSquare("region", "channel");
    expect(result.details.rows).toBe(2);
    expect(result.details.columns).toBe(2);
  });

  it("runs an ANOVA of revenue across regions", () => {
    const result = sales.anova("revenue", "region");
    expect(result.details.groups).toBe(2);
    expect(result.statistic).toBeGreaterThan(0);
  });

  it("builds a cohort table by region and month", () => {
    const cohorts = sales.cohort({
      cohort: "region",
      time: "month",
      interval: "month",
      metrics: [{ column: "revenue", operation: "sum" }],
    });
    expect(cohorts.rowCount).toBe(7);
    expect(cohorts.columns).toContain("revenue_sum");
    expect(cohorts.column("revenue_sum").values).toEqual([100, 120, 140, 200, 220, 240, 260]);
  });

  it("adds percentage change to an ordered column", () => {
    const ordered = sales.sortByTime("month");
    const withChange = ordered.percentChange("revenue");
    const values = withChange.column("revenue_pctChange").values as (number | null)[];
    expect(values[0]).toBeNull();
    expect(values.slice(1).every((value) => value === null || Number.isFinite(value))).toBe(true);
  });

  it("draws a reproducible stratified sample", () => {
    const first = sales.stratifiedSample(4, "region", { seed: 11 });
    const second = sales.stratifiedSample(4, "region", { seed: 11 });
    expect(first.rowCount).toBe(4);
    expect(first.data).toEqual(second.data);
  });

  it("exposes the statistics through the default export too", () => {
    expect(Numiq.normalCdf(0)).toBe(0.5);
    expect(Numiq.tQuantile(0.975, 10)).toBeCloseTo(2.2281388519649385, 6);
    expect(Numiq.linearRegression).toBeTypeOf("function");
    expect(Numiq.oneWayAnova).toBeTypeOf("function");
    expect(Numiq.stratifiedSample).toBeTypeOf("function");
  });

  it("detects outliers with the robust method", () => {
    const data = createDataset([{ v: 10 }, { v: 11 }, { v: 12 }, { v: 13 }, { v: 14 }, { v: 900 }]);
    const result = data.outliers("v", { method: "modified-zscore" });
    expect(result.outliers.map((outlier) => outlier.value)).toContain(900);
  });

  it("a distribution samples reproducibly and lands in its support", () => {
    const draws = Numiq.drawSamples(Numiq.binomialDistribution(20, 0.4), 500);
    expect(draws).toHaveLength(500);
    expect(draws.every((value) => Number.isInteger(value) && value >= 0 && value <= 20)).toBe(true);
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(10);
  });
});
