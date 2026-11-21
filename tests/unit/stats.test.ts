import { describe, expect, it } from "vitest";
import { extremes, iqr, mode, percentile, quantile, quartiles, range } from "../../src/analytics/stats.js";

/** Reference sample used across the quantile tests. */
const SAMPLE = [2, 4, 4, 4, 5, 5, 7, 9];

describe("quantile", () => {
  it("matches numpy/R type 7 on a known sample", () => {
    // Cross-checked against Python's statistics.quantiles(method="inclusive").
    expect(quantile(SAMPLE, 0)).toBe(2);
    expect(quantile(SAMPLE, 0.25)).toBe(4);
    expect(quantile(SAMPLE, 0.5)).toBe(4.5);
    expect(quantile(SAMPLE, 0.75)).toBe(5.5);
    expect(quantile(SAMPLE, 1)).toBe(9);
  });

  it("interpolates between order statistics", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10], 0.1)).toBe(1);
  });

  it("returns the only value for a single observation", () => {
    expect(quantile([7], 0.25)).toBe(7);
    expect(quantile([7], 0.99)).toBe(7);
  });

  it("returns null for no values", () => {
    expect(quantile([], 0.5)).toBeNull();
  });

  it("does not reorder the caller's array", () => {
    const values = [3, 1, 2];
    quantile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  it("rejects a probability outside [0, 1]", () => {
    expect(() => quantile([1, 2], 1.5)).toThrow(/between 0 and 1/);
    expect(() => quantile([1, 2], -0.1)).toThrow(/between 0 and 1/);
    expect(() => quantile([1, 2], Number.NaN)).toThrow(/must be a number/);
  });
});

describe("percentile", () => {
  it("agrees with quantile on the same probability", () => {
    for (const p of [0, 10, 25, 50, 75, 90, 100]) {
      expect(percentile(SAMPLE, p)).toBe(quantile(SAMPLE, p / 100));
    }
  });

  it("computes known percentiles without float drift", () => {
    // p / 100 pre-division would yield 3.4000000000000004 here.
    expect(percentile(SAMPLE, 10)).toBe(3.4);
    expect(percentile(SAMPLE, 90)).toBe(7.6);
  });

  it("rejects a percentile outside [0, 100]", () => {
    expect(() => percentile([1, 2], 100.5)).toThrow(/between 0 and 100/);
    expect(() => percentile([1, 2], -1)).toThrow(/between 0 and 100/);
  });
});

describe("quartiles", () => {
  it("returns the three quartiles", () => {
    expect(quartiles(SAMPLE)).toEqual({ q1: 4, q2: 4.5, q3: 5.5 });
  });

  it("treats a single value as all three quartiles", () => {
    expect(quartiles([5])).toEqual({ q1: 5, q2: 5, q3: 5 });
  });

  it("returns null for no values", () => {
    expect(quartiles([])).toBeNull();
  });
});

describe("iqr", () => {
  it("is the distance between the quartiles", () => {
    expect(iqr(SAMPLE)).toBe(1.5);
    expect(iqr([1, 2, 3, 4, 5])).toBe(2);
  });

  it("is zero for a single value and null for none", () => {
    expect(iqr([5])).toBe(0);
    expect(iqr([])).toBeNull();
  });
});

describe("mode", () => {
  it("finds the most frequent value", () => {
    expect(mode([1, 2, 2, 3])).toBe(2);
    expect(mode(["a", "b", "a"])).toBe("a");
    expect(mode([true, false, true])).toBe(true);
  });

  it("breaks ties by first appearance", () => {
    expect(mode([3, 3, 1, 1])).toBe(3);
    expect(mode([1, 1, 3, 3])).toBe(1);
  });

  it("distinguishes null-ish values by type", () => {
    expect(mode(["null", "null"])).toBe("null");
    expect(mode([1, 1, "1"])).toBe(1);
  });

  it("returns null for no values", () => {
    expect(mode([])).toBeNull();
  });

  it("returns a copy, so callers cannot mutate their input", () => {
    const source = new Date("2026-05-05");
    const result = mode([source, new Date("2026-05-05")]) as Date;
    result.setFullYear(1990);
    expect(source.getFullYear()).toBe(2026);
  });

  it("compares dates by value, not identity", () => {
    const first = new Date("2026-01-01");
    expect(mode([new Date("2026-01-01"), first, new Date("2026-02-01")])).toEqual(first);
  });
});

describe("range", () => {
  it("is max minus min", () => {
    expect(range(SAMPLE)).toBe(7);
    expect(range([-5, 5])).toBe(10);
    expect(range([4])).toBe(0);
  });

  it("returns null for no values", () => {
    expect(range([])).toBeNull();
  });
});

describe("extremes", () => {
  it("finds the smallest and largest numbers", () => {
    expect(extremes([3, 1, 4, 1, 5])).toEqual({ min: 1, max: 5 });
  });

  it("uses the same ordering as Dataset.sort for text", () => {
    expect(extremes(["pear", "apple", "fig"])).toEqual({ min: "apple", max: "pear" });
  });

  it("orders booleans false before true", () => {
    expect(extremes([true, false])).toEqual({ min: false, max: true });
  });

  it("orders dates chronologically", () => {
    const result = extremes([new Date("2026-03-01"), new Date("2025-01-01")]);
    expect(result).toEqual({ min: new Date("2025-01-01"), max: new Date("2026-03-01") });
  });

  it("returns null for no values", () => {
    expect(extremes([])).toBeNull();
  });
});
