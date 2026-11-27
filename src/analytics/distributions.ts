/**
 * Probability distributions, and the special functions they are built from.
 *
 * The four distributions here exist so a caller can ask the questions a data analyst
 * actually asks: how unusual is this value (`cdf`), what value marks the top 5%
 * (`quantile`), and what would a sample of this size look like (`sample`). They are also
 * the substrate for the hypothesis tests in `tests.ts`, which need t, chi-square and F
 * tail probabilities.
 *
 * ## Numerical approach
 *
 * Everything reduces to two regularized incomplete integrals: the incomplete gamma
 * `P(a, x)` (normal, chi-square, Poisson) and the incomplete beta `I_x(a, b)` (t, F,
 * binomial). Both use the continued-fraction and series expansions from *Numerical
 * Recipes*, chosen by which converges faster in the given regime, with the log-gamma from
 * the Lanczos approximation. Accuracy is near machine precision (~1e-15 relative) across
 * the range these tests use.
 *
 * Quantiles for the t, chi-square and F distributions are found by bisection on the CDF
 * rather than by a closed form, because no closed form exists. Bisection is slower than a
 * rational approximation but is transparently correct and cannot be silently wrong at the
 * tails — which is exactly where a p-value lives.
 *
 * ## Sampling
 *
 * Every distribution samples by inverse transform: draw `u` from `[0, 1)` and return
 * `quantile(u)`. For discrete distributions the quantile is a binary search over the CDF,
 * which is exact (up to floating point) rather than an approximation, so a large-`n`
 * binomial is not silently replaced by a normal. Passing a seeded `random` makes a draw
 * reproducible.
 *
 * ## What this module does not do
 *
 * No fitting. It will not estimate parameters from data; that is a modelling decision
 * with assumptions the caller must make.
 */
import { ValidationError } from "../errors/index.js";

// ---------------------------------------------------------------- special functions

const L0 = 0.99999999999980993;
const L1 = 676.5203681218851;
const L2 = -1259.1392167224028;
const L3 = 771.32342877765313;
const L4 = -176.61502916214059;
const L5 = 12.507343278686905;
const L6 = -0.13857109526572012;
const L7 = 9.9843695780195716e-6;
const L8 = 1.5056327351493116e-7;

/**
 * Log of the gamma function, by the Lanczos approximation.
 *
 * Used instead of `gamma` because the factorials in binomial and Poisson coefficients
 * overflow `Number` long before the log does, and the differences stay finite.
 */
function lgamma(x: number): number {
  if (x < 0.5) {
    // Reflection: Gamma(x)Gamma(1-x) = pi / sin(pi x). Keeps the series in its stable range.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  const z = x - 1;
  const t = z + 7.5;
  const series =
    L0 +
    L1 / (z + 1) +
    L2 / (z + 2) +
    L3 / (z + 3) +
    L4 / (z + 4) +
    L5 / (z + 5) +
    L6 / (z + 6) +
    L7 / (z + 7) +
    L8 / (z + 8);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

const FPMIN = 1e-300;
const EPS = 3e-16;
const MAX_ITERATIONS = 300;

/** Series expansion for the regularized lower incomplete gamma; converges for `x < a+1`. */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= MAX_ITERATIONS; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

/** Continued fraction for the regularized upper incomplete gamma; converges for `x > a+1`. */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized lower incomplete gamma `P(a, x)`. */
export function incompleteGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * gammaContinuedFraction(a, x);
}

/** Regularized upper incomplete gamma `Q(a, x) = 1 - P(a, x)`. */
function upperIncompleteGamma(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * gammaContinuedFraction(a, x);
}

/** Continued fraction for the incomplete beta function. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta `I_x(a, b)`. */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Error function, from the incomplete gamma: `erf(x) = sign(x) P(1/2, x^2)`. */
function erf(x: number): number {
  const value = incompleteGamma(0.5, x * x);
  return x >= 0 ? value : -value;
}

/** Standard normal cumulative distribution. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Acklam's rational approximation coefficients, for the standard normal quantile.
const QA0 = -3.969683028665376e1;
const QA1 = 2.209460984245205e2;
const QA2 = -2.759285104469687e2;
const QA3 = 1.38357751867269e2;
const QA4 = -3.066479806614716e1;
const QA5 = 2.506628277459239;

const QB0 = -5.447609879822406e1;
const QB1 = 1.615858368580409e2;
const QB2 = -1.556989798598866e2;
const QB3 = 6.680131188771972e1;
const QB4 = -1.328068155288572e1;

const QC0 = -7.784894002430293e-3;
const QC1 = -3.223964580411365e-1;
const QC2 = -2.400758277161838;
const QC3 = -2.549732539343734;
const QC4 = 4.374664141464968;
const QC5 = 2.938163982698783;

const QD0 = 7.784695709041462e-3;
const QD1 = 3.224671290700398e-1;
const QD2 = 2.445134137142996;
const QD3 = 3.754408661907416;

const P_LOW = 0.02425;
const P_HIGH = 1 - P_LOW;

/**
 * Standard normal quantile (inverse CDF).
 *
 * Acklam's approximation, accurate to about 1.15e-9 relative. That is less than the
 * ~1e-15 of the CDF, but a quantile is used for thresholds and sampling rather than for
 * a reported p-value, so 9 digits is more than enough and the closed form is far cheaper
 * than bisection.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`normalQuantile needs p in (0, 1), received ${String(p)}.`);
  }
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((QC0 * q + QC1) * q + QC2) * q + QC3) * q + QC4) * q + QC5) /
      ((((QD0 * q + QD1) * q + QD2) * q + QD3) * q + 1)
    );
  }
  if (p <= P_HIGH) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((QA0 * r + QA1) * r + QA2) * r + QA3) * r + QA4) * r + QA5) * q) /
      (((((QB0 * r + QB1) * r + QB2) * r + QB3) * r + QB4) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((QC0 * q + QC1) * q + QC2) * q + QC3) * q + QC4) * q + QC5) / ((((QD0 * q + QD1) * q + QD2) * q + QD3) * q + 1)
  );
}

/** Student t cumulative distribution. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}

/** Chi-square cumulative distribution. */
export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return incompleteGamma(df / 2, x / 2);
}

/** F cumulative distribution. */
export function fCdf(x: number, df1: number, df2: number): number {
  if (x <= 0) return 0;
  return incompleteBeta(df1 / 2, df2 / 2, (df1 * x) / (df1 * x + df2));
}

/**
 * Invert a monotone CDF by bisection.
 *
 * Used for t, chi-square and F, which have no closed-form quantile. Widening the bracket
 * first means a caller need not supply bounds, and the `cdf` is called ~200 times, which
 * costs microseconds.
 */
function invert(cdf: (x: number) => number, p: number, label: string): number {
  let low = 0;
  let high = 1;
  while (cdf(high) < p) {
    low = high;
    high *= 2;
    if (high > 1e300) throw new RangeError(`${label} quantile did not converge for p=${String(p)}.`);
  }
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (cdf(mid) < p) low = mid;
    else high = mid;
    if (high - low <= Math.abs(high) * 1e-15) break;
  }
  return (low + high) / 2;
}

/** Student t quantile. */
export function tQuantile(p: number, df: number): number {
  assertProbability(p, "tQuantile");
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  return invert((x) => tCdf(x, df), p, "Student t");
}

/** Chi-square quantile. */
export function chiSquareQuantile(p: number, df: number): number {
  assertProbability(p, "chiSquareQuantile");
  return invert((x) => chiSquareCdf(x, df), p, "chi-square");
}

/** F quantile. */
export function fQuantile(p: number, df1: number, df2: number): number {
  assertProbability(p, "fQuantile");
  return invert((x) => fCdf(x, df1, df2), p, "F");
}

function assertProbability(p: number, label: string): void {
  if (!(typeof p === "number" && p >= 0 && p <= 1)) {
    throw new RangeError(`${label} needs p in [0, 1], received ${String(p)}.`);
  }
}

// ------------------------------------------------------------------ distributions

/** A continuous distribution: density, cumulative, quantile, moments, and sampling. */
export interface ContinuousDistribution {
  readonly kind: "normal" | "uniform";
  /** Expected value. */
  mean(): number;
  /** Population variance. */
  variance(): number;
  /** Population standard deviation. */
  sd(): number;
  /** Probability density at `x`. */
  pdf(x: number): number;
  /** Cumulative probability `P(X <= x)`. */
  cdf(x: number): number;
  /** Inverse CDF: the value with cumulative probability `p`. */
  quantile(p: number): number;
  /** One draw, by inverse transform. Pass a seeded generator for reproducibility. */
  sample(random?: () => number): number;
}

/** A discrete distribution: mass, cumulative, quantile, moments, and sampling. */
export interface DiscreteDistribution {
  readonly kind: "binomial" | "poisson";
  /** Expected value. */
  mean(): number;
  /** Population variance. */
  variance(): number;
  /** Population standard deviation. */
  sd(): number;
  /** Probability mass at the integer `k`. */
  pmf(k: number): number;
  /** Cumulative probability `P(X <= x)`. */
  cdf(x: number): number;
  /** Smallest value with cumulative probability at least `p`. */
  quantile(p: number): number;
  /** One draw, by inverse transform. Pass a seeded generator for reproducibility. */
  sample(random?: () => number): number;
}

/**
 * Bisection for a discrete quantile: the smallest integer `k` with `cdf(k) >= p`.
 *
 * Exact, unlike a normal approximation, and `O(log n)` CDF evaluations. `low` bounds the
 * search from below so a Poisson far from zero does not bisect from 0 every time.
 */
function discreteQuantile(cdf: (x: number) => number, p: number, high: number, low = 0): number {
  if (p <= 0) return low;
  let lo = Math.max(0, Math.floor(low));
  let hi = Math.max(lo, Math.ceil(high));
  while (cdf(hi) < p) {
    hi *= 2;
    if (hi > 1e15) break;
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cdf(mid) >= p) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Normal distribution with the given mean and standard deviation. */
export function normalDistribution(mean = 0, sd = 1): ContinuousDistribution {
  if (!Number.isFinite(mean)) throw new ValidationError(`normal mean must be finite, received ${String(mean)}.`);
  if (!Number.isFinite(sd) || sd <= 0)
    throw new ValidationError(`normal sd must be a positive finite number, received ${String(sd)}.`);
  return {
    kind: "normal",
    mean: () => mean,
    variance: () => sd * sd,
    sd: () => sd,
    pdf: (x) => Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI)),
    cdf: (x) => normalCdf((x - mean) / sd),
    quantile: (p) => mean + sd * normalQuantile(p),
    sample: (random = Math.random) => mean + sd * normalQuantile(clampUnit(random())),
  };
}

/** Continuous uniform distribution on `[min, max)`. */
export function uniformDistribution(min = 0, max = 1): ContinuousDistribution {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new ValidationError("uniform bounds must be finite.");
  if (!(max > min))
    throw new ValidationError(`uniform max must exceed min, received min=${String(min)} max=${String(max)}.`);
  const width = max - min;
  return {
    kind: "uniform",
    mean: () => (min + max) / 2,
    variance: () => (width * width) / 12,
    sd: () => width / Math.sqrt(12),
    pdf: (x) => (x >= min && x <= max ? 1 / width : 0),
    cdf: (x) => (x <= min ? 0 : x >= max ? 1 : (x - min) / width),
    quantile: (p) => {
      assertProbability(p, "uniform quantile");
      return min + p * width;
    },
    sample: (random = Math.random) => min + clampUnit(random()) * width,
  };
}

/**
 * Binomial distribution: successes in `trials` independent draws with probability `p`.
 *
 * `cdf` is computed through the incomplete beta, so it stays accurate for large `trials`
 * where summing the mass would accumulate error.
 */
export function binomialDistribution(trials: number, probability: number): DiscreteDistribution {
  if (!Number.isInteger(trials) || trials < 0)
    throw new ValidationError(`binomial trials must be a non-negative integer, received ${String(trials)}.`);
  if (!(probability >= 0 && probability <= 1))
    throw new ValidationError(`binomial probability must be in [0, 1], received ${String(probability)}.`);
  const n = trials;
  const p = probability;

  const cdf = (x: number): number => {
    if (x < 0) return 0;
    if (x >= n) return 1;
    const k = Math.floor(x);
    if (p === 0) return 1;
    if (p === 1) return k >= n ? 1 : 0;
    // P(X <= k) = I_{1-p}(n-k, k+1)
    return incompleteBeta(n - k, k + 1, 1 - p);
  };

  return {
    kind: "binomial",
    mean: () => n * p,
    variance: () => n * p * (1 - p),
    sd: () => Math.sqrt(n * p * (1 - p)),
    pmf: (k) => {
      if (!Number.isInteger(k) || k < 0 || k > n) return 0;
      if (p === 0) return k === 0 ? 1 : 0;
      if (p === 1) return k === n ? 1 : 0;
      const logCoefficient = lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
      return Math.exp(logCoefficient + k * Math.log(p) + (n - k) * Math.log(1 - p));
    },
    cdf,
    quantile: (q) => {
      assertProbability(q, "binomial quantile");
      return discreteQuantile(cdf, q, n);
    },
    sample: (random = Math.random) => discreteQuantile(cdf, clampUnit(random()), n),
  };
}

/**
 * Poisson distribution: count of events in a fixed interval at the given rate.
 *
 * The quantile search starts near the mean rather than at zero, so a large rate does not
 * cost a bisection from `0` to `rate + 10 sqrt(rate)`.
 */
export function poissonDistribution(rate: number): DiscreteDistribution {
  if (!Number.isFinite(rate) || rate <= 0)
    throw new ValidationError(`poisson rate must be a positive finite number, received ${String(rate)}.`);
  const lambda = rate;
  const sd = Math.sqrt(lambda);
  const upper = Math.ceil(lambda + 40 * sd + 40);

  const cdf = (x: number): number => {
    if (x < 0) return 0;
    const k = Math.floor(x);
    // P(X <= k) = Q(k+1, lambda)
    return upperIncompleteGamma(k + 1, lambda);
  };

  return {
    kind: "poisson",
    mean: () => lambda,
    variance: () => lambda,
    sd: () => sd,
    pmf: (k) => {
      if (!Number.isInteger(k) || k < 0) return 0;
      return Math.exp(-lambda + k * Math.log(lambda) - lgamma(k + 1));
    },
    cdf,
    quantile: (q) => {
      assertProbability(q, "poisson quantile");
      return discreteQuantile(cdf, q, upper, Math.max(0, Math.floor(lambda - 10 * sd)));
    },
    sample: (random = Math.random) =>
      discreteQuantile(cdf, clampUnit(random()), upper, Math.max(0, Math.floor(lambda - 10 * sd))),
  };
}

/**
 * Clamp a generator's output into `[0, 1)`.
 *
 * `Math.random()` never returns 1, but a caller-supplied generator might, and
 * `quantile(1)` is a range error for the normal. Clamping keeps a custom generator from
 * throwing mid-sample.
 */
function clampUnit(value: number): number {
  if (!(value >= 0)) return 0;
  return value >= 1 ? 0.9999999999999999 : value;
}

/** Draw `count` samples from a distribution, optionally seeded for reproducibility. */
export function drawSamples(
  distribution: ContinuousDistribution | DiscreteDistribution,
  count: number,
  options: { random?: () => number } = {},
): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError(`drawSamples needs a non-negative integer count, received ${String(count)}.`);
  }
  const random = options.random ?? Math.random;
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) out.push(distribution.sample(random));
  return out;
}
