import { describe, it, expect } from "vitest";
import { cohortAnalysis, percentChange, stratifiedSample, systematicSample } from "../../src/core/analysis.js";
import { createDataset } from "../../src/core/dataset.js";

const rows = Array.from({ length: 100 }, (_, index) => ({
  id: index,
  group: index % 4 === 0 ? "d" : index % 2 === 0 ? "b" : "a",
  value: index,
}));

describe("stratifiedSample", () => {
  it("draws the requested total and keeps every stratum present", () => {
    const result = stratifiedSample(rows, ["id", "group", "value"], 20, ["group"]);
    expect(result.rows).toHaveLength(20);
    const groups = new Set(result.rows.map((row) => row.group));
    expect(groups.size).toBe(3);
  });

  it("allocates proportionally", () => {
    const balanced = Array.from({ length: 90 }, (_, index) => ({ g: index < 30 ? "x" : index < 60 ? "y" : "z" }));
    const result = stratifiedSample(balanced, ["g"], 30, ["g"]);
    const counts = result.rows.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.g);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.x).toBe(10);
    expect(counts.y).toBe(10);
    expect(counts.z).toBe(10);
  });

  it("gives a small stratum at least one row", () => {
    const skewed = [...Array.from({ length: 99 }, () => ({ g: "big" })), { g: "tiny" }];
    const result = stratifiedSample(skewed, ["g"], 10, ["g"]);
    expect(result.rows.some((row) => row.g === "tiny")).toBe(true);
  });

  it("is reproducible with a seed", () => {
    const first = stratifiedSample(rows, ["id", "group"], 20, ["group"], { seed: 42 });
    const second = stratifiedSample(rows, ["id", "group"], 20, ["group"], { seed: 42 });
    expect(first.rows.map((row) => row.id)).toEqual(second.rows.map((row) => row.id));
  });

  it("differs with a different seed", () => {
    const first = stratifiedSample(rows, ["id"], 20, ["group"], { seed: 1 });
    const second = stratifiedSample(rows, ["id"], 20, ["group"], { seed: 2 });
    expect(first.rows.map((row) => row.id)).not.toEqual(second.rows.map((row) => row.id));
  });

  it("supports multiple strata columns", () => {
    const data = Array.from({ length: 40 }, (_, index) => ({
      a: index % 2 === 0 ? "x" : "y",
      b: index % 4 < 2 ? "p" : "q",
    }));
    const result = stratifiedSample(data, ["a", "b"], 8, ["a", "b"]);
    const cells = new Set(result.rows.map((row) => `${String(row.a)}${String(row.b)}`));
    expect(cells.size).toBe(4);
  });

  it("validates its arguments", () => {
    expect(() => stratifiedSample(rows, ["id"], -1, ["group"])).toThrow(/non-negative/);
    expect(() => stratifiedSample(rows, ["id"], 5, [])).toThrow(/strata/);
    expect(() => stratifiedSample([], ["id"], 5, ["group"])).toThrow(/empty/);
    expect(() => stratifiedSample(rows, ["id"], 200, ["group"])).toThrow(/without replacement/);
  });

  it("returns an empty result for size zero", () => {
    const result = stratifiedSample(rows, ["id"], 0, ["group"]);
    expect(result.rows).toHaveLength(0);
    expect(result.columns).toContain("id");
  });
});

describe("systematicSample", () => {
  it("takes every interval-th row", () => {
    const result = systematicSample(rows, ["id"], 10, { seed: 0 });
    expect(result.rows).toHaveLength(10);
    const ids = result.rows.map((row) => row.id as number);
    for (let index = 1; index < ids.length; index += 1) {
      expect((ids[index] as number) - (ids[index - 1] as number)).toBe(10);
    }
  });

  it("starts within the first interval", () => {
    const result = systematicSample(rows, ["id"], 10, { seed: 7 });
    const first = result.rows[0]?.id as number;
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10);
  });

  it("drops the incomplete final cycle", () => {
    // 105 rows, interval 10 -> 10 full cycles; rows 100-104 form a partial cycle.
    const uneven = Array.from({ length: 105 }, (_, index) => ({ id: index }));
    const result = systematicSample(uneven, ["id"], 10, { seed: 0 });
    expect(result.rows).toHaveLength(10);
  });

  it("always takes exactly floor(n / interval) rows, whatever the start", () => {
    const uneven = Array.from({ length: 105 }, (_, index) => ({ id: index }));
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(systematicSample(uneven, ["id"], 10, { seed }).rows).toHaveLength(10);
    }
  });

  it("is reproducible with a seed", () => {
    const first = systematicSample(rows, ["id"], 7, { seed: 3 });
    const second = systematicSample(rows, ["id"], 7, { seed: 3 });
    expect(first.rows.map((row) => row.id)).toEqual(second.rows.map((row) => row.id));
  });

  it("rejects a non-positive interval", () => {
    expect(() => systematicSample(rows, ["id"], 0)).toThrow(/at least 1/);
    expect(() => systematicSample(rows, ["id"], 2.5)).toThrow(/integer/);
  });
});

describe("percentChange", () => {
  it("computes period-over-period percentage change", () => {
    expect(percentChange([100, 110, 99])).toEqual([null, 10, -10]);
  });

  it("uses the absolute previous value so the sign is intuitive", () => {
    // From -100 to -50 is a rise of 50%, not a fall.
    const result = percentChange([-100, -50]);
    expect(result[1]).toBeCloseTo(50, 10);
  });

  it("returns null where the previous value is missing or zero", () => {
    expect(percentChange([0, 5])).toEqual([null, null]);
    expect(percentChange([null, 5])).toEqual([null, null]);
    expect(percentChange([5, null])).toEqual([null, null]);
  });

  it("always starts with null", () => {
    expect(percentChange([1, 2, 3])[0]).toBeNull();
  });

  it("ignores non-numeric entries", () => {
    expect(percentChange([10, "x", 20])).toEqual([null, null, null]);
  });
});

describe("Dataset sampling and change helpers", () => {
  it("stratifiedSample returns a Dataset", () => {
    const data = createDataset(rows);
    const sample = data.stratifiedSample(20, "group", { seed: 5 });
    expect(sample.rowCount).toBe(20);
    expect(sample.columns).toEqual(data.columns);
  });

  it("systematicSample returns a Dataset", () => {
    const data = createDataset(rows);
    const sample = data.systematicSample(10, { seed: 5 });
    expect(sample.rowCount).toBe(10);
  });

  it("percentChange adds a column", () => {
    const data = createDataset([{ v: 100 }, { v: 150 }, { v: 120 }]);
    const withChange = data.percentChange("v");
    expect(withChange.columns).toContain("v_pctChange");
    expect(withChange.column("v_pctChange").values).toEqual([null, 50, -20]);
  });

  it("percentChange accepts a custom column name", () => {
    const data = createDataset([{ v: 1 }, { v: 2 }]);
    expect(data.percentChange("v", "growth").columns).toContain("growth");
  });

  it("stratifiedSample rejects an unknown strata column", () => {
    const data = createDataset(rows);
    expect(() => data.stratifiedSample(10, "nope")).toThrow(/nope/);
  });
});

describe("cohortAnalysis", () => {
  const events = [
    { customer: "a", when: "2024-01-05", amount: 10 },
    { customer: "a", when: "2024-01-20", amount: 20 },
    { customer: "a", when: "2024-02-10", amount: 30 },
    { customer: "b", when: "2024-01-15", amount: 40 },
    { customer: "b", when: "2024-02-15", amount: 50 },
    { customer: "b", when: "2024-02-20", amount: 60 },
  ];

  it("groups into cohort by period cells", () => {
    const result = cohortAnalysis(events, {
      cohort: "customer",
      time: "when",
      interval: "month",
      metrics: [{ column: "amount", operation: "sum" }],
    });
    expect(result.columns).toEqual(["customer", "period", "rows", "amount_sum"]);
    // a: Jan (2 rows, 30), Feb (1 row, 30); b: Jan (1 row, 40), Feb (2 rows, 110)
    const aJan = result.rows.find((row) => row.customer === "a" && row.period === "2024-01");
    expect(aJan?.amount_sum).toBe(30);
    expect(aJan?.rows).toBe(2);
    const bFeb = result.rows.find((row) => row.customer === "b" && row.period === "2024-02");
    expect(bFeb?.amount_sum).toBe(110);
  });

  it("orders by cohort first-appearance then ascending period", () => {
    const result = cohortAnalysis(events, {
      cohort: "customer",
      time: "when",
      metrics: [{ column: "amount", operation: "sum" }],
    });
    expect(result.rows.map((row) => `${String(row.customer)}:${String(row.period)}`)).toEqual([
      "a:2024-01",
      "a:2024-02",
      "b:2024-01",
      "b:2024-02",
    ]);
  });

  it("supports every metric operation", () => {
    const result = cohortAnalysis(events, {
      cohort: "customer",
      time: "when",
      interval: "month",
      metrics: [
        { column: "amount", operation: "sum", name: "total" },
        { column: "amount", operation: "mean", name: "avg" },
        { column: "amount", operation: "count", name: "n" },
        { column: "amount", operation: "min", name: "low" },
        { column: "amount", operation: "max", name: "high" },
      ],
    });
    const aJan = result.rows.find((row) => row.customer === "a" && row.period === "2024-01");
    expect(aJan?.total).toBe(30);
    expect(aJan?.avg).toBe(15);
    expect(aJan?.n).toBe(2);
    expect(aJan?.low).toBe(10);
    expect(aJan?.high).toBe(20);
  });

  it("throws on a time value it cannot parse rather than dropping the row", () => {
    const withBad = [...events, { customer: "c", when: "not-a-date", amount: 99 }];
    expect(() =>
      cohortAnalysis(withBad, {
        cohort: "customer",
        time: "when",
        metrics: [{ column: "amount", operation: "sum" }],
      }),
    ).toThrow(/not an ISO date/);
  });

  it("returns null for a cell with no numeric values", () => {
    const result = cohortAnalysis([{ customer: "a", when: "2024-01-05", amount: null }], {
      cohort: "customer",
      time: "when",
      metrics: [{ column: "amount", operation: "mean" }],
    });
    expect(result.rows[0]?.amount_mean).toBeNull();
    expect(result.rows[0]?.rows).toBe(1);
  });

  it("rejects an empty metric list or unknown operation", () => {
    expect(() => cohortAnalysis(events, { cohort: "customer", time: "when", metrics: [] })).toThrow(
      /at least one metric/,
    );
    expect(() =>
      cohortAnalysis(events, {
        cohort: "customer",
        time: "when",
        metrics: [{ column: "amount", operation: "median" as never }],
      }),
    ).toThrow(/does not support/);
  });

  it("Dataset.cohort validates its columns", () => {
    const data = createDataset(events);
    expect(() =>
      data.cohort({ cohort: "nope", time: "when", metrics: [{ column: "amount", operation: "sum" }] }),
    ).toThrow(/nope/);
    expect(() =>
      data.cohort({ cohort: "customer", time: "when", metrics: [{ column: "nope", operation: "sum" }] }),
    ).toThrow(/nope/);
  });

  it("Dataset.cohort produces a usable dataset", () => {
    const data = createDataset(events);
    const result = data.cohort({
      cohort: "customer",
      time: "when",
      interval: "month",
      metrics: [{ column: "amount", operation: "sum" }],
    });
    expect(result.rowCount).toBe(4);
    expect(result.columns).toEqual(["customer", "period", "rows", "amount_sum"]);
  });
});
