import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { columnKind } from "../../src/analytics/describe.js";
import { iqr, mode, percentile, quantile } from "../../src/analytics/stats.js";
import { median } from "../../src/core/aggregate.js";
import { ColumnNotFoundError } from "../../src/errors/index.js";

const numbers = (values: readonly number[]) => createDataset(values.map((value) => ({ v: value })));

/** The reference sample, cross-checked against Python's `statistics` module. */
const SAMPLE = [2, 4, 4, 4, 5, 5, 7, 9];

describe("describe: overloads", () => {
  it("returns a description for no argument", () => {
    const description = createDataset([{ a: 1 }, { a: 2 }]).describe();
    expect(description.rowCount).toBe(2);
    expect(description.columnCount).toBe(1);
    expect(description.profiles).toHaveLength(1);
  });

  it("returns a single profile for a column argument", () => {
    const profile = numbers(SAMPLE).describe("v");
    expect(profile.name).toBe("v");
    expect(profile.mean).toBe(5);
  });

  it("keeps profile order matching column order", () => {
    const data = createDataset([{ z: 1, a: "x", m: true }]);
    expect(data.describe().columns).toEqual(["z", "a", "m"]);
  });

  it("rejects an unknown column", () => {
    expect(() => numbers([1]).describe("nope")).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty column name", () => {
    expect(() => numbers([1]).describe("")).toThrow(/non-empty column name/);
  });
});

describe("describe: known numeric values", () => {
  const profile = numbers(SAMPLE).describe("v");

  it("counts values", () => {
    expect(profile.count).toBe(8);
    expect(profile.missing).toBe(0);
    expect(profile.total).toBe(8);
    expect(profile.unique).toBe(5);
  });

  it("computes sum, mean, and median", () => {
    expect(profile.sum).toBe(40);
    expect(profile.mean).toBe(5);
    expect(profile.median).toBe(4.5);
  });

  it("computes sample variance and standard deviation", () => {
    // Python: statistics.variance(SAMPLE) == 4.571428571428571
    expect(profile.variance).toBeCloseTo(4.571428571428571, 12);
    expect(profile.std).toBeCloseTo(2.138089935299395, 12);
  });

  it("computes quartiles and IQR", () => {
    expect(profile.q1).toBe(4);
    expect(profile.q3).toBe(5.5);
    expect(profile.iqr).toBe(1.5);
  });

  it("computes min, max, range, and mode", () => {
    expect(profile.min).toBe(2);
    expect(profile.max).toBe(9);
    expect(profile.range).toBe(7);
    expect(profile.mode).toBe(4);
  });

  it("defaults to the sample formula", () => {
    expect(profile.ddof).toBe(1);
  });
});

describe("describe: ddof", () => {
  it("uses the population formula when ddof is 0", () => {
    // Python: statistics.pvariance(SAMPLE) == 4, pstdev == 2
    const profile = numbers(SAMPLE).describe("v", { ddof: 0 });
    expect(profile.variance).toBeCloseTo(4, 12);
    expect(profile.std).toBeCloseTo(2, 12);
    expect(profile.ddof).toBe(0);
  });

  it("records the ddof used so a result is never ambiguous", () => {
    expect(numbers([1, 2, 3]).describe().ddof).toBe(1);
    expect(numbers([1, 2, 3]).describe("v", { ddof: 0 }).ddof).toBe(0);
  });

  it("rejects a negative or fractional ddof", () => {
    expect(() => numbers([1, 2]).describe("v", { ddof: -1 })).toThrow(/non-negative integer/);
    expect(() => numbers([1, 2]).describe("v", { ddof: 1.5 })).toThrow(/non-negative integer/);
  });
});

describe("describe: options for every column", () => {
  const data = createDataset([
    { a: 1, b: 2 },
    { a: 3, b: 4 },
  ]);

  it("accepts an options object in place of a column name", () => {
    const description = data.describe({ ddof: 0 });
    expect(description.ddof).toBe(0);
    expect(description.profiles.map((p) => p.ddof)).toEqual([0, 0]);
  });

  it("applies percentiles to every profile", () => {
    const description = data.describe({ percentiles: [50] });
    expect(description.get("a").percentiles["p50"]).toBe(2);
    expect(description.get("b").percentiles["p50"]).toBe(3);
  });

  it("validates options even when there are no columns to profile", () => {
    const empty = createDataset([]);
    expect(() => empty.describe({ ddof: -1 })).toThrow(/non-negative integer/);
    expect(() => empty.describe({ percentiles: [500] })).toThrow(/between 0 and 100/);
  });

  it("rejects a non-array percentiles option", () => {
    expect(() => data.describe({ percentiles: 90 as never })).toThrow(/must be an array/);
  });
});

describe("describe: toDataset includes percentiles", () => {
  const data = createDataset([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);

  it("names requested percentiles as columns", () => {
    const frame = data.describe({ percentiles: [25, 90] }).toDataset();
    expect(frame.columns).toContain("p25");
    expect(frame.columns).toContain("p90");
    expect(frame.data[0]?.["p90"]).toBeCloseTo(3.7);
  });

  it("omits percentile columns when none were requested", () => {
    expect(
      data
        .describe()
        .toDataset()
        .columns.some((c) => c.startsWith("p") && c !== "q1"),
    ).toBe(false);
  });
});

describe("describe: percentiles option", () => {
  it("computes requested percentiles", () => {
    const profile = numbers(SAMPLE).describe("v", { percentiles: [10, 90] });
    expect(profile.percentiles["p10"]).toBe(3.4);
    expect(profile.percentiles["p90"]).toBe(7.6);
  });

  it("returns an empty record when none are requested", () => {
    expect(numbers(SAMPLE).describe("v").percentiles).toEqual({});
  });

  it("rejects a percentile outside [0, 100]", () => {
    expect(() => numbers([1, 2]).describe("v", { percentiles: [101] })).toThrow(/between 0 and 100/);
  });

  it("reports null percentiles for a non-numeric column", () => {
    const data = createDataset([{ c: "a" }, { c: "b" }]);
    expect(data.describe("c", { percentiles: [50] }).percentiles["p50"]).toBeNull();
  });
});

describe("describe: missing values", () => {
  const data = createDataset([{ v: 1 }, { v: null }, { v: 3 }, { v: undefined }]);
  const profile = data.describe("v");

  it("counts present and missing separately", () => {
    expect(profile.count).toBe(2);
    expect(profile.missing).toBe(2);
    expect(profile.total).toBe(4);
  });

  it("excludes missing values from the arithmetic", () => {
    expect(profile.sum).toBe(4);
    expect(profile.mean).toBe(2);
    expect(profile.median).toBe(2);
  });
});

describe("describe: degenerate columns", () => {
  it("reports an all-null column as empty with every count of rows missing", () => {
    const profile = createDataset([{ v: null }, { v: null }, { v: null }]).describe("v");
    expect(profile.kind).toBe("empty");
    expect(profile.count).toBe(0);
    expect(profile.missing).toBe(3);
    expect(profile.total).toBe(3);
    expect(profile.unique).toBe(0);
    expect(profile.sum).toBeNull();
    expect(profile.mean).toBeNull();
    expect(profile.min).toBeNull();
    expect(profile.mode).toBeNull();
  });

  it("reports null sample variance for a single value", () => {
    const profile = numbers([5]).describe("v");
    expect(profile.count).toBe(1);
    expect(profile.variance).toBeNull();
    expect(profile.std).toBeNull();
    expect(profile.mean).toBe(5);
    expect(profile.q1).toBe(5);
    expect(profile.iqr).toBe(0);
    expect(profile.range).toBe(0);
  });

  it("describes a dataset with no rows", () => {
    const description = createDataset([] as { v: number }[]).describe();
    expect(description.rowCount).toBe(0);
    expect(description.profiles).toEqual([]);
    expect(description.columns).toEqual([]);
  });

  it("describes a dataset with no columns", () => {
    const description = createDataset([]).describe();
    expect(description.columnCount).toBe(0);
    expect(description.profiles).toEqual([]);
  });
});

describe("describe: non-numeric columns", () => {
  it("gives a categorical column counts, mode, and bounds but no arithmetic", () => {
    const data = createDataset([{ c: "a" }, { c: "b" }, { c: "a" }, { c: null }]);
    const profile = data.describe("c");
    expect(profile.kind).toBe("categorical");
    expect(profile.count).toBe(3);
    expect(profile.missing).toBe(1);
    expect(profile.unique).toBe(2);
    expect(profile.mode).toBe("a");
    expect(profile.min).toBe("a");
    expect(profile.max).toBe("b");
    expect(profile.sum).toBeNull();
    expect(profile.mean).toBeNull();
    expect(profile.median).toBeNull();
    expect(profile.variance).toBeNull();
    expect(profile.range).toBeNull();
    expect(profile.q1).toBeNull();
  });

  it("gives a boolean column counts and bounds but no arithmetic", () => {
    const profile = createDataset([{ b: true }, { b: false }, { b: true }]).describe("b");
    expect(profile.kind).toBe("boolean");
    expect(profile.min).toBe(false);
    expect(profile.max).toBe(true);
    expect(profile.mode).toBe(true);
    expect(profile.sum).toBeNull();
    expect(profile.mean).toBeNull();
  });

  it("gives a date column chronological bounds but no arithmetic", () => {
    const data = createDataset([
      { d: new Date("2026-03-01") },
      { d: new Date("2025-01-01") },
      { d: new Date("2026-01-15") },
    ]);
    const profile = data.describe("d");
    expect(profile.kind).toBe("temporal");
    expect(profile.min).toEqual(new Date("2025-01-01"));
    expect(profile.max).toEqual(new Date("2026-03-01"));
    expect(profile.sum).toBeNull();
    expect(profile.range).toBeNull();
  });

  it("gives a mixed column counts and mode but no arithmetic", () => {
    const profile = createDataset([{ m: 1 }, { m: "two" }, { m: true }]).describe("m");
    expect(profile.kind).toBe("mixed");
    expect(profile.count).toBe(3);
    expect(profile.mode).toBe(1);
    expect(profile.sum).toBeNull();
    expect(profile.mean).toBeNull();
  });

  it("classifies every dtype", () => {
    expect(columnKind("number")).toBe("numeric");
    expect(columnKind("integer")).toBe("numeric");
    expect(columnKind("boolean")).toBe("boolean");
    expect(columnKind("date")).toBe("temporal");
    expect(columnKind("datetime")).toBe("temporal");
    expect(columnKind("time")).toBe("temporal");
    expect(columnKind("string")).toBe("categorical");
    expect(columnKind("mixed")).toBe("mixed");
    expect(columnKind("unknown")).toBe("empty");
  });
});

describe("describe: numerical precision", () => {
  it("computes variance accurately for large means", () => {
    // The one-pass E[x^2] - E[x]^2 formula returns 0 here; two-pass returns 1.
    const profile = numbers([1000000001, 1000000002, 1000000003]).describe("v");
    expect(profile.variance).toBeCloseTo(1, 10);
    expect(profile.std).toBeCloseTo(1, 10);
  });

  it("sums with compensation so small terms are not lost", () => {
    expect(numbers([1e16, 1, -1e16]).describe("v").sum).toBe(1);
  });

  it("sums repeated decimals exactly", () => {
    const tenths = Array.from({ length: 10 }, () => 0.1);
    expect(numbers(tenths).describe("v").sum).toBe(1);
  });

  it("handles a single very large value", () => {
    const profile = numbers([Number.MAX_SAFE_INTEGER]).describe("v");
    expect(profile.sum).toBe(Number.MAX_SAFE_INTEGER);
    expect(profile.mean).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("describe: immutability", () => {
  it("does not modify the source dataset", () => {
    const data = numbers([3, 1, 2]);
    data.describe();
    data.describe("v");
    expect(data.data).toEqual([{ v: 3 }, { v: 1 }, { v: 2 }]);
  });

  it("returns copies, so mutating a profile cannot corrupt the dataset", () => {
    const data = createDataset([{ d: new Date("2026-01-01") }, { d: new Date("2026-02-01") }]);
    const profile = data.describe("d");
    (profile.max as Date).setFullYear(1999);
    expect((data.describe("d").max as Date).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("DatasetDescription: access", () => {
  const data = createDataset([
    { n: 1, s: "x" },
    { n: 2, s: "y" },
  ]);
  const description = data.describe();

  it("looks up a profile by name", () => {
    expect(description.get("n").mean).toBe(1.5);
    expect(description.get("s").kind).toBe("categorical");
  });

  it("throws ColumnNotFoundError for an unknown column", () => {
    expect(() => description.get("nope")).toThrow(ColumnNotFoundError);
  });

  it("renders a table with one row per column", () => {
    const table = description.table();
    expect(table).toContain("column");
    expect(table).toContain("missing");
    expect(table.split("\n").length).toBeGreaterThan(3);
  });

  it("converts to a Dataset with every statistic", () => {
    const summary = description.toDataset();
    expect(summary.rowCount).toBe(2);
    expect(summary.columns).toContain("mean");
    expect(summary.columns).toContain("iqr");
    expect(summary.columns).toContain("ddof");
    expect(summary.data[0]?.["name"]).toBe("n");
  });

  it("serializes to JSON", () => {
    const json = description.toJSON();
    expect(json.rowCount).toBe(2);
    expect(json.ddof).toBe(1);
    expect(json.profiles).toHaveLength(2);
  });
});

describe("describe: equivalence with reference statistics", () => {
  // The profile now shares one sort and one frequency pass across all statistics.
  // These checks pin the values against the standalone reference functions, so a future
  // change to the sharing cannot quietly alter a number.
  const COLUMN = [2, 4, 4, 4, 5, 5, 7, 9];
  const data = createDataset(COLUMN.map((value) => ({ v: value })));

  it("matches the standalone statistic functions", () => {
    const profile = data.describe("v");
    expect(profile.median).toBe(median(COLUMN));
    expect(profile.q1).toBe(quantile(COLUMN, 0.25));
    expect(profile.q3).toBe(quantile(COLUMN, 0.75));
    expect(profile.iqr).toBe(iqr(COLUMN));
    expect(profile.unique).toBe(new Set(COLUMN).size);
    expect(profile.mode).toBe(mode(COLUMN));
  });

  it("matches extra percentiles computed one at a time", () => {
    const profile = data.describe("v", { percentiles: [10, 90] });
    expect(profile.percentiles.p10).toBe(percentile(COLUMN, 10));
    expect(profile.percentiles.p90).toBe(percentile(COLUMN, 90));
  });

  it("reports null, not zero, for statistics a text column cannot have", () => {
    const text = createDataset([{ v: "a" }, { v: "b" }]).describe("v");
    expect(text.median).toBeNull();
    expect(text.q1).toBeNull();
    expect(text.iqr).toBeNull();
    expect(text.sum).toBeNull();
    expect(text.unique).toBe(2);
    expect(text.mode).toBe("a");
  });

  it("keeps unique and mode correct when missing cells are present", () => {
    const profile = createDataset([{ v: 1 }, { v: null }, { v: 1 }, { v: 3 }]).describe("v");
    expect(profile.count).toBe(3);
    expect(profile.missing).toBe(1);
    expect(profile.unique).toBe(2);
    expect(profile.mode).toBe(1);
  });

  it("agrees on a column with a single distinct value", () => {
    const profile = createDataset([{ v: 5 }, { v: 5 }, { v: 5 }]).describe("v");
    expect(profile.median).toBe(5);
    expect(profile.q1).toBe(5);
    expect(profile.q3).toBe(5);
    expect(profile.iqr).toBe(0);
    expect(profile.std).toBe(0);
  });
});
