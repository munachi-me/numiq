import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const sales = () => [
  { region: "north", day: "2026-11-01", amount: 10 },
  { region: "north", day: "2026-11-02", amount: 20 },
  { region: "north", day: "2026-11-03", amount: 30 },
  { region: "south", day: "2026-11-01", amount: 100 },
  { region: "south", day: "2026-11-02", amount: 200 },
];

describe("rowNumber", () => {
  it("numbers rows within a partition", () => {
    const result = createDataset(sales()).rowNumber("n", { partitionBy: "region", orderBy: "day" });
    expect(result.column("n").values).toEqual([1, 2, 3, 1, 2]);
  });

  it("numbers across the whole dataset when there is no partition", () => {
    const data = createDataset([{ v: 5 }, { v: 3 }, { v: 9 }]);
    expect(data.rowNumber("n", { orderBy: "v" }).column("n").values).toEqual([2, 1, 3]);
  });

  it("requires an explicit order", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rowNumber("n", {} as never)).toThrow(ValidationError);
    expect(() => data.rowNumber("n", {} as never)).toThrow(/requires an explicit orderBy/);
  });

  it("rejects a column that already exists", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rowNumber("v", { orderBy: "v" })).toThrow(/already exists/);
  });

  it("rejects an unknown ordering column", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rowNumber("n", { orderBy: "nope" })).toThrow(ColumnNotFoundError);
  });

  it("rejects an unknown partition column", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rowNumber("n", { partitionBy: "nope", orderBy: "v" })).toThrow(ColumnNotFoundError);
  });
});

describe("rank and denseRank", () => {
  const tied = () => [{ s: 10 }, { s: 20 }, { s: 20 }, { s: 30 }];

  it("rank leaves a gap after a tie", () => {
    expect(createDataset(tied()).rank("r", { orderBy: "s" }).column("r").values).toEqual([1, 2, 2, 4]);
  });

  it("denseRank has no gap after a tie", () => {
    expect(createDataset(tied()).denseRank("r", { orderBy: "s" }).column("r").values).toEqual([1, 2, 2, 3]);
  });

  it("ranks descending when asked", () => {
    expect(
      createDataset(tied())
        .rank("r", { orderBy: { column: "s", direction: "desc" } })
        .column("r").values,
    ).toEqual([4, 2, 2, 1]);
  });

  it("ranks within partitions independently", () => {
    const result = createDataset(sales()).rank("r", {
      partitionBy: "region",
      orderBy: { column: "amount", direction: "desc" },
    });
    expect(result.column("r").values).toEqual([3, 2, 1, 2, 1]);
  });

  it("treats missing values as tied with each other and last", () => {
    const data = createDataset([{ s: 5 }, { s: null }, { s: 1 }, { s: null }]);
    expect(data.rank("r", { orderBy: "s" }).column("r").values).toEqual([2, 3, 1, 3]);
  });

  it("ranks ties on every key of a composite order", () => {
    const data = createDataset([
      { a: 1, b: 1 },
      { a: 1, b: 2 },
      { a: 1, b: 2 },
    ]);
    const result = data.denseRank("r", { orderBy: ["a", "b"] });
    expect(result.column("r").values).toEqual([1, 2, 2]);
  });
});

describe("rankRows", () => {
  it("returns positions in ranked order", () => {
    const data = createDataset([{ s: 10 }, { s: 30 }, { s: 20 }]);
    expect(data.rankRows({ orderBy: "s" })).toEqual([
      { index: 0, rank: 1 },
      { index: 2, rank: 2 },
      { index: 1, rank: 3 },
    ]);
  });
});

describe("lag and lead", () => {
  it("reads the previous value within a partition", () => {
    const result = createDataset(sales()).lag("prev", "amount", { partitionBy: "region", orderBy: "day" });
    expect(result.column("prev").values).toEqual([null, 10, 20, null, 100]);
  });

  it("reads the next value within a partition", () => {
    const result = createDataset(sales()).lead("next", "amount", { partitionBy: "region", orderBy: "day" });
    expect(result.column("next").values).toEqual([20, 30, null, 200, null]);
  });

  it("honours an explicit offset", () => {
    const result = createDataset(sales()).lag("prev2", "amount", { partitionBy: "region", orderBy: "day", offset: 2 });
    expect(result.column("prev2").values).toEqual([null, null, 10, null, null]);
  });

  it("fills rows with no counterpart using the given value", () => {
    const result = createDataset(sales()).lead("next", "amount", { partitionBy: "region", orderBy: "day", fill: 0 });
    expect(result.column("next").values).toEqual([20, 30, 0, 200, 0]);
  });

  it("uses null when no fill is given", () => {
    const result = createDataset([{ v: 1 }]).lag("prev", "v", { orderBy: "v" });
    expect(result.column("prev").values).toEqual([null]);
  });

  it("does not leak across partition boundaries", () => {
    const result = createDataset(sales()).lag("prev", "amount", { partitionBy: "region", orderBy: "day" });
    // south's first row must not see north's last amount
    expect(result.column("prev").values[3]).toBeNull();
  });

  it("rejects a negative or fractional offset", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.lag("p", "v", { orderBy: "v", offset: -1 })).toThrow(/non-negative integer/);
    expect(() => data.lag("p", "v", { orderBy: "v", offset: 1.5 })).toThrow(/non-negative integer/);
  });

  it("rejects an unknown source column", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.lag("p", "nope", { orderBy: "v" })).toThrow(ColumnNotFoundError);
  });
});

describe("cumSum and cumMean", () => {
  it("accumulates within each partition", () => {
    const result = createDataset(sales()).cumSum("total", "amount", { partitionBy: "region", orderBy: "day" });
    expect(result.column("total").values).toEqual([10, 30, 60, 100, 300]);
  });

  it("averages progressively", () => {
    const result = createDataset(sales()).cumMean("avg", "amount", { partitionBy: "region", orderBy: "day" });
    expect(result.column("avg").values).toEqual([10, 15, 20, 100, 150]);
  });

  it("accumulates in order, not in input order", () => {
    const data = createDataset([
      { v: 30, t: 3 },
      { v: 10, t: 1 },
      { v: 20, t: 2 },
    ]);
    const result = data.cumSum("c", "v", { orderBy: "t" });
    // row order is preserved in the output; values follow the t order
    expect(result.data.map((row) => row.c)).toEqual([60, 10, 30]);
  });

  it("emits null from the first missing value when not ignoring missing", () => {
    // nulls order last, so the missing row is the final position in the window order
    const data = createDataset([{ v: 10 }, { v: null }, { v: 5 }]);
    expect(data.cumSum("c", "v", { orderBy: "v" }).column("c").values).toEqual([15, null, 5]);
  });

  it("skips missing values when ignoring them", () => {
    const data = createDataset([{ v: 10 }, { v: null }, { v: 5 }]);
    expect(data.cumSum("c", "v", { orderBy: "v", ignoreMissing: true }).column("c").values).toEqual([15, 15, 5]);
  });

  it("emits null before any observation exists", () => {
    const data = createDataset([{ v: null }, { v: 4 }]);
    expect(data.cumMean("c", "v", { orderBy: "v", ignoreMissing: true }).column("c").values).toEqual([4, 4]);
  });

  it("orders missing values last so they do not start the accumulation", () => {
    const data = createDataset([{ v: null }, { v: 4 }]);
    // the null sorts last, so it inherits the running total rather than resetting it
    expect(data.cumSum("c", "v", { orderBy: "v", ignoreMissing: true }).column("c").values).toEqual([4, 4]);
    expect(data.cumSum("c", "v", { orderBy: "v" }).column("c").values).toEqual([null, 4]);
  });
});

describe("rolling windows", () => {
  const series = () => [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }];

  it("sums a trailing window", () => {
    const result = createDataset(series()).rollingSum("r", "v", { orderBy: "v", window: 3 });
    expect(result.column("r").values).toEqual([null, null, 6, 9, 12]);
  });

  it("averages a trailing window", () => {
    const result = createDataset(series()).rollingMean("r", "v", { orderBy: "v", window: 2 });
    expect(result.column("r").values).toEqual([null, 1.5, 2.5, 3.5, 4.5]);
  });

  it("takes the trailing minimum and maximum", () => {
    const data = createDataset([{ v: 5 }, { v: 1 }, { v: 9 }, { v: 3 }]);
    // ordering by v makes the series 1, 3, 5, 9; results map back to input positions
    expect(data.rollingMin("r", "v", { orderBy: "v", window: 2 }).column("r").values).toEqual([3, null, 5, 1]);
    expect(data.rollingMax("r", "v", { orderBy: "v", window: 2 }).column("r").values).toEqual([5, null, 9, 3]);
  });

  it("computes a trailing sample standard deviation", () => {
    const data = createDataset([{ v: 2 }, { v: 4 }, { v: 4 }, { v: 4 }, { v: 5 }, { v: 5 }, { v: 7 }, { v: 9 }]);
    const result = data.rollingStd("r", "v", { orderBy: "v", window: 8 });
    // sample std of the whole series is sqrt(32/7)
    expect(result.column("r").values.at(-1)).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it("emits null for a window of one when measuring spread", () => {
    const data = createDataset([{ v: 1 }, { v: 2 }]);
    expect(data.rollingStd("r", "v", { orderBy: "v", window: 1 }).column("r").values).toEqual([null, null]);
  });

  it("honours minPeriods to allow a short leading window", () => {
    const result = createDataset(series()).rollingMean("r", "v", { orderBy: "v", window: 3, minPeriods: 1 });
    expect(result.column("r").values).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("does not cross a partition boundary", () => {
    const result = createDataset(sales()).rollingSum("r", "amount", {
      partitionBy: "region",
      orderBy: "day",
      window: 2,
    });
    expect(result.column("r").values).toEqual([null, 30, 50, null, 300]);
  });

  it("counts only present values toward minPeriods", () => {
    // ordered by v the series is 1, 3, null; the null is last and has one present
    // neighbour, which is short of minPeriods 2
    const data = createDataset([{ v: 1 }, { v: null }, { v: 3 }]);
    const result = data.rollingSum("r", "v", { orderBy: "v", window: 2, minPeriods: 2 });
    expect(result.column("r").values).toEqual([null, null, 4]);
  });

  it("rejects a window below one", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rollingSum("r", "v", { orderBy: "v", window: 0 })).toThrow(/positive integer/);
  });

  it("rejects minPeriods greater than the window", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.rollingSum("r", "v", { orderBy: "v", window: 2, minPeriods: 3 })).toThrow(/between 1 and window/);
  });
});

describe("window callback", () => {
  it("exposes row number, partition and ordered rows", () => {
    const result = createDataset(sales()).window("spread", {
      partitionBy: "region",
      orderBy: "day",
      fn: ({ row, rows, rowNumber }) => (rowNumber === 1 ? 0 : (row.amount as number) - (rows[0]?.amount as number)),
    });
    expect(result.column("spread").values).toEqual([0, 10, 20, 0, 100]);
  });

  it("requires a function", () => {
    const data = createDataset([{ v: 1 }]);
    expect(() => data.window("w", { orderBy: "v" } as never)).toThrow(/fn callback/);
  });
});

describe("immutability", () => {
  it("leaves the original dataset untouched", () => {
    const data = createDataset(sales());
    const before = data.data;
    data.rowNumber("n", { partitionBy: "region", orderBy: "day" });
    data.rollingSum("r", "amount", { partitionBy: "region", orderBy: "day", window: 2 });
    expect(data.data).toEqual(before);
    expect(data.columns).toEqual(["region", "day", "amount"]);
  });

  it("preserves row order while computing in sorted order", () => {
    const data = createDataset([
      { t: 2, v: 20 },
      { t: 1, v: 10 },
    ]);
    const result = data.cumSum("c", "v", { orderBy: "t" });
    expect(result.data.map((row) => row.t)).toEqual([2, 1]);
    expect(result.column("c").values).toEqual([30, 10]);
  });
});
