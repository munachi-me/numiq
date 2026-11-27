import { describe, it, expect } from "vitest";
import {
  chiSquareTest,
  jarqueBeraTest,
  meanConfidenceInterval,
  oneSampleTTest,
  oneWayAnova,
  pairedTTest,
  twoSampleTTest,
} from "../../src/analytics/tests.js";
import { createDataset } from "../../src/core/dataset.js";

/**
 * Reference p-values are from published t/chi-square/F tables or computed independently.
 * Every test asserts the numeric outputs, not just the prose interpretation.
 */
describe("oneSampleTTest", () => {
  it("matches a textbook one-sample t-test", () => {
    // mean 5.2, sd ~1.3038, n=5 -> t = (5.2 - 3) / (1.3038/sqrt(5)) ~= 3.7749
    const values = [4, 5, 6, 5, 6];
    const result = oneSampleTTest(values, { mu: 3 });
    const mean = 5.2;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 4;
    const expectedT = (mean - 3) / Math.sqrt(variance / 5);
    expect(result.statistic).toBeCloseTo(expectedT, 10);
    expect(result.df).toBe(4);
    expect(result.n).toBe(5);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(1);
  });

  it("gives p = 1 when the mean equals mu", () => {
    const result = oneSampleTTest([1, 2, 3, 4, 5], { mu: 3 });
    expect(result.statistic).toBeCloseTo(0, 12);
    expect(result.pValue).toBeCloseTo(1, 6);
    expect(result.significant).toBe(false);
  });

  it("honours a one-sided alternative", () => {
    const greater = oneSampleTTest([10, 11, 12, 13, 14], { mu: 0, alternative: "greater" });
    const less = oneSampleTTest([10, 11, 12, 13, 14], { mu: 0, alternative: "less" });
    expect(greater.pValue).toBeLessThan(0.001);
    expect(less.pValue).toBeGreaterThan(0.999);
  });

  it("halves the p-value for a one-sided test relative to two-sided", () => {
    const two = oneSampleTTest([10, 11, 12, 13, 14], { mu: 8 });
    const one = oneSampleTTest([10, 11, 12, 13, 14], { mu: 8, alternative: "greater" });
    expect(one.pValue).toBeCloseTo(two.pValue / 2, 8);
  });

  it("reports NaN rather than throwing on too few values", () => {
    const result = oneSampleTTest([5]);
    expect(Number.isNaN(result.pValue)).toBe(true);
    expect(result.significant).toBe(false);
    expect(result.interpretation).toMatch(/at least 2/);
  });

  it("reports NaN for a zero-variance sample", () => {
    const result = oneSampleTTest([7, 7, 7, 7]);
    expect(Number.isNaN(result.statistic)).toBe(true);
    expect(result.interpretation).toMatch(/identical|zero/);
  });

  it("excludes missing and non-numeric values", () => {
    const withGaps = oneSampleTTest([10, null, 12, undefined, "x", 14]);
    const clean = oneSampleTTest([10, 12, 14]);
    expect(withGaps.n).toBe(3);
    expect(withGaps.statistic).toBeCloseTo(clean.statistic, 12);
  });

  it("carries the hypotheses in words", () => {
    const result = oneSampleTTest([1, 2, 3], { mu: 2 });
    expect(result.nullHypothesis).toMatch(/equals 2/);
    expect(result.alternativeHypothesis).toMatch(/not 2/);
    expect(result.alpha).toBe(0.05);
  });

  it("rejects an invalid alpha", () => {
    expect(() => oneSampleTTest([1, 2, 3], { alpha: 0 })).toThrow(/alpha/);
    expect(() => oneSampleTTest([1, 2, 3], { alpha: 1.5 })).toThrow(/alpha/);
  });
});

describe("twoSampleTTest", () => {
  it("matches a hand-computed Welch test", () => {
    const a = [20, 22, 19, 24, 21];
    const b = [28, 30, 27, 26, 29];
    const result = twoSampleTTest(a, b);
    const meanA = 21.2;
    const meanB = 28;
    const varA = a.reduce((sum, v) => sum + (v - meanA) ** 2, 0) / 4;
    const varB = b.reduce((sum, v) => sum + (v - meanB) ** 2, 0) / 4;
    const se = Math.sqrt(varA / 5 + varB / 5);
    expect(result.statistic).toBeCloseTo((meanA - meanB) / se, 10);
    expect(result.n).toBe(10);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significant).toBe(true);
  });

  it("reports the Welch degrees of freedom, which are not integers", () => {
    const result = twoSampleTTest([1, 2, 3, 4, 5], [10, 20, 30]);
    expect(result.df).not.toBeNull();
    expect(result.df as number).toBeGreaterThan(0);
  });

  it("pooled and Welch agree when variances are equal", () => {
    const a = [10, 12, 14, 16, 18];
    const b = [20, 22, 24, 26, 28];
    const welch = twoSampleTTest(a, b);
    const pooled = twoSampleTTest(a, b, { pooled: true });
    // Same variances, same n, so the standard errors coincide and only df differs.
    expect(pooled.statistic).toBeCloseTo(welch.statistic, 8);
    expect(pooled.df).toBe(8);
  });

  it("names the pooled form in its result", () => {
    expect(twoSampleTTest([1, 2, 3], [4, 5, 6], { pooled: true }).test).toMatch(/pooled/);
    expect(twoSampleTTest([1, 2, 3], [4, 5, 6]).test).toMatch(/Welch/);
  });

  it("reports NaN for a group with fewer than two values", () => {
    const result = twoSampleTTest([1, 2, 3], [5]);
    expect(Number.isNaN(result.pValue)).toBe(true);
    expect(result.interpretation).toMatch(/at least 2/);
  });

  it("reports NaN when both groups have zero variance", () => {
    const result = twoSampleTTest([5, 5, 5], [7, 7, 7]);
    expect(Number.isNaN(result.statistic)).toBe(true);
  });
});

describe("pairedTTest", () => {
  it("tests the mean difference", () => {
    // Differences all +2, but with variation: 2,2,2,2 would be zero variance.
    const before = [10, 12, 14, 16, 18];
    const after = [8, 9, 13, 13, 17];
    const result = pairedTTest(before, after);
    const diffs = [2, 3, 1, 3, 1];
    const meanDiff = 2;
    const varDiff = diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / 4;
    expect(result.statistic).toBeCloseTo(meanDiff / Math.sqrt(varDiff / 5), 8);
    expect(result.df).toBe(4);
  });

  it("uses only complete pairs", () => {
    const result = pairedTTest([1, 2, null, 4], [2, 3, 4, null]);
    expect(result.details.pairs).toBe(2);
  });

  it("reports the paired hypotheses", () => {
    const result = pairedTTest([1, 2, 3], [2, 3, 4]);
    expect(result.test).toBe("paired t");
    expect(result.nullHypothesis).toMatch(/difference within pairs is zero/);
  });
});

describe("chiSquareTest", () => {
  it("matches a hand-computed 2x2 test", () => {
    // Classic table: 20/30, 30/20
    const result = chiSquareTest([
      [20, 30],
      [30, 20],
    ]);
    // Expected all 25; chi-square = 4 * (25/25) = 4
    expect(result.statistic).toBeCloseTo(4, 10);
    expect(result.df).toBe(1);
    expect(result.pValue).toBeCloseTo(0.0455, 3);
    expect(result.significant).toBe(true);
  });

  it("gives chi-square zero for a perfectly independent table", () => {
    const result = chiSquareTest([
      [10, 10],
      [10, 10],
    ]);
    expect(result.statistic).toBeCloseTo(0, 12);
    expect(result.pValue).toBeCloseTo(1, 6);
  });

  it("computes degrees of freedom as (r-1)(c-1)", () => {
    const result = chiSquareTest([
      [10, 20, 30],
      [15, 25, 20],
    ]);
    expect(result.df).toBe(2);
  });

  it("reports Cramér's V", () => {
    const result = chiSquareTest([
      [20, 30],
      [30, 20],
    ]);
    // V = sqrt(chi2 / (n * min(r-1, c-1))) = sqrt(4/100) = 0.2
    expect(result.details.cramersV).toBeCloseTo(0.2, 10);
  });

  it("counts cells with a small expected count", () => {
    const result = chiSquareTest([
      [1, 100],
      [100, 1],
    ]);
    expect(result.details.cellsWithExpectedBelow5).toBe(0);
  });

  it("rejects malformed tables", () => {
    expect(() => chiSquareTest([[1, 2]])).toThrow(/at least 2 rows/);
    expect(() => chiSquareTest([[1], [2]])).toThrow(/at least 2 columns/);
    expect(() => chiSquareTest([[1, 2], [3]])).toThrow(/same number of columns/);
    expect(() =>
      chiSquareTest([
        [-1, 2],
        [3, 4],
      ]),
    ).toThrow(/non-negative/);
    expect(() =>
      chiSquareTest([
        [0, 0],
        [0, 0],
      ]),
    ).toThrow(/all zero/);
  });
});

describe("oneWayAnova", () => {
  it("matches a hand-computed one-way ANOVA", () => {
    // Groups: A=[1,2,3], B=[4,5,6], C=[7,8,9]
    // Grand mean 5; between SS = 3*((2-5)^2+(5-5)^2+(8-5)^2) = 54; within SS = 6
    const result = oneWayAnova([
      { name: "A", values: [1, 2, 3] },
      { name: "B", values: [4, 5, 6] },
      { name: "C", values: [7, 8, 9] },
    ]);
    expect(result.statistic).toBeCloseTo(54 / 2 / (6 / 6), 10);
    expect(result.statistic).toBeCloseTo(27, 10);
    expect(result.df).toBe(2);
    expect(result.df2).toBe(6);
    expect(result.significant).toBe(true);
    expect(result.details.etaSquared).toBeCloseTo(54 / 60, 10);
  });

  it("gives F near zero when group means coincide", () => {
    const result = oneWayAnova([
      { name: "A", values: [1, 2, 3, 4] },
      { name: "B", values: [1, 2, 3, 4] },
    ]);
    expect(result.statistic).toBeCloseTo(0, 10);
    expect(result.significant).toBe(false);
  });

  it("reports each group mean in details", () => {
    const result = oneWayAnova([
      { name: "A", values: [2, 4] },
      { name: "B", values: [6, 8] },
    ]);
    expect(result.details.mean_A).toBeCloseTo(3, 10);
    expect(result.details.mean_B).toBeCloseTo(7, 10);
    expect(result.details.n_A).toBe(2);
  });

  it("rejects fewer than two groups or an empty group", () => {
    expect(() => oneWayAnova([{ name: "A", values: [1, 2] }])).toThrow(/at least 2 groups/);
    expect(() =>
      oneWayAnova([
        { name: "A", values: [1, 2] },
        { name: "B", values: [] },
      ]),
    ).toThrow(/no usable values/);
  });
});

describe("jarqueBeraTest", () => {
  it("does not reject normality for roughly symmetric data", () => {
    const symmetric = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, -1.5, 1.5, -2.5, 2.5, 0.2, -0.2, 0.8, -0.8, 1.2, -1.2, 0.1];
    const result = jarqueBeraTest(symmetric);
    expect(result.pValue).toBeGreaterThan(0.05);
    expect(result.significant).toBe(false);
  });

  it("rejects normality for strongly skewed data", () => {
    const skewed = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
    const result = jarqueBeraTest(skewed);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significant).toBe(true);
    expect(result.details.skewness as number).toBeGreaterThan(3);
  });

  it("reports the statistic and its two degrees of freedom", () => {
    const result = jarqueBeraTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.df).toBe(2);
    expect(result.statistic).toBeGreaterThanOrEqual(0);
  });

  it("reports NaN for too few values or zero variance", () => {
    expect(Number.isNaN(jarqueBeraTest([1, 2, 3]).pValue)).toBe(true);
    expect(Number.isNaN(jarqueBeraTest([5, 5, 5, 5, 5]).pValue)).toBe(true);
  });
});

describe("meanConfidenceInterval", () => {
  it("brackets the mean with the t critical value", () => {
    const values = [10, 12, 14, 16, 18];
    const interval = meanConfidenceInterval(values);
    expect(interval.mean).toBeCloseTo(14, 10);
    expect(interval.lower).toBeLessThan(14);
    expect(interval.upper).toBeGreaterThan(14);
    // 95% interval with 4 df uses t = 2.776.
    const se = Math.sqrt(values.reduce((sum, v) => sum + (v - 14) ** 2, 0) / 4 / 5);
    expect(interval.upper - 14).toBeCloseTo(2.7764451051977934 * se, 4);
    expect(interval.df).toBe(4);
  });

  it("narrows as the confidence level drops", () => {
    const values = [10, 12, 14, 16, 18, 20, 22];
    const wide = meanConfidenceInterval(values, { confidence: 0.99 });
    const narrow = meanConfidenceInterval(values, { confidence: 0.9 });
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower);
  });

  it("validates the level and sample size", () => {
    expect(() => meanConfidenceInterval([1, 2], { confidence: 1.5 })).toThrow(/confidence/);
    expect(() => meanConfidenceInterval([1])).toThrow(/at least 2/);
  });
});

describe("Dataset hypothesis tests", () => {
  const rows = [
    { region: "north", sales: 20, prior: 18, segment: "a" },
    { region: "north", sales: 22, prior: 20, segment: "a" },
    { region: "north", sales: 19, prior: 17, segment: "b" },
    { region: "north", sales: 24, prior: 21, segment: "b" },
    { region: "south", sales: 30, prior: 28, segment: "a" },
    { region: "south", sales: 28, prior: 27, segment: "a" },
    { region: "south", sales: 32, prior: 30, segment: "b" },
    { region: "south", sales: 31, prior: 29, segment: "b" },
  ];

  it("tTest runs on a column", () => {
    const data = createDataset(rows);
    const result = data.tTest("sales", { mu: 25 });
    expect(result.n).toBe(8);
    expect(result.df).toBe(7);
  });

  it("tTestBetween splits by a group column", () => {
    const data = createDataset(rows);
    const result = data.tTestBetween("sales", "region");
    expect(result.details.n1).toBe(4);
    expect(result.details.n2).toBe(4);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("tTestBetween accepts explicit groups", () => {
    const data = createDataset(rows);
    const result = data.tTestBetween("sales", "region", ["south", "north"]);
    expect(result.details.mean1).toBeGreaterThan(result.details.mean2 as number);
  });

  it("tTestBetween rejects a single-level group column", () => {
    const data = createDataset([
      { g: "only", v: 1 },
      { g: "only", v: 2 },
    ]);
    expect(() => data.tTestBetween("v", "g")).toThrow(/at least two distinct/);
  });

  it("pairedTTest compares two columns row by row", () => {
    const data = createDataset(rows);
    const result = data.pairedTTest("sales", "prior");
    expect(result.details.pairs).toBe(8);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("chiSquare builds a contingency table from two columns", () => {
    const data = createDataset(rows);
    const result = data.chiSquare("region", "segment");
    expect(result.details.rows).toBe(2);
    expect(result.details.columns).toBe(2);
    expect(result.n).toBe(8);
  });

  it("chiSquare rejects the same column twice", () => {
    const data = createDataset(rows);
    expect(() => data.chiSquare("region", "region")).toThrow(/different columns/);
  });

  it("anova groups a numeric column by another", () => {
    const data = createDataset(rows);
    const result = data.anova("sales", "region");
    expect(result.details.groups).toBe(2);
    expect(result.significant).toBe(true);
  });

  it("anova rejects using the numeric column as its own group", () => {
    const data = createDataset(rows);
    expect(() => data.anova("sales", "sales")).toThrow(/different grouping/);
  });

  it("normalityTest runs on a numeric column", () => {
    const data = createDataset(rows);
    const result = data.normalityTest("sales");
    expect(result.n).toBe(8);
    expect(result.df).toBe(2);
  });

  it("meanConfidenceInterval brackets a column mean", () => {
    const data = createDataset(rows);
    const interval = data.meanConfidenceInterval("sales");
    expect(interval.lower).toBeLessThan(interval.mean);
    expect(interval.upper).toBeGreaterThan(interval.mean);
  });

  it("all tests reject a non-numeric column", () => {
    const data = createDataset(rows);
    expect(() => data.tTest("region")).toThrow(/numeric/);
    expect(() => data.normalityTest("region")).toThrow(/numeric/);
    expect(() => data.meanConfidenceInterval("region")).toThrow(/numeric/);
  });
});
