import { describe, it, expect } from "vitest";
import {
  binomialDistribution,
  chiSquareCdf,
  chiSquareQuantile,
  drawSamples,
  fCdf,
  fQuantile,
  incompleteBeta,
  incompleteGamma,
  normalCdf,
  normalDistribution,
  normalQuantile,
  poissonDistribution,
  tCdf,
  tQuantile,
  uniformDistribution,
} from "../../src/analytics/distributions.js";

/**
 * Reference values come from published statistical tables (Abramowitz & Stegun, and the
 * standard t/chi-square/F tables). Pinning them here means a change to the continued
 * fractions or the Lanczos coefficients cannot drift silently.
 */
describe("special functions", () => {
  it("normalCdf matches the standard normal table", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 10);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145705, 10);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 10);
    expect(normalCdf(2.576)).toBeCloseTo(0.995002467684265, 10);
  });

  it("normalCdf is symmetric about zero", () => {
    for (const z of [0.1, 0.5, 1.3, 2.9]) {
      expect(normalCdf(-z)).toBeCloseTo(1 - normalCdf(z), 12);
    }
  });

  it("normalCdf handles infinities", () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("normalQuantile inverts normalCdf", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 7);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959963984540054, 7);
    // Round trip through the CDF, which is more accurate than the quantile itself.
    for (const p of [0.01, 0.1, 0.3, 0.7, 0.99]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 8);
    }
  });

  it("normalQuantile rejects p outside (0, 1)", () => {
    expect(() => normalQuantile(0)).toThrow(RangeError);
    expect(() => normalQuantile(1)).toThrow(RangeError);
  });

  it("tCdf matches published critical values", () => {
    // 0.975 quantile of t with 10 df is 2.228.
    expect(tCdf(2.2281388519649385, 10)).toBeCloseTo(0.975, 8);
    expect(tCdf(1.8124611228107335, 10)).toBeCloseTo(0.95, 8);
    expect(tCdf(0, 10)).toBeCloseTo(0.5, 12);
    // Heavy tails converge slowly to normal; t(1) is Cauchy, whose CDF is closed form.
    expect(tCdf(1, 1)).toBeCloseTo(0.75, 10);
    expect(tCdf(1, 1)).toBeCloseTo(0.5 + Math.atan(1) / Math.PI, 12);
  });

  it("tQuantile inverts tCdf", () => {
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.2281388519649385, 6);
    expect(tQuantile(0.95, 30)).toBeCloseTo(1.697260886593958, 5);
    expect(tQuantile(0.5, 5)).toBe(0);
    for (const p of [0.05, 0.25, 0.75, 0.95]) {
      expect(tCdf(tQuantile(p, 12), 12)).toBeCloseTo(p, 8);
    }
  });

  it("tQuantile is symmetric", () => {
    expect(tQuantile(0.1, 7)).toBeCloseTo(-tQuantile(0.9, 7), 8);
  });

  it("chiSquareCdf matches published critical values", () => {
    expect(chiSquareCdf(3.841458820694124, 1)).toBeCloseTo(0.95, 8);
    expect(chiSquareCdf(5.991464547107979, 2)).toBeCloseTo(0.95, 8);
    expect(chiSquareCdf(18.307038053275146, 10)).toBeCloseTo(0.95, 8);
    expect(chiSquareCdf(0, 5)).toBe(0);
  });

  it("chiSquareQuantile inverts chiSquareCdf", () => {
    expect(chiSquareQuantile(0.95, 1)).toBeCloseTo(3.841458820694124, 5);
    expect(chiSquareQuantile(0.95, 2)).toBeCloseTo(5.991464547107979, 5);
    for (const p of [0.1, 0.5, 0.9]) {
      expect(chiSquareCdf(chiSquareQuantile(p, 4), 4)).toBeCloseTo(p, 7);
    }
  });

  it("fCdf matches published critical values", () => {
    // F(1, 10) at 0.95 is 4.9646.
    expect(fCdf(4.964602743926841, 1, 10)).toBeCloseTo(0.95, 7);
    // F(2, 20) at 0.95 is 3.4928.
    expect(fCdf(3.492828, 2, 20)).toBeCloseTo(0.95, 5);
    expect(fCdf(0, 2, 20)).toBe(0);
  });

  it("fQuantile inverts fCdf", () => {
    expect(fQuantile(0.95, 1, 10)).toBeCloseTo(4.964602743926841, 4);
    for (const p of [0.2, 0.6, 0.9]) {
      expect(fCdf(fQuantile(p, 3, 15), 3, 15)).toBeCloseTo(p, 6);
    }
  });

  it("incompleteGamma and incompleteBeta satisfy their boundary values", () => {
    expect(incompleteGamma(1, 0)).toBe(0);
    expect(incompleteBeta(2, 3, 0)).toBe(0);
    expect(incompleteBeta(2, 3, 1)).toBe(1);
  });

  it("incompleteBeta is symmetric in its complement", () => {
    // I_x(a, b) = 1 - I_{1-x}(b, a)
    const left = incompleteBeta(2, 5, 0.3);
    const right = 1 - incompleteBeta(5, 2, 0.7);
    expect(left).toBeCloseTo(right, 12);
  });
});

describe("continuous distributions", () => {
  it("normal exposes its moments", () => {
    const d = normalDistribution(10, 2);
    expect(d.mean()).toBe(10);
    expect(d.variance()).toBe(4);
    expect(d.sd()).toBe(2);
  });

  it("normal pdf integrates to 1 and peaks at the mean", () => {
    const d = normalDistribution(0, 1);
    expect(d.pdf(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
    // Trapezoidal integration over the effective support.
    let area = 0;
    const step = 0.001;
    for (let x = -10; x < 10; x += step) area += ((d.pdf(x) + d.pdf(x + step)) / 2) * step;
    expect(area).toBeCloseTo(1, 5);
  });

  it("normal cdf and quantile agree with the free functions", () => {
    const d = normalDistribution(5, 3);
    expect(d.cdf(5)).toBeCloseTo(0.5, 12);
    expect(d.quantile(0.5)).toBeCloseTo(5, 9);
    expect(d.cdf(8)).toBeCloseTo(normalCdf(1), 12);
  });

  it("normal rejects a non-positive sd", () => {
    expect(() => normalDistribution(0, 0)).toThrow(/sd/);
    expect(() => normalDistribution(0, -1)).toThrow(/sd/);
    expect(() => normalDistribution(Number.NaN, 1)).toThrow(/mean/);
  });

  it("uniform has the textbook moments", () => {
    const d = uniformDistribution(2, 8);
    expect(d.mean()).toBe(5);
    expect(d.variance()).toBeCloseTo(3, 12); // (6^2)/12
    expect(d.sd()).toBeCloseTo(Math.sqrt(3), 12);
    expect(d.pdf(5)).toBeCloseTo(1 / 6, 12);
    expect(d.pdf(1)).toBe(0);
    expect(d.pdf(9)).toBe(0);
    expect(d.cdf(5)).toBeCloseTo(0.5, 12);
    expect(d.cdf(1)).toBe(0);
    expect(d.cdf(9)).toBe(1);
    expect(d.quantile(0.25)).toBeCloseTo(3.5, 12);
  });

  it("uniform rejects an inverted range", () => {
    expect(() => uniformDistribution(5, 5)).toThrow(/exceed/);
  });

  it("sampling is reproducible with a seeded generator", () => {
    const d = normalDistribution(0, 1);
    let state = 12345;
    const gen = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const first = drawSamples(d, 5, { random: gen });
    state = 12345;
    const second = drawSamples(d, 5, { random: gen });
    expect(first).toEqual(second);
  });

  it("a uniform sample of many draws has approximately the right mean", () => {
    const d = uniformDistribution(0, 10);
    const draws = drawSamples(d, 20000);
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    expect(mean).toBeGreaterThan(4.8);
    expect(mean).toBeLessThan(5.2);
  });
});

describe("discrete distributions", () => {
  it("binomial pmf matches the closed form", () => {
    const d = binomialDistribution(10, 0.5);
    // C(10,5)/2^10 = 252/1024
    expect(d.pmf(5)).toBeCloseTo(252 / 1024, 12);
    expect(d.pmf(0)).toBeCloseTo(1 / 1024, 12);
    expect(d.pmf(10)).toBeCloseTo(1 / 1024, 12);
    expect(d.pmf(11)).toBe(0);
    expect(d.pmf(-1)).toBe(0);
    expect(d.pmf(2.5)).toBe(0);
  });

  it("binomial cdf sums the mass", () => {
    const d = binomialDistribution(10, 0.5);
    let cumulative = 0;
    for (let k = 0; k <= 5; k += 1) cumulative += d.pmf(k);
    expect(d.cdf(5)).toBeCloseTo(cumulative, 10);
    expect(d.cdf(5)).toBeCloseTo(0.623046875, 10);
  });

  it("binomial moments are np and np(1-p)", () => {
    const d = binomialDistribution(20, 0.3);
    expect(d.mean()).toBeCloseTo(6, 12);
    expect(d.variance()).toBeCloseTo(4.2, 12);
    expect(d.sd()).toBeCloseTo(Math.sqrt(4.2), 12);
  });

  it("binomial handles the degenerate probabilities", () => {
    expect(binomialDistribution(5, 0).pmf(0)).toBe(1);
    expect(binomialDistribution(5, 0).pmf(1)).toBe(0);
    expect(binomialDistribution(5, 1).pmf(5)).toBe(1);
    expect(binomialDistribution(5, 1).cdf(4)).toBe(0);
  });

  it("binomial validates its parameters", () => {
    expect(() => binomialDistribution(2.5, 0.5)).toThrow(/trials/);
    expect(() => binomialDistribution(-1, 0.5)).toThrow(/trials/);
    expect(() => binomialDistribution(5, 1.5)).toThrow(/probability/);
  });

  it("binomial quantile is the smallest k reaching p", () => {
    const d = binomialDistribution(10, 0.5);
    const k = d.quantile(0.5);
    expect(d.cdf(k)).toBeGreaterThanOrEqual(0.5);
    expect(d.cdf(k - 1)).toBeLessThan(0.5);
  });

  it("poisson pmf matches the closed form", () => {
    const d = poissonDistribution(3);
    expect(d.pmf(0)).toBeCloseTo(Math.exp(-3), 14);
    expect(d.pmf(1)).toBeCloseTo(3 * Math.exp(-3), 14);
    expect(d.pmf(2)).toBeCloseTo((9 / 2) * Math.exp(-3), 14);
    expect(d.pmf(-1)).toBe(0);
    expect(d.pmf(1.5)).toBe(0);
  });

  it("poisson cdf matches the published value", () => {
    // P(X <= 2) for lambda = 3
    expect(poissonDistribution(3).cdf(2)).toBeCloseTo(0.42319008112684364, 12);
  });

  it("poisson moments both equal the rate", () => {
    const d = poissonDistribution(4.5);
    expect(d.mean()).toBe(4.5);
    expect(d.variance()).toBe(4.5);
    expect(d.sd()).toBeCloseTo(Math.sqrt(4.5), 12);
  });

  it("poisson validates its rate", () => {
    expect(() => poissonDistribution(0)).toThrow(/rate/);
    expect(() => poissonDistribution(-1)).toThrow(/rate/);
  });

  it("poisson quantile is the smallest k reaching p", () => {
    const d = poissonDistribution(5);
    const k = d.quantile(0.9);
    expect(d.cdf(k)).toBeGreaterThanOrEqual(0.9);
    expect(d.cdf(k - 1)).toBeLessThan(0.9);
  });

  it("drawSamples validates the count", () => {
    expect(() => drawSamples(poissonDistribution(2), -1)).toThrow(/count/);
    expect(() => drawSamples(poissonDistribution(2), 1.5)).toThrow(/count/);
    expect(drawSamples(poissonDistribution(2), 0)).toEqual([]);
  });
});
