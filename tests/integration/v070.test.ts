import { describe, expect, it } from "vitest";
import { createDataset, useSampleDataset } from "../../src/index.js";
import { ValidationError } from "../../src/errors/index.js";

const DATA = createDataset([
  { x: 2.5, y: 10, group: "a" },
  { x: 3.7, y: 12, group: "a" },
  { x: 1.2, y: 8, group: "b" },
  { x: 8.9, y: 25, group: "b" },
  { x: 4.4, y: 15, group: "a" },
  { x: 5.1, y: 17, group: "b" },
  { x: 6.3, y: 20, group: "a" },
]);

describe("Dataset.covariance / correlation", () => {
  it("matches the numpy reference through the Dataset API", () => {
    expect(DATA.covariance("x", "y")).toBeCloseTo(14.92142857142857, 10);
    expect(DATA.correlation("x", "y").r).toBeCloseTo(0.9929781975657453, 10);
    expect(DATA.rankCorrelation("x", "y").r).toBeCloseTo(1, 10);
  });

  it("rejects a non-numeric column by name", () => {
    expect(() => DATA.correlation("x", "group")).toThrow(ValidationError);
    expect(() => DATA.correlation("x", "group")).toThrow(/needs a numeric column.*"group" is string/);
  });

  it("rejects an unknown column", () => {
    expect(() => DATA.covariance("x", "nope")).toThrow(/Unknown column/);
  });

  it("accepts integer columns, which are a separate dtype from number", () => {
    // Regression: an earlier guard compared against "number" and rejected every integer
    // column, which is most real-world data.
    const integers = createDataset([
      { a: 1, b: 2 },
      { a: 2, b: 4 },
      { a: 3, b: 6 },
    ]);
    expect(integers.schema["a"]?.type).toBe("integer");
    expect(integers.correlation("a", "b").r).toBeCloseTo(1, 12);
    expect(integers.correlationMatrix().columns).toEqual(["a", "b"]);
    expect(integers.zScores("a").reason).toBeNull();
    expect(integers.outliers("a").reason).toBeNull();
    expect(integers.fiveNumberSummary("a").count).toBe(3);
    expect(integers.withZScores("a").columns).toContain("a_z");
  });
});

describe("Dataset.correlationMatrix", () => {
  it("defaults to every numeric column, in dataset order", () => {
    const matrix = DATA.correlationMatrix();
    expect(matrix.columns).toEqual(["x", "y"]);
    expect(matrix.matrix[0]![1]).toBeCloseTo(0.9929781975657453, 10);
  });

  it("accepts an explicit subset and order", () => {
    const matrix = DATA.correlationMatrix(["y", "x"]);
    expect(matrix.columns).toEqual(["y", "x"]);
    expect(matrix.matrix[0]![1]).toBeCloseTo(0.9929781975657453, 10);
  });

  it("supports Spearman", () => {
    expect(DATA.correlationMatrix(undefined, "spearman").method).toBe("spearman");
  });

  it("throws when there are no numeric columns", () => {
    const textOnly = createDataset([{ a: "one" }, { a: "two" }]);
    expect(() => textOnly.correlationMatrix()).toThrow(/no numeric columns/);
  });
});

describe("Dataset.zScores / withZScores", () => {
  it("returns aligned scores", () => {
    const scores = DATA.zScores("x");
    expect(scores.values).toHaveLength(7);
    expect(scores.reason).toBeNull();
  });

  it("adds a score column without mutating the source", () => {
    const scored = DATA.withZScores("x");
    expect(scored.columns).toEqual([...DATA.columns, "x_z"]);
    expect(DATA.columns).toEqual(["x", "y", "group"]);
    expect(scored.data[0]?.["x_z"]).toBeCloseTo(-0.8239300393686283, 10);
  });

  it("accepts a custom column name", () => {
    expect(DATA.withZScores("x", "x_standardized").columns).toContain("x_standardized");
  });

  it("adds an all-null column for a constant source", () => {
    const constant = createDataset([{ k: 5 }, { k: 5 }, { k: 5 }]);
    const scored = constant.withZScores("k");
    expect(scored.data.map((row) => row["k_z"])).toEqual([null, null, null]);
  });

  it("rejects a name that already exists", () => {
    expect(() => DATA.withZScores("x", "y")).toThrow(/cannot overwrite/);
  });

  it("keeps rows in the original order", () => {
    const scored = DATA.withZScores("x");
    expect(scored.data.map((row) => row["x"])).toEqual(DATA.data.map((row) => row["x"]));
  });
});

describe("Dataset distribution statistics", () => {
  it("reports skewness and kurtosis", () => {
    expect(DATA.skewness("x")).toBeCloseTo(0.530641991571983, 10);
    expect(DATA.kurtosis("x")).toBeCloseTo(0.35149795007035234, 10);
  });

  it("reports a five-number summary", () => {
    const summary = DATA.fiveNumberSummary("x");
    expect(summary).toMatchObject({ min: 1.2, max: 8.9, count: 7 });
  });

  it("reports percentile rank", () => {
    expect(DATA.percentileRank("x", 8.9)).toBe(100);
    expect(DATA.percentileRank("x", 0)).toBe(0);
  });

  it("reports outliers by IQR", () => {
    const spiky = createDataset([1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((v) => ({ v })));
    expect(spiky.outliers("v").outliers).toHaveLength(1);
  });
});

describe("advanced statistics on the bundled sample", () => {
  it("correlates quantity and revenue without claiming significance", async () => {
    const sales = await useSampleDataset();
    const result = sales.correlation("quantity", "revenue");
    expect(result.r).not.toBeNull();
    // The result type carries no p-value or significance flag, by design.
    expect(Object.keys(result).sort()).toEqual(["n", "r", "reason"]);
  });

  it("produces a symmetric matrix over the numeric columns", async () => {
    const sales = await useSampleDataset();
    const matrix = sales.correlationMatrix();
    expect(matrix.columns).toEqual(["quantity", "revenue"]);
    for (let row = 0; row < matrix.columns.length; row += 1) {
      for (let column = 0; column < matrix.columns.length; column += 1) {
        expect(matrix.matrix[row]![column]).toBe(matrix.matrix[column]![row]);
      }
    }
  });

  it("finds no outliers in quantity, which is bounded by construction", async () => {
    const sales = await useSampleDataset();
    const result = sales.outliers("quantity");
    expect(result.reason).toBeNull();
    expect(result.outliers).toHaveLength(0);
  });
});
