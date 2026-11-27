/**
 * Linear regression: fit, predict, and judge the fit.
 *
 * Both simple (one feature) and multiple (several features) linear regression run through
 * the same normal-equations solve, so there is one code path to test rather than two.
 *
 * ## The model
 *
 * `y = b0 + b1*x1 + ... + bk*xk + e`, fit by ordinary least squares: the coefficients
 * minimise the sum of squared residuals. That is the unique minimiser when the design
 * matrix has full column rank, which is why a singular system is reported as an error
 * rather than papered over — a singular system means the features are collinear and no
 * unique answer exists.
 *
 * ## Assumptions, and what happens when they fail
 *
 * OLS is the best linear unbiased estimator under four assumptions: linearity in the
 * parameters, independent errors, constant error variance (homoscedasticity), and
 * normally distributed errors for the inference (the t- and F-tests). **This module
 * checks none of them for you.** R-squared will happily be 0.98 on data where the true
 * relationship is curved, and a p-value is meaningless if the errors are correlated.
 * Inspect `residuals()` before trusting a fit.
 *
 * ## Missing values
 *
 * Listwise. A row is used only if the target and *every* feature are present, because a
 * regression needs a complete design row. `n` reports how many rows survived, so a
 * heavy-handed drop is visible instead of silent.
 */
import { ValidationError } from "../errors/index.js";
import { tCdf } from "./distributions.js";

/** One row's inputs, keyed by feature name. */
export type RegressionRow = Readonly<Record<string, unknown>>;

/** Options for `linearRegression`. */
export interface RegressionOptions {
  /** Column to predict. */
  target: string;
  /** Columns used as predictors. One feature is simple regression; several is multiple. */
  features: readonly string[];
}

/** A fitted linear model. */
export interface RegressionModel {
  /** Predicted column name. */
  readonly target: string;
  /** Predictor names, in the order the coefficients use. */
  readonly features: readonly string[];
  /** Coefficient per feature, in `features` order. Excludes the intercept. */
  readonly coefficients: Readonly<Record<string, number>>;
  /** The intercept, `b0`. */
  readonly intercept: number;
  /** Rows used, after dropping any row with a missing target or feature. */
  readonly n: number;
  /** Predictors including the intercept. */
  readonly parameters: number;
  /** Coefficient of determination, `1 - SSres/SStot`. */
  readonly rSquared: number;
  /** `rSquared` adjusted for the number of predictors. */
  readonly adjustedRSquared: number;
  /** Mean squared error of the residuals, dividing by `n - parameters`. */
  readonly mse: number;
  /** Root mean squared error, the square root of `mse`. */
  readonly rmse: number;
  /** Residual degrees of freedom, `n - parameters`. */
  readonly degreesOfFreedom: number;
  /** Predicted value for each used row. */
  predict(rows: readonly RegressionRow[]): number[];
  /** Actual minus predicted, for each used row. */
  residuals(): number[];
  /** Fitted value for each used row. */
  fitted(): number[];
  /**
   * Standard error of each coefficient, keyed by name; the intercept is under
   * `"(intercept)"`. Requires `n > parameters`; `null` values mean the fit is saturated.
   */
  standardErrors(): Readonly<Record<string, number | null>>;
  /** Two-sided p-value for each coefficient's t-test against zero. */
  pValues(): Readonly<Record<string, number | null>>;
  /** The design rows the fit used, so `residuals()` can be matched back to source rows. */
  rowsUsed(): readonly RegressionRow[];
}

/** Solve `A x = b` by Gaussian elimination with partial pivoting. Throws when singular. */
function solve(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = vector.length;
  // Work on copies; the caller's design matrix is reused for predictions.
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(a[row]?.[column] ?? 0);
      if (candidate > Math.abs(a[pivot]?.[column] ?? 0)) pivot = row;
    }
    const pivotValue = a[pivot]?.[column] ?? 0;
    if (Math.abs(pivotValue) < 1e-12) {
      throw new ValidationError(
        "Regression is singular: the features are collinear, so no unique set of coefficients exists. Remove a redundant feature.",
      );
    }
    if (pivot !== column) {
      const rowSwap = a[pivot];
      a[pivot] = a[column] as number[];
      a[column] = rowSwap as number[];
      const valueSwap = b[pivot];
      b[pivot] = b[column] as number;
      b[column] = valueSwap as number;
    }
    const diagonal = a[column]?.[column] as number;
    for (let row = column + 1; row < size; row += 1) {
      const factor = (a[row]?.[column] ?? 0) / diagonal;
      if (factor === 0) continue;
      for (let k = column; k < size; k += 1) {
        const rowK = a[row] as number[];
        rowK[k] = (rowK[k] ?? 0) - factor * (a[column]?.[k] ?? 0);
      }
      b[row] = (b[row] ?? 0) - factor * (b[column] ?? 0);
    }
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = b[row] ?? 0;
    for (let column = row + 1; column < size; column += 1) {
      sum -= (a[row]?.[column] ?? 0) * (solution[column] ?? 0);
    }
    solution[row] = sum / (a[row]?.[row] as number);
  }
  return solution;
}

/** Invert a square matrix by solving against each unit vector. */
function invertMatrix(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const inverse: number[][] = [];
  for (let column = 0; column < size; column += 1) {
    const unit = new Array<number>(size).fill(0);
    unit[column] = 1;
    const solved = solve(matrix, unit);
    for (let row = 0; row < size; row += 1) {
      inverse[row] ??= new Array<number>(size).fill(0);
      (inverse[row] as number[])[column] = solved[row] as number;
    }
  }
  return inverse;
}

/**
 * Fit `y = b0 + sum(bi xi)` by ordinary least squares.
 *
 * Throws `ValidationError` for a non-numeric or missing column, fewer than two complete
 * rows, or a singular design (collinear features). A fit that cannot be trusted is an
 * error, not a model with `NaN` inside it.
 */
export function linearRegression(rows: readonly RegressionRow[], options: RegressionOptions): RegressionModel {
  const { target, features } = options;
  if (typeof target !== "string" || target.length === 0) {
    throw new ValidationError("linearRegression needs a target column name.");
  }
  if (!Array.isArray(features) || features.length === 0) {
    throw new ValidationError("linearRegression needs at least one feature column.");
  }
  const uniqueFeatures = [...new Set(features)];
  if (uniqueFeatures.length !== features.length) {
    throw new ValidationError("linearRegression features must be unique.");
  }
  if (uniqueFeatures.includes(target)) {
    throw new ValidationError(`linearRegression cannot use the target "${target}" as its own feature.`);
  }

  const used: RegressionRow[] = [];
  const designRows: number[][] = [];
  const outcomes: number[] = [];

  for (const row of rows) {
    const y = row[target];
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    const values: number[] = [];
    let complete = true;
    for (const feature of uniqueFeatures) {
      const value = row[feature];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        complete = false;
        break;
      }
      values.push(value);
    }
    if (!complete) continue;
    used.push(row);
    designRows.push(values);
    outcomes.push(y);
  }

  if (used.length < 2) {
    throw new ValidationError(
      `linearRegression needs at least 2 complete rows, found ${used.length}. Check that "${target}" and its features are numeric and present.`,
    );
  }
  const parameters = uniqueFeatures.length + 1;
  if (used.length < parameters) {
    throw new ValidationError(
      `linearRegression needs at least ${parameters} complete rows for ${uniqueFeatures.length} feature(s), found ${used.length}.`,
    );
  }

  // Normal equations: (X'X) b = X'y, with a leading 1 column for the intercept.
  const size = parameters;
  const xtx: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const xty: number[] = new Array<number>(size).fill(0);
  for (let row = 0; row < designRows.length; row += 1) {
    const values = designRows[row] as number[];
    const withIntercept = [1, ...values];
    const y = outcomes[row] as number;
    for (let i = 0; i < size; i += 1) {
      xty[i] = (xty[i] ?? 0) + (withIntercept[i] as number) * y;
      for (let j = 0; j < size; j += 1) {
        const rowXtx = xtx[i] as number[];
        rowXtx[j] = (rowXtx[j] ?? 0) + (withIntercept[i] as number) * (withIntercept[j] as number);
      }
    }
  }

  const beta = solve(xtx, xty);
  const intercept = beta[0] as number;
  const coefficientList = beta.slice(1);

  const predictRow = (row: RegressionRow): number => {
    let total = intercept;
    for (let index = 0; index < uniqueFeatures.length; index += 1) {
      const feature = uniqueFeatures[index] as string;
      const value = row[feature];
      total += (coefficientList[index] as number) * (typeof value === "number" ? value : Number.NaN);
    }
    return total;
  };

  const fittedValues = designRows.map((values) => {
    let total = intercept;
    for (let index = 0; index < values.length; index += 1) {
      total += (coefficientList[index] as number) * (values[index] as number);
    }
    return total;
  });

  const residualValues = outcomes.map((y, index) => y - (fittedValues[index] as number));
  const n = used.length;
  const degreesOfFreedom = n - parameters;

  const meanY = outcomes.reduce((sum, y) => sum + y, 0) / n;
  const ssTotal = outcomes.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const ssResidual = residualValues.reduce((sum, e) => sum + e * e, 0);

  // A constant target has no variance to explain; R² is undefined rather than 1.
  const rSquared = ssTotal === 0 ? Number.NaN : 1 - ssResidual / ssTotal;
  const mse = degreesOfFreedom > 0 ? ssResidual / degreesOfFreedom : Number.NaN;
  const adjustedRSquared =
    degreesOfFreedom > 0 && ssTotal !== 0 ? 1 - ssResidual / degreesOfFreedom / (ssTotal / (n - 1)) : Number.NaN;

  const coefficients: Record<string, number> = {};
  for (let index = 0; index < uniqueFeatures.length; index += 1) {
    coefficients[uniqueFeatures[index] as string] = coefficientList[index] as number;
  }

  const inverse = degreesOfFreedom > 0 ? invertMatrix(xtx) : null;
  const names = ["(intercept)", ...uniqueFeatures];

  const standardErrorTable = (): Record<string, number | null> => {
    const errors: Record<string, number | null> = {};
    if (inverse === null) {
      for (const name of names) errors[name] = null;
      return errors;
    }
    for (let index = 0; index < names.length; index += 1) {
      const variance = (inverse[index]?.[index] ?? Number.NaN) * mse;
      errors[names[index] as string] = variance >= 0 ? Math.sqrt(variance) : null;
    }
    return errors;
  };

  return {
    target,
    features: uniqueFeatures,
    coefficients,
    intercept,
    n,
    parameters,
    rSquared,
    adjustedRSquared,
    mse,
    rmse: Math.sqrt(mse),
    degreesOfFreedom,
    predict: (input) => input.map(predictRow),
    residuals: () => [...residualValues],
    fitted: () => [...fittedValues],
    standardErrors: standardErrorTable,
    pValues: () => {
      const errors = standardErrorTable();
      const estimates = [intercept, ...coefficientList];
      const values: Record<string, number | null> = {};
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string;
        const se = errors[name] ?? null;
        const estimate = estimates[index] as number;
        values[name] = se === null || se === 0 ? null : twoSidedTPValue(estimate / se, degreesOfFreedom);
      }
      return values;
    },
    rowsUsed: () => [...used],
  };
}

/**
 * Two-sided p-value for a t statistic.
 *
 * Lives here rather than in `tests.ts` so a model can report coefficient p-values without
 * importing the test module, which would make the two modules mutually dependent.
 */
function twoSidedTPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  // P(|T| > |t|) = 2 * (1 - F_t(|t|)).
  return 2 * (1 - tCdf(Math.abs(t), df));
}
