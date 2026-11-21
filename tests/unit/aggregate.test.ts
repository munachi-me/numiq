import { describe, expect, it } from "vitest";
import {
  first,
  last,
  max,
  mean,
  median,
  min,
  nunique,
  std,
  sum,
  toNumbers,
  variance,
} from "../../src/core/aggregate.js";

describe("sum", () => {
  it("adds simple values", () => {
    expect(sum([1, 2, 3])).toBe(6);
  });

  it("returns 0 for no values", () => {
    expect(sum([])).toBe(0);
  });

  it("handles negatives", () => {
    expect(sum([-5, 3, -2])).toBe(-4);
  });

  it("is compensated, not naive", () => {
    // Naive left-to-right addition loses the 1 and returns 0.
    expect(1e16 + 1 - 1e16).toBe(0);
    expect(sum([1e16, 1, -1e16])).toBe(1);
  });

  it("does not depend on term order", () => {
    expect(sum([-1e16, 1, 1e16])).toBe(sum([1e16, 1, -1e16]));
  });

  it("sums 0.1 ten times exactly, where naive addition drifts", () => {
    const tenths = Array.from({ length: 10 }, () => 0.1);
    expect(sum(tenths)).toBe(1);
    expect(tenths.reduce((a, b) => a + b, 0)).not.toBe(1);
  });
});

describe("mean", () => {
  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for no values", () => {
    expect(mean([])).toBeNull();
  });

  it("returns the value itself for a single observation", () => {
    expect(mean([7])).toBe(7);
  });
});

describe("median", () => {
  it("returns the middle value for an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("is insensitive to input order", () => {
    expect(median([9, 1, 5])).toBe(median([1, 5, 9]));
  });
});

describe("variance and std", () => {
  it("uses the sample formula by default", () => {
    // Deviations from mean 3 are -2, -1, 0, 1, 2 -> squared sum 10 -> /4 = 2.5
    expect(variance([1, 2, 3, 4, 5])).toBe(2.5);
  });

  it("uses the population formula when ddof is 0", () => {
    expect(variance([1, 2, 3, 4, 5], { ddof: 0 })).toBe(2);
  });

  it("returns null for a single observation with sample ddof", () => {
    expect(variance([42])).toBeNull();
  });

  it("returns 0 for a single observation with population ddof", () => {
    expect(variance([42], { ddof: 0 })).toBe(0);
  });

  it("returns null for no values", () => {
    expect(variance([])).toBeNull();
    expect(std([])).toBeNull();
  });

  it("returns 0 for identical values", () => {
    expect(variance([5, 5, 5])).toBe(0);
    expect(std([5, 5, 5])).toBe(0);
  });

  it("stays accurate when the mean dwarfs the spread", () => {
    // A one-pass E[x^2]-E[x]^2 formula returns 0 here.
    expect(variance([1000000001, 1000000002, 1000000003])).toBe(1);
  });

  it("stds the square root of the variance", () => {
    expect(std([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  it("accepts a population std", () => {
    expect(std([1, 2, 3, 4, 5], { ddof: 0 })).toBeCloseTo(Math.sqrt(2), 12);
  });
});

describe("min and max", () => {
  it("finds numeric extremes", () => {
    expect(min([3, 1, 2])).toBe(1);
    expect(max([3, 1, 2])).toBe(3);
  });

  it("finds text extremes", () => {
    expect(min(["pear", "apple", "fig"])).toBe("apple");
    expect(max(["pear", "apple", "fig"])).toBe("pear");
  });

  it("orders dates chronologically", () => {
    const early = new Date("2024-01-01");
    const late = new Date("2024-06-01");
    expect(min([late, early])).toEqual(early);
    expect(max([late, early])).toEqual(late);
  });

  it("orders booleans as false before true", () => {
    expect(min([true, false])).toBe(false);
    expect(max([true, false])).toBe(true);
  });

  it("returns null for no values", () => {
    expect(min([])).toBeNull();
    expect(max([])).toBeNull();
  });

  it("returns the only value for one value", () => {
    expect(min([9])).toBe(9);
    expect(max([9])).toBe(9);
  });
});

describe("first and last", () => {
  it("returns the source-order ends", () => {
    expect(first([7, 8, 9])).toBe(7);
    expect(last([7, 8, 9])).toBe(9);
  });

  it("returns null for no values", () => {
    expect(first([])).toBeNull();
    expect(last([])).toBeNull();
  });

  it("keeps text as text", () => {
    expect(first(["b", "a"])).toBe("b");
  });
});

describe("nunique", () => {
  it("counts distinct values", () => {
    expect(nunique([1, 1, 2, 3])).toBe(3);
  });

  it("returns 0 for no values", () => {
    expect(nunique([])).toBe(0);
  });

  it("distinguishes types that stringify alike", () => {
    expect(nunique([1, "1", true])).toBe(3);
  });

  it("treats dates by instant, not identity", () => {
    expect(nunique([new Date("2024-01-01"), new Date("2024-01-01")])).toBe(1);
  });
});

describe("toNumbers", () => {
  it("keeps finite numbers and drops everything else", () => {
    expect(toNumbers([1, "2", null, true, 3])).toEqual([1, 3]);
  });

  it("drops non-finite values", () => {
    expect(toNumbers([1, Number.NaN, Infinity, 2])).toEqual([1, 2]);
  });
});
