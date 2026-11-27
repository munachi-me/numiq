import { describe, it, expect } from "vitest";
import { linearRegression } from "../../src/analytics/regression.js";
import { createDataset } from "../../src/core/dataset.js";

/**
 * Expected coefficients are computed independently (by hand or with a separate OLS
 * calculation) rather than copied from a previous run of this code.
 */
describe("linearRegression", () => {
  it("recovers an exact line", () => {
    const model = linearRegression(
      [
        { x: 1, y: 5 },
        { x: 2, y: 7 },
        { x: 3, y: 9 },
        { x: 4, y: 11 },
      ],
      { target: "y", features: ["x"] },
    );
    expect(model.intercept).toBeCloseTo(3, 10);
    expect(model.coefficients.x).toBeCloseTo(2, 10);
    expect(model.rSquared).toBeCloseTo(1, 10);
    expect(model.n).toBe(4);
    expect(model.parameters).toBe(2);
    expect(model.rmse).toBeCloseTo(0, 10);
  });

  it("matches a hand-computed OLS fit", () => {
    // x = 1..5, y = 2,4,5,4,5
    // Sxy = 4, Sxx = 10 -> slope 0.6; intercept = mean(y) - 0.6*mean(x) = 4 - 1.8 = 2.2
    // SSE = 2.4, SST = 6 -> R² = 0.6
    const model = linearRegression(
      [1, 2, 3, 4, 5].map((x, index) => ({ x, y: [2, 4, 5, 4, 5][index] as number })),
      { target: "y", features: ["x"] },
    );
    expect(model.coefficients.x).toBeCloseTo(0.6, 12);
    expect(model.intercept).toBeCloseTo(2.2, 12);
    expect(model.rSquared).toBeCloseTo(0.6, 12);
    expect(model.mse).toBeCloseTo(2.4 / 3, 12);
    expect(model.rmse).toBeCloseTo(Math.sqrt(2.4 / 3), 12);
    expect(model.degreesOfFreedom).toBe(3);
  });

  it("adjusted R-squared penalises extra predictors", () => {
    const rows = [1, 2, 3, 4, 5].map((x, index) => ({ x, y: [2, 4, 5, 4, 5][index] as number }));
    const model = linearRegression(rows, { target: "y", features: ["x"] });
    // 1 - (1 - 0.6) * (4/3) = 1 - 0.5333... = 0.46666...
    expect(model.adjustedRSquared).toBeCloseTo(1 - (1 - 0.6) * (4 / 3), 12);
    expect(model.adjustedRSquared).toBeLessThan(model.rSquared);
  });

  it("fits multiple features exactly", () => {
    const rows = [
      { x1: 1, x2: 1 },
      { x1: 2, x2: 1 },
      { x1: 1, x2: 2 },
      { x1: 3, x2: 2 },
      { x1: 2, x2: 3 },
      { x1: 4, x2: 1 },
    ].map((row) => ({ ...row, y: 1 + 2 * row.x1 + 3 * row.x2 }));
    const model = linearRegression(rows, { target: "y", features: ["x1", "x2"] });
    expect(model.intercept).toBeCloseTo(1, 8);
    expect(model.coefficients.x1).toBeCloseTo(2, 8);
    expect(model.coefficients.x2).toBeCloseTo(3, 8);
    expect(model.rSquared).toBeCloseTo(1, 10);
    expect(model.parameters).toBe(3);
  });

  it("predicts new rows", () => {
    const model = linearRegression(
      [
        { x: 1, y: 3 },
        { x: 2, y: 5 },
        { x: 3, y: 7 },
        { x: 4, y: 9 },
      ],
      { target: "y", features: ["x"] },
    );
    expect(model.predict([{ x: 10 }])[0]).toBeCloseTo(21, 8);
    expect(model.predict([{ x: 0 }, { x: -1 }])).toHaveLength(2);
  });

  it("residuals and fitted values line up with the used rows", () => {
    const rows = [1, 2, 3, 4, 5].map((x, index) => ({ x, y: [2, 4, 5, 4, 5][index] as number }));
    const model = linearRegression(rows, { target: "y", features: ["x"] });
    const residuals = model.residuals();
    const fitted = model.fitted();
    expect(residuals).toHaveLength(5);
    expect(fitted).toHaveLength(5);
    for (let index = 0; index < rows.length; index += 1) {
      expect((rows[index] as { y: number }).y).toBeCloseTo(
        (fitted[index] as number) + (residuals[index] as number),
        10,
      );
    }
    // Residuals from OLS sum to zero when an intercept is present.
    expect(residuals.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 10);
  });

  it("drops rows listwise and reports n", () => {
    const model = linearRegression(
      [
        { x: 1, y: 2 },
        { x: null, y: 3 },
        { x: 3, y: null },
        { x: 4, y: 5 },
      ],
      { target: "y", features: ["x"] },
    );
    expect(model.n).toBe(2);
    expect(model.rowsUsed()).toHaveLength(2);
  });

  it("ignores non-finite values as missing", () => {
    const model = linearRegression(
      [
        { x: 1, y: 2 },
        { x: Number.POSITIVE_INFINITY, y: 3 },
        { x: 3, y: Number.NaN },
        { x: 4, y: 5 },
        { x: 5, y: 6 },
      ],
      { target: "y", features: ["x"] },
    );
    expect(model.n).toBe(3);
  });

  it("refuses a singular design instead of returning NaN coefficients", () => {
    // b is exactly 2a, so the two features carry the same information.
    expect(() =>
      linearRegression(
        [
          { a: 1, b: 2, y: 3 },
          { a: 2, b: 4, y: 6 },
          { a: 3, b: 6, y: 9 },
        ],
        { target: "y", features: ["a", "b"] },
      ),
    ).toThrow(/singular|collinear/i);
  });

  it("validates its options", () => {
    expect(() => linearRegression([{ x: 1, y: 1 }], { target: "y", features: [] })).toThrow(/feature/);
    expect(() => linearRegression([{ x: 1, y: 1 }], { target: "y", features: ["y"] })).toThrow(/target/);
    expect(() => linearRegression([{ x: 1, y: 1 }], { target: "y", features: ["x", "x"] })).toThrow(/unique/);
  });

  it("requires enough complete rows", () => {
    expect(() => linearRegression([{ x: 1, y: 1 }], { target: "y", features: ["x"] })).toThrow(/at least 2/);
  });

  it("reports a constant target as undefined R-squared rather than 1", () => {
    const model = linearRegression(
      [
        { x: 1, y: 5 },
        { x: 2, y: 5 },
        { x: 3, y: 5 },
      ],
      { target: "y", features: ["x"] },
    );
    expect(Number.isNaN(model.rSquared)).toBe(true);
  });

  it("coefficient standard errors and p-values are present for a real fit", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: 2 * x + (x % 2 === 0 ? 0.3 : -0.3) }));
    const model = linearRegression(rows, { target: "y", features: ["x"] });
    const errors = model.standardErrors();
    expect(errors["(intercept)"]).toBeTypeOf("number");
    expect(errors.x).toBeTypeOf("number");
    const pValues = model.pValues();
    // A near-perfect linear relationship should give a tiny p-value for the slope.
    expect(pValues.x).toBeTypeOf("number");
    expect(pValues.x as number).toBeLessThan(0.001);
  });
});

describe("Dataset.regression", () => {
  it("fits from a dataset and predicts", () => {
    const data = createDataset([
      { spend: 10, revenue: 100 },
      { spend: 20, revenue: 190 },
      { spend: 30, revenue: 310 },
      { spend: 40, revenue: 395 },
      { spend: 50, revenue: 505 },
    ]);
    const model = data.regression({ target: "revenue", features: ["spend"] });
    expect(model.coefficients.spend).toBeGreaterThan(9);
    expect(model.coefficients.spend).toBeLessThan(11);
    expect(model.rSquared).toBeGreaterThan(0.99);
    expect(model.predict([{ spend: 60 }])[0]).toBeGreaterThan(590);
  });

  it("rejects a text column as a feature", () => {
    const data = createDataset([
      { label: "a", y: 1 },
      { label: "b", y: 2 },
    ]);
    expect(() => data.regression({ target: "y", features: ["label"] })).toThrow(/numeric/);
  });

  it("rejects an unknown column", () => {
    const data = createDataset([{ x: 1, y: 2 }]);
    expect(() => data.regression({ target: "nope", features: ["x"] })).toThrow(/nope/);
  });
});
