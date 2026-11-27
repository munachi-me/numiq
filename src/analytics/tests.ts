/**
 * Hypothesis tests: t-tests, chi-square, ANOVA, and a normality test.
 *
 * Every result carries the same shape — statistic, degrees of freedom, p-value, the null
 * and alternative hypotheses in words, a significance flag, and an interpretation — so a
 * caller can report any of them uniformly. The numbers are the primary output; the prose
 * is a convenience, and it is generated from the numbers rather than asserted separately.
 *
 * ## What a p-value means here, and what it does not
 *
 * A p-value is the probability of a statistic at least this extreme *if the null
 * hypothesis were true*. It is not the probability that the null is true, and it is not a
 * measure of effect size. With enough rows, a difference too small to matter will produce
 * a tiny p-value. Report an effect size (a mean difference, a group spread) alongside it.
 *
 * **Significance is not causation.** None of these tests can tell you why groups differ.
 *
 * ## Assumptions
 *
 * Each test documents its own. They are not checked automatically: a t-test on heavily
 * skewed data or an ANOVA on unequal variances gives a p-value that is simply wrong, and
 * nothing here will warn you. Inspect the data first — `describe()` and `profile()` exist
 * for that.
 */
import { ValidationError } from "../errors/index.js";
import { chiSquareCdf, chiSquareQuantile, fCdf, tCdf, tQuantile } from "./distributions.js";

/** A test result, shaped the same for every test so callers can report uniformly. */
export interface HypothesisTestResult {
  /** Which test produced this result. */
  readonly test: string;
  /** The test statistic. */
  readonly statistic: number;
  /** Degrees of freedom, where the test has them. */
  readonly df: number | null;
  /** Second degrees of freedom, for F tests. */
  readonly df2: number | null;
  /** Probability of a statistic at least this extreme under the null. */
  readonly pValue: number;
  /** The null hypothesis, in words. */
  readonly nullHypothesis: string;
  /** The alternative hypothesis, in words. */
  readonly alternativeHypothesis: string;
  /** Whether `pValue` is below the chosen alpha. */
  readonly significant: boolean;
  /** The alpha the `significant` flag used. */
  readonly alpha: number;
  /** A one-line reading of the result, generated from the numbers above. */
  readonly interpretation: string;
  /** Observations used. */
  readonly n: number;
  /** Extra statistics specific to the test (means, group counts, effect size). */
  readonly details: Readonly<Record<string, number>>;
}

/** Options shared by every test. */
export interface TestOptions {
  /** Significance level for the `significant` flag and the interpretation. Default `0.05`. */
  alpha?: number;
  /** `two-sided` (default), `less`, or `greater`. */
  alternative?: "two-sided" | "less" | "greater";
}

function assertAlpha(alpha: number): void {
  if (!(typeof alpha === "number" && alpha > 0 && alpha < 1)) {
    throw new ValidationError(`alpha must be between 0 and 1, received ${String(alpha)}.`);
  }
}

/** Present finite numbers, so missing and non-numeric cells are excluded. */
function finiteNumbers(values: readonly unknown[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

/**
 * Tail probability for a t statistic, honouring the alternative.
 *
 * `two-sided` doubles the smaller tail; `less` and `greater` use one tail directly.
 */
function tPValue(t: number, df: number, alternative: "two-sided" | "less" | "greater"): number {
  const cdf = tCdf(t, df);
  if (alternative === "less") return cdf;
  if (alternative === "greater") return 1 - cdf;
  return 2 * Math.min(cdf, 1 - cdf);
}

/** Sample variance with `ddof` (1 for a sample, 0 for a population). */
function sampleVariance(values: readonly number[], ddof = 1): number {
  if (values.length - ddof <= 0) return Number.NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sumSquares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return sumSquares / (values.length - ddof);
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Describe a p-value without claiming more than it says. */
function interpret(pValue: number, alpha: number, context: string): string {
  if (!Number.isFinite(pValue)) return `No conclusion: ${context} could not be computed.`;
  if (pValue < alpha) {
    return `p = ${pValue.toPrecision(4)} < ${alpha}: reject the null. ${context} is statistically significant at this level, which does not by itself establish causation or a meaningful effect size.`;
  }
  return `p = ${pValue.toPrecision(4)} >= ${alpha}: fail to reject the null. There is not enough evidence to conclude that ${context}.`;
}

// -------------------------------------------------------------------- t-tests

/** One-sample t-test: is the population mean different from `mu`? */
export interface OneSampleTTestOptions extends TestOptions {
  /** Hypothesised mean under the null. Default `0`. */
  mu?: number;
}

/**
 * One-sample t-test.
 *
 * **Assumptions:** observations are independent, and the sample mean is approximately
 * normal — which the central limit theorem supplies for large samples, but not for a
 * small sample from a skewed population.
 *
 * Returns `pValue: NaN` rather than throwing when the sample has fewer than two values or
 * zero variance, because a caller aggregating many columns should be able to see which
 * ones were untestable.
 */
export function oneSampleTTest(values: readonly unknown[], options: OneSampleTTestOptions = {}): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);
  const alternative = options.alternative ?? "two-sided";
  const mu = options.mu ?? 0;
  const sample = finiteNumbers(values);
  const n = sample.length;

  const nullHypothesis = `The population mean equals ${mu}.`;
  const alternativeHypothesis =
    alternative === "two-sided"
      ? `The population mean is not ${mu}.`
      : alternative === "greater"
        ? `The population mean is greater than ${mu}.`
        : `The population mean is less than ${mu}.`;

  if (n < 2) {
    return {
      test: "one-sample t",
      statistic: Number.NaN,
      df: n - 1,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: `No conclusion: a t-test needs at least 2 values, received ${n}.`,
      n,
      details: {},
    };
  }

  const mean = meanOf(sample);
  const variance = sampleVariance(sample);
  const standardError = Math.sqrt(variance / n);
  const df = n - 1;

  if (standardError === 0) {
    return {
      test: "one-sample t",
      statistic: Number.NaN,
      df,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: `No conclusion: all ${n} values are identical, so the standard error is zero.`,
      n,
      details: { mean, standardError: 0 },
    };
  }

  const statistic = (mean - mu) / standardError;
  const pValue = tPValue(statistic, df, alternative);

  return {
    test: "one-sample t",
    statistic,
    df,
    df2: null,
    pValue,
    nullHypothesis,
    alternativeHypothesis,
    significant: pValue < alpha,
    alpha,
    interpretation: interpret(pValue, alpha, "the mean differs from the hypothesised value"),
    n,
    details: { mean, standardError, hypothesisedMean: mu, difference: mean - mu },
  };
}

/**
 * Independent two-sample t-test (Welch).
 *
 * **Assumptions:** the two samples are independent, and each sample mean is
 * approximately normal. Welch's version does not assume equal variances, so it is the
 * default; the pooled-variance (Student) form is available with `pooled: true` for the
 * case where equal variances are genuinely known.
 *
 * **Welch is not conservative by accident.** With unequal variances and unequal group
 * sizes, the pooled t-test's false-positive rate can be several times its nominal alpha;
 * Welch keeps it near alpha without costing power when variances are in fact equal.
 */
export interface TwoSampleTTestOptions extends TestOptions {
  /** Use the pooled-variance form, which assumes equal population variances. Default `false`. */
  pooled?: boolean;
}

export function twoSampleTTest(
  left: readonly unknown[],
  right: readonly unknown[],
  options: TwoSampleTTestOptions = {},
): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);
  const alternative = options.alternative ?? "two-sided";
  const pooled = options.pooled ?? false;
  const a = finiteNumbers(left);
  const b = finiteNumbers(right);
  const n1 = a.length;
  const n2 = b.length;

  const nullHypothesis = "The two population means are equal.";
  const alternativeHypothesis =
    alternative === "two-sided"
      ? "The two population means differ."
      : alternative === "greater"
        ? "The first population mean is greater than the second."
        : "The first population mean is less than the second.";

  if (n1 < 2 || n2 < 2) {
    return {
      test: pooled ? "two-sample t (pooled)" : "two-sample t (Welch)",
      statistic: Number.NaN,
      df: null,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: `No conclusion: each group needs at least 2 values, received ${n1} and ${n2}.`,
      n: n1 + n2,
      details: { n1, n2 },
    };
  }

  const mean1 = meanOf(a);
  const mean2 = meanOf(b);
  const variance1 = sampleVariance(a);
  const variance2 = sampleVariance(b);
  const difference = mean1 - mean2;

  let standardError: number;
  let df: number;

  if (pooled) {
    const pooledVariance = ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
    standardError = Math.sqrt(pooledVariance * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  } else {
    const term1 = variance1 / n1;
    const term2 = variance2 / n2;
    standardError = Math.sqrt(term1 + term2);
    // Welch-Satterthwaite degrees of freedom, not necessarily an integer.
    const numerator = (term1 + term2) ** 2;
    const denominator = term1 ** 2 / (n1 - 1) + term2 ** 2 / (n2 - 1);
    df = denominator === 0 ? n1 + n2 - 2 : numerator / denominator;
  }

  if (standardError === 0) {
    return {
      test: pooled ? "two-sample t (pooled)" : "two-sample t (Welch)",
      statistic: Number.NaN,
      df,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: "No conclusion: both groups have zero variance, so the standard error is zero.",
      n: n1 + n2,
      details: { n1, n2, mean1, mean2 },
    };
  }

  const statistic = difference / standardError;
  const pValue = tPValue(statistic, df, alternative);

  return {
    test: pooled ? "two-sample t (pooled)" : "two-sample t (Welch)",
    statistic,
    df,
    df2: null,
    pValue,
    nullHypothesis,
    alternativeHypothesis,
    significant: pValue < alpha,
    alpha,
    interpretation: interpret(pValue, alpha, "the two means differ"),
    n: n1 + n2,
    details: { n1, n2, mean1, mean2, difference, standardError },
  };
}

/**
 * Paired t-test: are the differences within matched pairs centred on zero?
 *
 * **Assumptions:** pairs are independent of each other, and the *differences* are
 * approximately normal. Only complete pairs are used — a pair with one missing value
 * cannot contribute a difference.
 */
export function pairedTTest(
  before: readonly unknown[],
  after: readonly unknown[],
  options: TestOptions = {},
): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);
  const alternative = options.alternative ?? "two-sided";

  const differences: number[] = [];
  const length = Math.min(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const x = before[index];
    const y = after[index];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      differences.push(x - y);
    }
  }

  const result = oneSampleTTest(differences, { alpha, alternative, mu: 0 });
  return {
    ...result,
    test: "paired t",
    nullHypothesis: "The mean difference within pairs is zero.",
    alternativeHypothesis:
      alternative === "two-sided"
        ? "The mean difference within pairs is not zero."
        : alternative === "greater"
          ? "The mean difference within pairs is greater than zero."
          : "The mean difference within pairs is less than zero.",
    details: { ...result.details, pairs: differences.length },
  };
}

// ------------------------------------------------------------------- chi-square

/**
 * Chi-square test of independence on a contingency table.
 *
 * **Assumptions:** observations are independent, and each cell's *expected* count is at
 * least about 5 (some cells below 5 are tolerable in a large table; a table where most
 * cells are small needs an exact test instead). The result reports the number of cells
 * with an expected count below 5 so the caller can judge this rather than guess.
 */
export function chiSquareTest(table: readonly (readonly number[])[], options: TestOptions = {}): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);

  if (!Array.isArray(table) || table.length < 2) {
    throw new ValidationError("chiSquareTest needs at least 2 rows in the contingency table.");
  }
  const columns = table[0]?.length ?? 0;
  if (columns < 2) {
    throw new ValidationError("chiSquareTest needs at least 2 columns in the contingency table.");
  }
  for (const row of table) {
    if (row.length !== columns) {
      throw new ValidationError("chiSquareTest requires every row to have the same number of columns.");
    }
    for (const cell of row) {
      if (typeof cell !== "number" || !Number.isFinite(cell) || cell < 0) {
        throw new ValidationError(
          `chiSquareTest counts must be non-negative finite numbers, received ${String(cell)}.`,
        );
      }
    }
  }

  const rowTotals = table.map((row: readonly number[]) => row.reduce((sum: number, cell: number) => sum + cell, 0));
  const columnTotals = Array.from({ length: columns }, (_, column) =>
    table.reduce((sum: number, row: readonly number[]) => sum + (row[column] ?? 0), 0),
  );
  const total = rowTotals.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    throw new ValidationError("chiSquareTest cannot test a table whose counts are all zero.");
  }

  let statistic = 0;
  let smallCells = 0;
  for (let row = 0; row < table.length; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const expected = ((rowTotals[row] as number) * (columnTotals[column] as number)) / total;
      if (expected < 5) smallCells += 1;
      if (expected === 0) continue;
      const observed = table[row]?.[column] ?? 0;
      statistic += (observed - expected) ** 2 / expected;
    }
  }

  const df = (table.length - 1) * (columns - 1);
  const pValue = 1 - chiSquareCdf(statistic, df);

  return {
    test: "chi-square independence",
    statistic,
    df,
    df2: null,
    pValue,
    nullHypothesis: "The two categorical variables are independent.",
    alternativeHypothesis: "The two categorical variables are associated.",
    significant: pValue < alpha,
    alpha,
    interpretation: interpret(pValue, alpha, "the variables are associated"),
    n: total,
    details: {
      rows: table.length,
      columns,
      cellsWithExpectedBelow5: smallCells,
      cramersV: Math.sqrt(statistic / (total * Math.min(table.length - 1, columns - 1))),
    },
  };
}

// ------------------------------------------------------------------------ ANOVA

/** One group for a one-way ANOVA. */
export interface AnovaGroup {
  /** Label used in the result. */
  readonly name: string;
  /** Observations in the group; missing and non-numeric values are excluded. */
  readonly values: readonly unknown[];
}

/**
 * One-way analysis of variance: do the group means differ?
 *
 * **Assumptions:** independent observations, approximately normal residuals within each
 * group, and similar variances across groups. With very unequal variances and unequal
 * group sizes, use Welch's ANOVA instead — this function does not implement it, and
 * silently producing a p-value that is too small would be worse than saying so.
 *
 * A significant F says *some* group differs. It does not say which; a post-hoc
 * comparison is needed for that, and is deliberately not included because every post-hoc
 * method trades Type I and Type II error differently.
 */
export function oneWayAnova(groups: readonly AnovaGroup[], options: TestOptions = {}): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);

  if (!Array.isArray(groups) || groups.length < 2) {
    throw new ValidationError("oneWayAnova needs at least 2 groups.");
  }

  const prepared = groups.map((group) => ({ name: group.name, values: finiteNumbers(group.values) }));
  const empty = prepared.filter((group) => group.values.length === 0);
  if (empty.length > 0) {
    throw new ValidationError(
      `oneWayAnova received groups with no usable values: ${empty.map((group) => group.name).join(", ")}.`,
    );
  }

  const all = prepared.flatMap((group) => group.values);
  const grandMean = meanOf(all);
  const k = prepared.length;
  const n = all.length;

  let between = 0;
  let within = 0;
  const groupDetails: Record<string, number> = {};
  for (const group of prepared) {
    const groupMean = meanOf(group.values);
    between += group.values.length * (groupMean - grandMean) ** 2;
    within += group.values.reduce((sum, value) => sum + (value - groupMean) ** 2, 0);
    groupDetails[`mean_${group.name}`] = groupMean;
    groupDetails[`n_${group.name}`] = group.values.length;
  }

  const dfBetween = k - 1;
  const dfWithin = n - k;

  const nullHypothesis = "All group means are equal.";
  const alternativeHypothesis = "At least one group mean differs from the others.";

  if (dfWithin <= 0) {
    return {
      test: "one-way ANOVA",
      statistic: Number.NaN,
      df: dfBetween,
      df2: dfWithin,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: `No conclusion: ${n} observations in ${k} groups leaves no within-group degrees of freedom.`,
      n,
      details: { groups: k, ...groupDetails },
    };
  }

  const meanSquareBetween = between / dfBetween;
  const meanSquareWithin = within / dfWithin;

  if (meanSquareWithin === 0) {
    return {
      test: "one-way ANOVA",
      statistic: Number.NaN,
      df: dfBetween,
      df2: dfWithin,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: "No conclusion: there is no within-group variation, so the F ratio is undefined.",
      n,
      details: { groups: k, ...groupDetails },
    };
  }

  const statistic = meanSquareBetween / meanSquareWithin;
  const pValue = 1 - fCdf(statistic, dfBetween, dfWithin);

  return {
    test: "one-way ANOVA",
    statistic,
    df: dfBetween,
    df2: dfWithin,
    pValue,
    nullHypothesis,
    alternativeHypothesis,
    significant: pValue < alpha,
    alpha,
    interpretation: interpret(pValue, alpha, "at least one group mean differs"),
    n,
    details: {
      groups: k,
      grandMean,
      meanSquareBetween,
      meanSquareWithin,
      etaSquared: between / (between + within),
      ...groupDetails,
    },
  };
}

// -------------------------------------------------------------------- normality

/**
 * Jarque-Bera test of normality.
 *
 * Compares the sample skewness and excess kurtosis against what a normal distribution
 * would give. Chosen over Shapiro-Wilk because it needs only moments that `skewness()`
 * and `kurtosis()` already compute, so there is one definition of each in the codebase.
 *
 * **Limitation:** the statistic is asymptotically chi-square with 2 degrees of freedom,
 * so the p-value is unreliable below roughly 30 observations — it has little power to
 * detect non-normality in a small sample, and will often fail to reject even when the
 * data are clearly skewed. Treat a non-significant result as "not detected", not "normal".
 */
export function jarqueBeraTest(values: readonly unknown[], options: TestOptions = {}): HypothesisTestResult {
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);
  const sample = finiteNumbers(values);
  const n = sample.length;

  const nullHypothesis = "The data are drawn from a normal distribution.";
  const alternativeHypothesis = "The data are not drawn from a normal distribution.";

  if (n < 4) {
    return {
      test: "Jarque-Bera normality",
      statistic: Number.NaN,
      df: 2,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: `No conclusion: Jarque-Bera needs at least 4 values, received ${n}.`,
      n,
      details: {},
    };
  }

  const mean = meanOf(sample);
  const m2 = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const m3 = sample.reduce((sum, value) => sum + (value - mean) ** 3, 0) / n;
  const m4 = sample.reduce((sum, value) => sum + (value - mean) ** 4, 0) / n;

  if (m2 === 0) {
    return {
      test: "Jarque-Bera normality",
      statistic: Number.NaN,
      df: 2,
      df2: null,
      pValue: Number.NaN,
      nullHypothesis,
      alternativeHypothesis,
      significant: false,
      alpha,
      interpretation: "No conclusion: all values are identical, so the moments are undefined.",
      n,
      details: {},
    };
  }

  const skew = m3 / m2 ** 1.5;
  const excessKurtosis = m4 / (m2 * m2) - 3;
  const statistic = (n / 6) * (skew * skew + (excessKurtosis * excessKurtosis) / 4);
  const pValue = 1 - chiSquareCdf(statistic, 2);

  return {
    test: "Jarque-Bera normality",
    statistic,
    df: 2,
    df2: null,
    pValue,
    nullHypothesis,
    alternativeHypothesis,
    significant: pValue < alpha,
    alpha,
    interpretation: interpret(pValue, alpha, "the data deviate from normality"),
    n,
    details: { skewness: skew, excessKurtosis },
  };
}

// Re-exported so a caller building a confidence interval has the quantiles to hand.
export { tQuantile, chiSquareQuantile };

/** Two-sided confidence interval for a mean, using the t distribution. */
export function meanConfidenceInterval(
  values: readonly unknown[],
  options: { confidence?: number } = {},
): { lower: number; upper: number; mean: number; level: number; df: number } {
  const level = options.confidence ?? 0.95;
  if (!(level > 0 && level < 1)) {
    throw new ValidationError(`confidence level must be between 0 and 1, received ${String(level)}.`);
  }
  const sample = finiteNumbers(values);
  const n = sample.length;
  if (n < 2) {
    throw new ValidationError(`meanConfidenceInterval needs at least 2 values, received ${n}.`);
  }
  const mean = meanOf(sample);
  const standardError = Math.sqrt(sampleVariance(sample) / n);
  const df = n - 1;
  const critical = tQuantile(1 - (1 - level) / 2, df);
  return { lower: mean - critical * standardError, upper: mean + critical * standardError, mean, level, df };
}
