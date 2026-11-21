import { describe, expect, it } from "vitest";
import {
  correlationMatrix,
  covariance,
  detectOutliers,
  fiveNumberSummary,
  kurtosis,
  normalize,
  pearsonCorrelation,
  percentileRank,
  skewness,
  spearmanCorrelation,
  standardize,
  zScores,
} from "../../src/analytics/advanced.js";

/**
 * Reference fixture.
 *
 * Every expected value in this file was produced by scipy/numpy, not by hand, so a test
 * failing means the implementation drifted from the reference rather than from a
 * transcription mistake:
 *
 *   np.cov(x, y, ddof=1)[0,1]            -> 14.92142857142857
 *   np.cov(x, y, ddof=0)[0,1]            -> 12.789795918367346
 *   np.corrcoef(x, y)[0,1]               -> 0.9929781975657453
 *   scipy.stats.spearmanr(x, y)          -> 1.0
 *   scipy.stats.skew(x, bias=False)      -> 0.530641991571983
 *   scipy.stats.kurtosis(x, bias=False)  -> 0.35149795007035234
 */
const X = [2.5, 3.7, 1.2, 8.9, 4.4, 5.1, 6.3];
const Y = [10, 12, 8, 25, 15, 17, 20];

describe("covariance", () => {
  it("matches numpy for the sample and population forms", () => {
    expect(covariance(X, Y)).toBeCloseTo(14.92142857142857, 10);
    expect(covariance(X, Y, { ddof: 0 })).toBeCloseTo(12.789795918367346, 10);
  });

  it("is symmetric", () => {
    expect(covariance(X, Y)).toBeCloseTo(covariance(Y, X) as number, 12);
  });

  it("uses only rows where both values are present", () => {
    // The second row is dropped entirely; neither column is imputed.
    const left = [1, null, 3, 5];
    const right = [2, 100, 6, 10];
    expect(covariance(left, right)).toBeCloseTo(covariance([1, 3, 5], [2, 6, 10]) as number, 12);
  });

  it("returns null when there are too few complete pairs", () => {
    expect(covariance([1], [2])).toBeNull();
    expect(covariance([], [])).toBeNull();
    // ddof of 1 needs two pairs; one pair leaves a zero divisor.
    expect(covariance([1, null], [2, 3])).toBeNull();
  });

  it("rejects a negative or fractional ddof", () => {
    expect(() => covariance(X, Y, { ddof: -1 })).toThrow(RangeError);
    expect(() => covariance(X, Y, { ddof: 0.5 })).toThrow(RangeError);
  });
});

describe("pearsonCorrelation", () => {
  it("matches numpy", () => {
    const result = pearsonCorrelation(X, Y);
    expect(result.r).toBeCloseTo(0.9929781975657453, 10);
    expect(result.n).toBe(7);
    expect(result.reason).toBeNull();
  });

  it("is exactly 1 and -1 for a perfect linear relationship", () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6]).r).toBeCloseTo(1, 12);
    expect(pearsonCorrelation([1, 2, 3], [-2, -4, -6]).r).toBeCloseTo(-1, 12);
  });

  it("never overshoots [-1, 1] from floating point error", () => {
    const r = pearsonCorrelation([0.1, 0.2, 0.3], [0.2, 0.4, 0.6]).r as number;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });

  it("reports zero-variance rather than NaN for a constant column", () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toEqual({
      r: null,
      n: 3,
      reason: "zero-variance",
    });
  });

  it("reports insufficient-data below two pairs", () => {
    expect(pearsonCorrelation([1], [2])).toEqual({ r: null, n: 1, reason: "insufficient-data" });
    expect(pearsonCorrelation([], [])).toEqual({ r: null, n: 0, reason: "insufficient-data" });
  });

  it("uses pairwise-complete rows and reports that n", () => {
    const result = pearsonCorrelation([1, null, 3, 4], [2, 99, 6, 8]);
    expect(result.n).toBe(3);
    expect(result.r).toBeCloseTo(1, 12);
  });

  it("is zero for an uncorrelated symmetric arrangement", () => {
    expect(pearsonCorrelation([-2, -1, 1, 2], [1, -1, -1, 1]).r).toBeCloseTo(0, 12);
  });
});

describe("spearmanCorrelation", () => {
  it("matches scipy on a monotonic relationship", () => {
    expect(spearmanCorrelation(X, Y).r).toBeCloseTo(1, 10);
  });

  it("matches scipy when ties require average ranks", () => {
    // scipy.stats.spearmanr([1,2,2,3,4,4,4,5], [2,1,3,3,5,4,6,7]) -> 0.9200335844703181
    const left = [1, 2, 2, 3, 4, 4, 4, 5];
    const right = [2, 1, 3, 3, 5, 4, 6, 7];
    expect(spearmanCorrelation(left, right).r).toBeCloseTo(0.9200335844703181, 10);
  });

  it("captures a monotonic relationship that Pearson misses", () => {
    // y = x^3 is monotonic but not linear; Pearson is high yet Spearman is exactly 1.
    const left = [1, 2, 3, 4, 5];
    const right = left.map((value) => value ** 3);
    expect(spearmanCorrelation(left, right).r).toBeCloseTo(1, 12);
    expect(pearsonCorrelation(left, right).r as number).toBeLessThan(0.99);
  });

  it("is robust to an extreme outlier in a way Pearson is not", () => {
    const left = [1, 2, 3, 4, 5];
    const right = [1, 2, 3, 4, 1000];
    expect(spearmanCorrelation(left, right).r).toBeCloseTo(1, 12);
    expect(pearsonCorrelation(left, right).r as number).toBeLessThan(0.8);
  });

  it("reports zero-variance for a constant column", () => {
    expect(spearmanCorrelation([7, 7, 7], [1, 2, 3]).reason).toBe("zero-variance");
  });
});

describe("correlationMatrix", () => {
  const matrix = correlationMatrix({
    columns: [
      { name: "x", values: X },
      { name: "y", values: Y },
    ],
  });

  it("puts 1 on the diagonal and the coefficient off it", () => {
    expect(matrix.matrix[0]![0]).toBe(1);
    expect(matrix.matrix[1]![1]).toBe(1);
    expect(matrix.matrix[0]![1]).toBeCloseTo(0.9929781975657453, 10);
  });

  it("is symmetric", () => {
    expect(matrix.matrix[1]![0]).toBe(matrix.matrix[0]![1]);
  });

  it("records every off-diagonal cell once, with its n", () => {
    expect(matrix.cells).toHaveLength(1);
    expect(matrix.cells[0]).toMatchObject({ x: "x", y: "y", n: 7, reason: null });
  });

  it("looks a coefficient up in either direction", () => {
    expect(matrix.get("x", "y").r).toBeCloseTo(matrix.get("y", "x").r as number, 12);
  });

  it("supports Spearman", () => {
    const ranked = correlationMatrix({
      columns: [
        { name: "x", values: X },
        { name: "y", values: Y },
      ],
      method: "spearman",
    });
    expect(ranked.method).toBe("spearman");
    expect(ranked.matrix[0]![1]).toBeCloseTo(1, 10);
  });

  it("keeps the diagonal at 1 for a constant column but nulls the off-diagonal", () => {
    const withConstant = correlationMatrix({
      columns: [
        { name: "k", values: [4, 4, 4] },
        { name: "v", values: [1, 2, 3] },
      ],
    });
    expect(withConstant.matrix[0]![0]).toBe(1);
    expect(withConstant.matrix[0]![1]).toBeNull();
  });

  it("rejects an unknown column, duplicate names, and a bad method", () => {
    expect(() => matrix.get("x", "nope")).toThrow(/Unknown column/);
    expect(() =>
      correlationMatrix({
        columns: [
          { name: "a", values: [1] },
          { name: "a", values: [2] },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() => correlationMatrix({ columns: [{ name: "a", values: [1] }], method: "kendall" as never })).toThrow(
      /pearson/,
    );
    expect(() => correlationMatrix({ columns: [] })).toThrow(/at least one column/);
  });
});

describe("zScores", () => {
  it("centres on zero and scales to unit sample deviation", () => {
    const result = zScores(X);
    expect(result.mean).toBeCloseTo(4.585714285714286, 10);
    expect(result.std).toBeCloseTo(2.531421584425486, 10);
    expect(result.reason).toBeNull();

    const scores = result.values as number[];
    const mean = scores.reduce((total, value) => total + value, 0) / scores.length;
    expect(mean).toBeCloseTo(0, 12);
  });

  it("uses the population deviation when ddof is 0", () => {
    // The population deviation divides by the larger n, so it is *smaller* and every
    // z-score is correspondingly larger in magnitude.
    const sample = zScores(X).values as number[];
    const population = zScores(X, { ddof: 0 }).values as number[];
    expect(Math.abs(sample[0] as number)).toBeCloseTo(0.8239300393686283, 10);
    expect(Math.abs(population[0] as number)).toBeCloseTo(0.8899461564628434, 10);
  });

  it("keeps the output aligned with the input, nulling missing cells", () => {
    const result = zScores([1, null, 3]);
    expect(result.values).toHaveLength(3);
    expect(result.values[1]).toBeNull();
    expect(result.values[0]).toBeCloseTo(-0.7071067811865475, 10);
  });

  it("reports zero-variance for a constant column instead of dividing by zero", () => {
    const result = zScores([2, 2, 2]);
    expect(result.reason).toBe("zero-variance");
    expect(result.values).toEqual([null, null, null]);
  });

  it("reports insufficient-data for an empty column", () => {
    expect(zScores([]).reason).toBe("insufficient-data");
  });

  it("returns all nulls for a single value with the sample formula", () => {
    expect(zScores([5]).values).toEqual([null]);
  });
});

describe("percentileRank", () => {
  it("counts the percentage at or below a value, matching scipy's weak definition", () => {
    // scipy.stats.percentileofscore([1,2,2,3], 2, kind="weak") -> 75
    expect(percentileRank([1, 2, 2, 3], 2)).toBe(75);
    expect(percentileRank([1, 2, 2, 3], 3)).toBe(100);
    expect(percentileRank([1, 2, 2, 3], 1)).toBe(25);
  });

  it("gives ties the highest rank they reach", () => {
    expect(percentileRank([5, 5, 5], 5)).toBe(100);
  });

  it("returns 0 for a value below everything", () => {
    expect(percentileRank([10, 20], 5)).toBe(0);
  });

  it("returns null for no values or a non-finite value", () => {
    expect(percentileRank([], 1)).toBeNull();
    expect(percentileRank([1, 2], Number.NaN)).toBeNull();
    expect(percentileRank([1, 2], Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("ignores missing cells", () => {
    expect(percentileRank([1, null, 2, 3], 2)).toBeCloseTo((2 / 3) * 100, 12);
  });
});

describe("skewness", () => {
  it("matches scipy's bias=False (adjusted Fisher-Pearson)", () => {
    expect(skewness(X)).toBeCloseTo(0.530641991571983, 10);
  });

  it("is zero for a symmetric sample", () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 12);
  });

  it("is positive for a right tail and negative for a left tail", () => {
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(0);
    expect(skewness([-10, 1, 1, 1, 1])).toBeLessThan(0);
  });

  it("returns null below three values", () => {
    expect(skewness([1, 2])).toBeNull();
    expect(skewness([])).toBeNull();
  });

  it("returns null for zero variance", () => {
    expect(skewness([3, 3, 3, 3])).toBeNull();
  });
});

describe("kurtosis", () => {
  it("matches scipy's bias=False excess kurtosis", () => {
    expect(kurtosis(X)).toBeCloseTo(0.35149795007035234, 10);
  });

  it("is near zero for a roughly normal-looking sample", () => {
    const normalish = [-1.5, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 1.5];
    expect(Math.abs(kurtosis(normalish) as number)).toBeLessThan(1);
  });

  it("is positive for a heavy-tailed sample", () => {
    expect(kurtosis([0, 0, 0, 0, 0, 0, 0, 0, 0, 100])).toBeGreaterThan(3);
  });

  it("returns null below four values", () => {
    expect(kurtosis([1, 2, 3])).toBeNull();
  });

  it("returns null for zero variance", () => {
    expect(kurtosis([2, 2, 2, 2])).toBeNull();
  });
});

describe("fiveNumberSummary", () => {
  it("reports the five numbers, the mean, and the count", () => {
    const summary = fiveNumberSummary(X);
    expect(summary.min).toBe(1.2);
    expect(summary.q1).toBeCloseTo(3.1, 10);
    expect(summary.median).toBeCloseTo(4.4, 10);
    expect(summary.q3).toBeCloseTo(5.7, 10);
    expect(summary.max).toBe(8.9);
    expect(summary.mean).toBeCloseTo(4.585714285714286, 10);
    expect(summary.count).toBe(7);
  });

  it("agrees with describe()'s quartiles", () => {
    const summary = fiveNumberSummary([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(summary.q1).toBe(4);
    expect(summary.median).toBe(4.5);
    expect(summary.q3).toBe(5.5);
  });

  it("collapses to the value for a single observation", () => {
    const summary = fiveNumberSummary([7]);
    expect(summary).toMatchObject({ min: 7, q1: 7, median: 7, q3: 7, max: 7, count: 1 });
  });

  it("returns nulls for an empty column", () => {
    expect(fiveNumberSummary([])).toEqual({
      min: null,
      q1: null,
      median: null,
      q3: null,
      max: null,
      mean: null,
      count: 0,
    });
  });

  it("does not overflow on a large sample", () => {
    const many = Array.from({ length: 100_000 }, (_, index) => index);
    const summary = fiveNumberSummary(many);
    expect(summary.max).toBe(99_999);
    expect(summary.median).toBeCloseTo(49_999.5, 6);
  });
});

describe("detectOutliers", () => {
  it("finds a high outlier by IQR fences", () => {
    const result = detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(result.method).toBe("iqr");
    expect(result.outliers).toHaveLength(1);
    expect(result.outliers[0]).toMatchObject({ index: 9, value: 100, side: "high" });
    expect(result.fences?.upper).toBeCloseTo(14.5, 10);
  });

  it("finds a low outlier", () => {
    const result = detectOutliers([-100, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.outliers[0]).toMatchObject({ value: -100, side: "low" });
  });

  it("finds nothing in a tight, evenly spread sample", () => {
    expect(detectOutliers([10, 11, 12, 13, 14]).outliers).toHaveLength(0);
  });

  it("flags nothing at threshold 3 that it flags at 1.5", () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20];
    expect(detectOutliers(sample, { threshold: 1.5 }).outliers.length).toBeGreaterThanOrEqual(
      detectOutliers(sample, { threshold: 3 }).outliers.length,
    );
  });

  it("uses z-scores when asked, with the score attached", () => {
    // Twenty baseline points are needed: with only nine, the single outlier inflates the
    // standard deviation enough that its own z-score stays under 3.
    const sample = [...new Array<number>(20).fill(0), 100];
    const result = detectOutliers(sample, { method: "zscore" });
    expect(result.outliers).toHaveLength(1);
    expect(result.outliers[0]?.zScore).toBeCloseTo(4.364357804719847, 10);
    expect(result.outliers[0]?.index).toBe(20);
  });

  it("misses an outlier that inflates the standard deviation past the threshold", () => {
    // Correct behaviour, and worth pinning: z of 100 here is 2.836, under the default 3.
    // IQR finds it, z-score does not. This is why IQR is the default.
    expect(detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]).outliers).toHaveLength(1);
    expect(detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { method: "zscore" }).outliers).toHaveLength(0);
  });

  it("refuses when the IQR is zero rather than flagging everything", () => {
    const result = detectOutliers([1, 1, 1, 1, 1, 50]);
    expect(result.reason).toBe("zero-variance");
    expect(result.outliers).toHaveLength(0);
  });

  it("reports insufficient-data for an empty column", () => {
    expect(detectOutliers([]).reason).toBe("insufficient-data");
  });

  it("reports insufficient-data for z-scores of a constant column", () => {
    expect(detectOutliers([4, 4, 4], { method: "zscore" }).reason).toBe("zero-variance");
  });

  it("keeps original indices despite missing cells", () => {
    const result = detectOutliers([1, null, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(result.outliers[0]?.index).toBe(10);
    expect(result.considered).toBe(10);
  });

  it("rejects a bad method or threshold", () => {
    expect(() => detectOutliers([1, 2], { method: "mad" as never })).toThrow(/iqr/);
    expect(() => detectOutliers([1, 2], { threshold: 0 })).toThrow(RangeError);
    expect(() => detectOutliers([1, 2], { threshold: -1 })).toThrow(RangeError);
  });
});

describe("normalize", () => {
  it("maps the observed range onto [0, 1] by default", () => {
    expect(normalize([1, 2, 3])).toEqual([0, 0.5, 1]);
  });

  it("honours a custom target range", () => {
    expect(normalize([0, 5, 10], { min: -1, max: 1 })).toEqual([-1, 0, 1]);
  });

  it("keeps nulls aligned", () => {
    expect(normalize([1, null, 3])).toEqual([0, null, 1]);
  });

  it("returns all nulls for a constant column", () => {
    expect(normalize([5, 5, 5])).toEqual([null, null, null]);
  });

  it("divides by the largest absolute value under maxabs", () => {
    expect(normalize([-2, 1, 2], { method: "maxabs" })).toEqual([-1, 0.5, 1]);
  });

  it("returns all nulls for an all-zero column under maxabs", () => {
    expect(normalize([0, 0], { method: "maxabs" })).toEqual([null, null]);
  });

  it("returns an empty array for empty input", () => {
    expect(normalize([])).toEqual([]);
  });

  it("rejects a bad method, equal bounds, and non-finite bounds", () => {
    expect(() => normalize([1], { method: "log" as never })).toThrow(/minmax/);
    expect(() => normalize([1], { min: 1, max: 1 })).toThrow(RangeError);
    expect(() => normalize([1], { min: 0, max: Number.NaN })).toThrow(RangeError);
  });

  it("is sensitive to a single extreme value, which is a property of the transform", () => {
    // The outlier squashes everything else toward zero; documented, not a defect.
    const values = normalize([1, 2, 3, 100]);
    expect(values[2] as number).toBeLessThan(0.03);
  });
});

describe("standardize", () => {
  it("is zScores under its other name", () => {
    expect(standardize([1, 2, 3])).toEqual(zScores([1, 2, 3]).values);
  });

  it("produces a mean of zero and unit deviation", () => {
    const values = standardize([2, 4, 4, 4, 5, 5, 7, 9]) as number[];
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    expect(mean).toBeCloseTo(0, 12);
  });
});
