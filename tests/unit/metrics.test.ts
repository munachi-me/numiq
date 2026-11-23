import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { Metric, createMetric, isAggregationOp } from "../../src/metrics/metric.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const DATA = createDataset([
  { region: "north", revenue: 10, qty: 1 },
  { region: "north", revenue: 20, qty: 2 },
  { region: "south", revenue: 30, qty: 3 },
  { region: "south", revenue: 40, qty: 4 },
  { region: "east", revenue: 50, qty: 5 },
]);

const WITH_GAPS = createDataset([
  { region: "north", revenue: 10 },
  { region: "north", revenue: null },
  { region: "south", revenue: 30 },
]);

describe("Metric definitions", () => {
  it("computes a built-in aggregation and exposes its definition", () => {
    const revenue = DATA.createMetric({ name: "Total Revenue", column: "revenue", aggregation: "sum" });
    expect(revenue.name).toBe("Total Revenue");
    expect(revenue.value).toBe(150);
    expect(revenue.definition).toBe('sum("revenue")');
    expect(revenue.aggregation).toBe("sum");
    expect(revenue.column).toBe("revenue");
  });

  it("returns a structured metric result with the evidence", () => {
    const revenue = DATA.createMetric({ name: "Total Revenue", column: "revenue", aggregation: "sum" });
    expect(revenue.metric).toEqual({ value: 150, rows: 5, values: 5, reason: null });
  });

  it("counts rows when no column is given", () => {
    const orders = DATA.createMetric({ name: "Orders", aggregation: "count" });
    expect(orders.value).toBe(5);
    expect(orders.definition).toBe("count(rows)");
  });

  it("agrees with GroupedDataset aggregation over the same column", () => {
    const metric = DATA.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const grouped = DATA.groupBy("region").aggregate({ revenue: { column: "revenue", op: "sum" } });
    const fromMetric = new Map(metric.byGroup().groups.map((group) => [group.key.region, group.value]));
    for (const row of grouped.data) {
      expect(fromMetric.get(row.region)).toBe(row.revenue);
    }
  });

  it("reports present values only, never counting a gap as zero", () => {
    const revenue = WITH_GAPS.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    expect(revenue.value).toBe(40);
    expect(revenue.metric).toEqual({ value: 40, rows: 3, values: 2, reason: null });
  });

  it("carries format hints without applying them", () => {
    const metric = DATA.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      format: { prefix: "$", decimals: 2, unit: "currency" },
    });
    expect(metric.format).toEqual({ prefix: "$", decimals: 2, unit: "currency" });
    // The value is never rescaled or rounded by a hint.
    expect(metric.value).toBe(150);
  });

  it("preserves arbitrary metadata", () => {
    const metric = DATA.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      metadata: { owner: "finance", tier: 1 },
    });
    expect(metric.metadata).toEqual({ owner: "finance", tier: 1 });
  });

  it("honours ddof for dispersion aggregations", () => {
    const sample = DATA.createMetric({ name: "Var", column: "qty", aggregation: "variance" });
    const population = DATA.createMetric({ name: "Var", column: "qty", aggregation: "variance", ddof: 0 });
    expect(sample.value).toBeCloseTo(2.5, 10);
    expect(population.value).toBeCloseTo(2, 10);
    expect(sample.definition).toBe('variance("qty") (ddof 1)');
  });
});

describe("Metric validation", () => {
  it("rejects an empty name", () => {
    expect(() => DATA.createMetric({ name: "", column: "revenue", aggregation: "sum" })).toThrow(ValidationError);
    expect(() => DATA.createMetric({ name: "   ", column: "revenue", aggregation: "sum" })).toThrow(/non-empty name/);
  });

  it("rejects an unknown aggregation", () => {
    expect(() =>
      // @ts-expect-error unknown aggregation is rejected at runtime too
      DATA.createMetric({ name: "Bad", column: "revenue", aggregation: "total" }),
    ).toThrow(/unknown aggregation/);
  });

  it("rejects a missing column by name", () => {
    expect(() => DATA.createMetric({ name: "Bad", column: "nope", aggregation: "sum" })).toThrow(ColumnNotFoundError);
    expect(() => DATA.createMetric({ name: "Bad", column: "nope", aggregation: "sum" })).toThrow(/nope/);
  });

  it("rejects an aggregation that needs a column but has none", () => {
    expect(() => DATA.createMetric({ name: "Bad", aggregation: "sum" })).toThrow(/needs a column/);
  });

  it("rejects a negative ddof", () => {
    expect(() => DATA.createMetric({ name: "Bad", column: "qty", aggregation: "std", ddof: -1 })).toThrow(/ddof/);
  });

  it("rejects a spec with both or neither calculation", () => {
    expect(() =>
      DATA.createMetric({
        name: "Both",
        column: "revenue",
        aggregation: "sum",
        // @ts-expect-error a spec cannot carry both shapes
        fn: () => 1,
      }),
    ).toThrow(/exactly one of/);
  });
});

describe("Metric custom callbacks", () => {
  it("computes over a bound column's present values", () => {
    const metric = DATA.createMetric({
      name: "Revenue range",
      column: "revenue",
      fn: (values) => {
        const numbers = values as number[];
        return Math.max(...numbers) - Math.min(...numbers);
      },
    });
    expect(metric.value).toBe(40);
    expect(metric.definition).toBe('custom("revenue")');
  });

  it("computes over whole rows when no column is bound", () => {
    const metric = DATA.createMetric({
      name: "Revenue per item",
      fn: (rows) => {
        let revenue = 0;
        let qty = 0;
        for (const row of rows) {
          revenue += row.revenue as number;
          qty += row.qty as number;
        }
        return revenue / qty;
      },
    });
    expect(metric.value).toBe(10);
    expect(metric.definition).toBe("custom(rows)");
  });

  it("gives the callback its context", () => {
    let seen: { column: string | null; columns: readonly string[] } | null = null;
    DATA.createMetric({
      name: "Context",
      column: "revenue",
      fn: (_values, context) => {
        seen = { column: context.column, columns: context.columns };
        return null;
      },
    });
    expect(seen).toEqual({ column: "revenue", columns: ["region", "revenue", "qty"] });
  });

  it("freezes the rows so a callback cannot corrupt the source", () => {
    const metric = DATA.createMetric({
      name: "Mutation",
      fn: (rows) => {
        expect(() => {
          (rows[0] as Record<string, unknown>).revenue = 999;
        }).toThrow();
        return rows.length;
      },
    });
    expect(metric.value).toBe(5);
    expect(DATA.data[0]?.revenue).toBe(10);
  });
});

describe("Metric grouped calculation", () => {
  it("computes one value per group in first-appearance order", () => {
    const metric = DATA.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const grouped = metric.byGroup();
    expect(grouped.groupBy).toEqual(["region"]);
    expect(grouped.groupCount).toBe(3);
    expect(grouped.groups.map((group) => [group.key.region, group.value])).toEqual([
      ["north", 30],
      ["south", 70],
      ["east", 50],
    ]);
  });

  it("reports each group's row and value counts", () => {
    const metric = WITH_GAPS.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const north = metric.byGroup().groups[0];
    expect(north).toMatchObject({ rows: 2, values: 1, value: 10, reason: null });
  });

  it("refuses to guess a grouping", () => {
    const metric = DATA.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    expect(() => metric.byGroup()).toThrow(ValidationError);
    expect(() => metric.byGroup()).toThrow(/no groupBy columns/);
  });

  it("rejects a groupBy column that does not exist", () => {
    expect(() => DATA.createMetric({ name: "Bad", column: "revenue", aggregation: "sum", groupBy: ["nope"] })).toThrow(
      ColumnNotFoundError,
    );
  });

  it("produces a table named after the metric", () => {
    const metric = DATA.createMetric({
      name: "Revenue",
      column: "revenue",
      aggregation: "sum",
      groupBy: ["region"],
    });
    const table = metric.toDataset();
    expect(table.columns).toEqual(["region", "Revenue"]);
    expect(table.rows).toEqual([
      { region: "north", Revenue: 30 },
      { region: "south", Revenue: 70 },
      { region: "east", Revenue: 50 },
    ]);
  });
});

describe("Metric recalculation", () => {
  it("recomputes against new data without mutating the original", () => {
    const metric = DATA.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    const doubled = createDataset([
      { region: "north", revenue: 100, qty: 1 },
      { region: "south", revenue: 200, qty: 2 },
    ]);
    const recalculated = metric.recalculate(doubled.data, doubled.columns);
    expect(recalculated.value).toBe(300);
    expect(metric.value).toBe(150);
    expect(recalculated.name).toBe(metric.name);
    expect(recalculated.definition).toBe(metric.definition);
  });

  it("recalculates a custom metric by reusing its callback", () => {
    const metric = DATA.createMetric({
      name: "Rows",
      fn: (rows) => rows.length,
    });
    const smaller = createDataset([{ region: "north", revenue: 1, qty: 1 }]);
    expect(metric.recalculate(smaller.data, smaller.columns).value).toBe(1);
  });

  it("throws when the new data lacks a needed column", () => {
    const metric = DATA.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    const other = createDataset([{ other: 1 }]);
    expect(() => metric.recalculate(other.data, other.columns)).toThrow(ColumnNotFoundError);
  });
});

describe("Metric comparison", () => {
  it("compares against another metric", () => {
    const total = DATA.createMetric({ name: "Total", column: "revenue", aggregation: "sum" });
    const half = createDataset([{ region: "north", revenue: 75, qty: 1 }]).createMetric({
      name: "Half",
      column: "revenue",
      aggregation: "sum",
    });
    const comparison = total.compare({ to: half.metric, label: "half" });
    expect(comparison.other).toBe("half");
    expect(comparison.difference).toBe(75);
    expect(comparison.ratio).toBe(2);
    expect(comparison.percentChange).toBe(200);
    expect(comparison.percentDifference).toBe(100);
    expect(comparison.reason).toBeNull();
  });

  it("compares against a bare number", () => {
    const total = DATA.createMetric({ name: "Total", column: "revenue", aggregation: "sum" });
    expect(total.compare({ to: 100 })).toMatchObject({
      difference: 50,
      ratio: 1.5,
      percentChange: 150,
      percentDifference: 50,
    });
  });

  it("refuses to divide by a zero baseline", () => {
    const zero = createDataset([{ region: "north", revenue: 0, qty: 1 }]).createMetric({
      name: "Zero",
      column: "revenue",
      aggregation: "sum",
    });
    const comparison = zero.compare({ to: 0 });
    expect(comparison.ratio).toBeNull();
    expect(comparison.percentChange).toBeNull();
    expect(comparison.percentDifference).toBeNull();
    expect(comparison.reason).toBe("zero-baseline");
  });

  it("reports not-numeric instead of inventing a number", () => {
    const text = DATA.createMetric({ name: "First", column: "region", aggregation: "first" });
    const comparison = text.compare({ to: 1 });
    expect(comparison.difference).toBeNull();
    expect(comparison.reason).toBe("not-numeric");
  });
});

describe("Metric degenerate inputs", () => {
  it("returns null with a reason for an empty dataset", () => {
    const empty = DATA.limit(0);
    const metric = empty.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    expect(metric.value).toBeNull();
    expect(metric.metric).toEqual({ value: null, rows: 0, values: 0, reason: "empty" });
  });

  it("returns null with a reason when every value is missing", () => {
    const allNull = createDataset([{ revenue: null }, { revenue: null }]);
    const metric = allNull.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    expect(metric.metric.reason).toBe("no-values");
  });

  it("returns null with a reason when a numeric aggregation meets text", () => {
    const text = createDataset([{ label: "a" }, { label: "b" }]);
    const metric = text.createMetric({ name: "Sum", column: "label", aggregation: "sum" });
    expect(metric.value).toBeNull();
    expect(metric.metric.reason).toBe("not-numeric");
  });

  it("serialises without losing the definition", () => {
    const metric = DATA.createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" });
    expect(JSON.parse(JSON.stringify(metric))).toMatchObject({
      name: "Revenue",
      value: 150,
      definition: 'sum("revenue")',
      rows: 5,
      values: 5,
      reason: null,
    });
  });
});

describe("createMetric and isAggregationOp", () => {
  it("builds a Metric from bare rows", () => {
    const metric = createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" }, DATA.data, DATA.columns);
    expect(metric).toBeInstanceOf(Metric);
    expect(metric.value).toBe(150);
  });

  it("recognises exactly the built-in aggregations", () => {
    for (const op of ["count", "sum", "mean", "min", "max", "median", "first", "last", "nunique", "std", "variance"]) {
      expect(isAggregationOp(op)).toBe(true);
    }
    for (const op of ["total", "avg", "", "SUM", null, 1]) {
      expect(isAggregationOp(op)).toBe(false);
    }
  });
});
