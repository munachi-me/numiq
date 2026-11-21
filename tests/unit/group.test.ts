import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const sales = () =>
  createDataset([
    { region: "North", product: "A", revenue: 100, qty: 1 },
    { region: "North", product: "B", revenue: 200, qty: 2 },
    { region: "South", product: "A", revenue: 50, qty: 3 },
    { region: "South", product: "A", revenue: 150, qty: 4 },
    { region: "East", product: "B", revenue: 300, qty: 5 },
  ]);

const byRegion = () => sales().groupBy("region");

describe("groupBy: structure", () => {
  it("returns a GroupedDataset without computing", () => {
    expect(byRegion().columns).toEqual(["region"]);
  });

  it("reports the group count", () => {
    expect(byRegion().groupCount).toBe(3);
  });

  it("reports the underlying row count", () => {
    expect(byRegion().rowCount).toBe(5);
  });

  it("reports group sizes in group order", () => {
    expect(byRegion().sizes).toEqual([2, 2, 1]);
  });

  it("reports group keys in first-appearance order", () => {
    expect(byRegion().keys).toEqual([{ region: "North" }, { region: "South" }, { region: "East" }]);
  });

  it("accepts several grouping columns", () => {
    const grouped = sales().groupBy("region", "product");
    expect(grouped.columns).toEqual(["region", "product"]);
    // North/A is absent, so four distinct combinations exist.
    expect(grouped.groupCount).toBe(4);
  });

  it("accepts an array of columns as well as separate arguments", () => {
    expect(sales().groupBy(["region", "product"]).groupCount).toBe(4);
  });

  it("rejects no columns", () => {
    expect(() => sales().groupBy()).toThrow(/at least one column/);
  });

  it("rejects an unknown column", () => {
    expect(() => sales().groupBy("nope")).toThrow(ColumnNotFoundError);
  });

  it("rejects a repeated column", () => {
    expect(() => sales().groupBy("region", "region")).toThrow(/same column twice/);
  });

  it("rejects an empty column name", () => {
    expect(() => sales().groupBy("")).toThrow(/non-empty/);
  });
});

describe("groupBy: deterministic ordering", () => {
  it("keeps first-appearance order rather than sorting", () => {
    const data = createDataset([{ k: "z" }, { k: "a" }, { k: "m" }]);
    expect(data.groupBy("k").keys).toEqual([{ k: "z" }, { k: "a" }, { k: "m" }]);
  });

  it("is stable across repeated calls", () => {
    const grouped = sales().groupBy("region");
    expect(grouped.keys).toEqual(grouped.keys);
  });

  it("is stable for multi-column keys", () => {
    const data = createDataset([
      { a: "x", b: 1 },
      { a: "y", b: 2 },
      { a: "x", b: 2 },
      { a: "x", b: 1 },
    ]);
    expect(data.groupBy("a", "b").keys).toEqual([
      { a: "x", b: 1 },
      { a: "y", b: 2 },
      { a: "x", b: 2 },
    ]);
  });
});

describe("groupBy: null keys", () => {
  const gappy = () =>
    createDataset([
      { region: "North", revenue: 100 },
      { region: null, revenue: 10 },
      { region: "North", revenue: 200 },
      { region: undefined, revenue: 20 },
    ]);

  it("keeps missing keys as their own group instead of dropping them", () => {
    expect(gappy().groupBy("region").groupCount).toBe(2);
  });

  it("groups null and undefined keys together", () => {
    const grouped = gappy().groupBy("region");
    expect(grouped.sizes).toEqual([2, 2]);
  });

  it("reports a null key for the missing group", () => {
    expect(gappy().groupBy("region").keys).toEqual([{ region: "North" }, { region: null }]);
  });

  it("aggregates the missing group", () => {
    const out = gappy()
      .groupBy("region")
      .aggregate({ total: { column: "revenue", op: "sum" } });
    expect(out.data).toEqual([
      { region: "North", total: 300 },
      { region: null, total: 30 },
    ]);
  });

  it("can be filtered out afterwards", () => {
    const out = gappy()
      .groupBy("region")
      .aggregate({ total: { column: "revenue", op: "sum" } });
    const kept = out.query().where("region", "isNotNull").execute();
    expect(kept.data).toEqual([{ region: "North", total: 300 }]);
  });

  it("treats a missing key in one column of a pair as its own group", () => {
    const data = createDataset([
      { a: "x", b: null },
      { a: "x", b: "y" },
      { a: null, b: "y" },
    ]);
    expect(data.groupBy("a", "b").groupCount).toBe(3);
  });
});

describe("groupBy: aggregate shape", () => {
  it("returns a Dataset", () => {
    const out = byRegion().aggregate({ n: { op: "count" } });
    expect(out.constructor.name).toBe("Dataset");
  });

  it("puts grouping columns first, then spec keys in order", () => {
    const out = byRegion().aggregate({
      total: { column: "revenue", op: "sum" },
      n: { op: "count" },
    });
    expect(out.columns).toEqual(["region", "total", "n"]);
  });

  it("produces one row per group", () => {
    expect(byRegion().aggregate({ n: { op: "count" } }).rowCount).toBe(3);
  });

  it("drops the import report", () => {
    expect(byRegion().aggregate({ n: { op: "count" } }).importReport).toBeNull();
  });

  it("does not modify the source dataset", () => {
    const source = sales();
    const before = source.data;
    source.groupBy("region").aggregate({ n: { op: "count" } });
    expect(source.data).toEqual(before);
  });

  it("rejects an empty spec", () => {
    expect(() => byRegion().aggregate({})).toThrow(/at least one aggregation/);
  });

  it("rejects an output name that collides with a grouping column", () => {
    expect(() => byRegion().aggregate({ region: { op: "count" } })).toThrow(/collides/);
  });

  it("rejects an empty output name", () => {
    expect(() => byRegion().aggregate({ "": { op: "count" } })).toThrow(/non-empty/);
  });
});

describe("groupBy: every aggregation against known values", () => {
  // North revenue is [100, 200]: sum 300, mean 150, median 150, min 100, max 200.
  // Sample variance of [100, 200] is ((100-150)^2 + (200-150)^2) / 1 = 5000.
  const north = () =>
    byRegion().aggregate({
      total: { column: "revenue", op: "sum" },
      average: { column: "revenue", op: "mean" },
      middle: { column: "revenue", op: "median" },
      smallest: { column: "revenue", op: "min" },
      largest: { column: "revenue", op: "max" },
      firstValue: { column: "revenue", op: "first" },
      lastValue: { column: "revenue", op: "last" },
      distinct: { column: "revenue", op: "nunique" },
      spread: { column: "revenue", op: "variance" },
      deviation: { column: "revenue", op: "std" },
      rows: { op: "count" },
    });

  it("computes count", () => {
    expect(north().data[0]?.rows).toBe(2);
  });

  it("computes sum", () => {
    expect(north().data[0]?.total).toBe(300);
  });

  it("computes mean", () => {
    expect(north().data[0]?.average).toBe(150);
  });

  it("computes median", () => {
    expect(north().data[0]?.middle).toBe(150);
  });

  it("computes min", () => {
    expect(north().data[0]?.smallest).toBe(100);
  });

  it("computes max", () => {
    expect(north().data[0]?.largest).toBe(200);
  });

  it("computes first in source order", () => {
    expect(north().data[0]?.firstValue).toBe(100);
  });

  it("computes last in source order", () => {
    expect(north().data[0]?.lastValue).toBe(200);
  });

  it("computes nunique", () => {
    expect(north().data[0]?.distinct).toBe(2);
  });

  it("computes sample variance", () => {
    expect(north().data[0]?.spread).toBe(5000);
  });

  it("computes sample std", () => {
    expect(north().data[0]?.deviation).toBeCloseTo(Math.sqrt(5000), 10);
  });

  it("computes the South group, which has repeated product but distinct revenue", () => {
    const south = north().data[1];
    expect(south).toEqual({
      region: "South",
      total: 200,
      average: 100,
      middle: 100,
      smallest: 50,
      largest: 150,
      firstValue: 50,
      lastValue: 150,
      distinct: 2,
      spread: 5000,
      deviation: Math.sqrt(5000),
      rows: 2,
    });
  });
});

describe("groupBy: dispersion options", () => {
  it("supports population variance via ddof 0", () => {
    const out = byRegion().aggregate({
      population: { column: "revenue", op: "variance", ddof: 0 },
    });
    // North [100,200]: 5000 / 2 = 2500
    expect(out.data[0]?.population).toBe(2500);
  });

  it("supports population std via ddof 0", () => {
    const out = byRegion().aggregate({ population: { column: "revenue", op: "std", ddof: 0 } });
    expect(out.data[0]?.population).toBeCloseTo(Math.sqrt(2500), 10);
  });

  it("rejects a negative ddof", () => {
    expect(() => byRegion().aggregate({ v: { column: "revenue", op: "std", ddof: -1 } })).toThrow(/ddof/);
  });

  it("rejects a fractional ddof", () => {
    expect(() => byRegion().aggregate({ v: { column: "revenue", op: "std", ddof: 0.5 } })).toThrow(/ddof/);
  });
});

describe("groupBy: noncalculatable results", () => {
  it("returns null for sample variance of a single row", () => {
    const out = byRegion().aggregate({ spread: { column: "revenue", op: "variance" } });
    // East has one row.
    expect(out.data[2]?.spread).toBeNull();
  });

  it("returns null for sample std of a single row", () => {
    const out = byRegion().aggregate({ deviation: { column: "revenue", op: "std" } });
    expect(out.data[2]?.deviation).toBeNull();
  });

  it("still returns a numeric mean for a single row", () => {
    const out = byRegion().aggregate({ average: { column: "revenue", op: "mean" } });
    expect(out.data[2]?.average).toBe(300);
  });

  it("returns 0 for a population variance of a single row", () => {
    const out = byRegion().aggregate({ spread: { column: "revenue", op: "variance", ddof: 0 } });
    expect(out.data[2]?.spread).toBe(0);
  });
});

describe("groupBy: missing values inside groups", () => {
  const withGaps = () =>
    createDataset([
      { k: "a", v: 1 },
      { k: "a", v: null },
      { k: "a", v: 3 },
      { k: "b", v: null },
      { k: "b", v: null },
    ]);

  it("excludes missing cells from mean", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ m: { column: "v", op: "mean" } });
    expect(out.data[0]?.m).toBe(2);
  });

  it("excludes missing cells from sum", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ s: { column: "v", op: "sum" } });
    expect(out.data[0]?.s).toBe(4);
  });

  it("excludes missing cells from count of a column", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ n: { column: "v", op: "count" } });
    expect(out.data[0]?.n).toBe(2);
  });

  it("counts rows, not present cells, when no column is given", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ n: { op: "count" } });
    expect(out.data[0]?.n).toBe(3);
  });

  it("returns null for an all-missing group's mean", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ m: { column: "v", op: "mean" } });
    expect(out.data[1]?.m).toBeNull();
  });

  it("returns 0 for an all-missing group's sum", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ s: { column: "v", op: "sum" } });
    expect(out.data[1]?.s).toBe(0);
  });

  it("returns null for an all-missing group's median", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ m: { column: "v", op: "median" } });
    expect(out.data[1]?.m).toBeNull();
  });

  it("returns null for an all-missing group's min and max", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({
        lo: { column: "v", op: "min" },
        hi: { column: "v", op: "max" },
      });
    expect(out.data[1]).toEqual({ k: "b", lo: null, hi: null });
  });

  it("returns 0 distinct for an all-missing group", () => {
    const out = withGaps()
      .groupBy("k")
      .aggregate({ d: { column: "v", op: "nunique" } });
    expect(out.data[1]?.d).toBe(0);
  });
});

describe("groupBy: numeric validation", () => {
  const mixed = () => createDataset([{ k: "a", label: "x", v: 1 }]);

  it("rejects sum on a text column", () => {
    expect(() =>
      mixed()
        .groupBy("k")
        .aggregate({ s: { column: "label", op: "sum" } }),
    ).toThrow(/numeric/);
  });

  it("rejects mean on a text column", () => {
    expect(() =>
      mixed()
        .groupBy("k")
        .aggregate({ m: { column: "label", op: "mean" } }),
    ).toThrow(/numeric/);
  });

  it("rejects median on a text column", () => {
    expect(() =>
      mixed()
        .groupBy("k")
        .aggregate({ m: { column: "label", op: "median" } }),
    ).toThrow(/numeric/);
  });

  it("rejects std on a text column", () => {
    expect(() =>
      mixed()
        .groupBy("k")
        .aggregate({ s: { column: "label", op: "std" } }),
    ).toThrow(/numeric/);
  });

  it("allows min and max on a text column", () => {
    const out = mixed()
      .groupBy("k")
      .aggregate({
        lo: { column: "label", op: "min" },
        hi: { column: "label", op: "max" },
      });
    expect(out.data[0]).toEqual({ k: "a", lo: "x", hi: "x" });
  });

  it("allows count and nunique on a text column", () => {
    const out = mixed()
      .groupBy("k")
      .aggregate({
        n: { column: "label", op: "count" },
        d: { column: "label", op: "nunique" },
      });
    expect(out.data[0]).toEqual({ k: "a", n: 1, d: 1 });
  });

  it("allows min and max on a date column", () => {
    const data = createDataset([
      { k: "a", when: "2024-01-05" },
      { k: "a", when: "2024-03-01" },
    ]);
    const out = data.groupBy("k").aggregate({
      lo: { column: "when", op: "min" },
      hi: { column: "when", op: "max" },
    });
    expect(out.data[0]).toEqual({ k: "a", lo: "2024-01-05", hi: "2024-03-01" });
  });
});

describe("groupBy: spec validation", () => {
  it("rejects an unknown operation", () => {
    expect(() => byRegion().aggregate({ x: { op: "median2" } as never })).toThrow(/unknown operation/);
  });

  it("rejects a missing column for a non-count operation", () => {
    expect(() => byRegion().aggregate({ x: { op: "sum" } })).toThrow(/needs a column/);
  });

  it("rejects an unknown column", () => {
    expect(() => byRegion().aggregate({ x: { column: "nope", op: "sum" } })).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty column name", () => {
    expect(() => byRegion().aggregate({ x: { column: "", op: "sum" } })).toThrow(/invalid column name/);
  });

  it("rejects a null entry", () => {
    expect(() => byRegion().aggregate({ x: null as never })).toThrow(ValidationError);
  });

  it("validates the whole spec before computing anything", () => {
    // The second entry is invalid, so no partial result should be produced.
    expect(() =>
      byRegion().aggregate({
        ok: { column: "revenue", op: "sum" },
        bad: { column: "nope", op: "sum" },
      }),
    ).toThrow(ColumnNotFoundError);
  });
});

describe("groupBy: custom aggregators", () => {
  it("supports a bare callback receiving the group's rows", () => {
    const out = byRegion().aggregate({
      products: (rows) => rows.map((row) => row.product).join("+"),
    });
    expect(out.data[0]?.products).toBe("A+B");
    expect(out.data[1]?.products).toBe("A+A");
  });

  it("supports a column-bound callback receiving present values", () => {
    const out = byRegion().aggregate({
      range: {
        column: "revenue",
        fn: (values) => Math.max(...(values as number[])) - Math.min(...(values as number[])),
      },
    });
    expect(out.data[0]?.range).toBe(100);
  });

  it("excludes missing values from a column-bound callback", () => {
    const data = createDataset([
      { k: "a", v: 1 },
      { k: "a", v: null },
      { k: "a", v: 3 },
    ]);
    const out = data.groupBy("k").aggregate({ seen: { column: "v", fn: (values) => values.length } });
    expect(out.data[0]?.seen).toBe(2);
  });

  it("passes the column name and rows in the context", () => {
    const out = byRegion().aggregate({
      meta: { column: "revenue", fn: (values, context) => `${context.column}:${values.length}:${context.rows.length}` },
    });
    expect(out.data[0]?.meta).toBe("revenue:2:2");
  });

  it("reports a null column for a whole-group callback", () => {
    const out = byRegion().aggregate({
      meta: (_values, context) => `${String(context.column)}:${context.rows.length}`,
    });
    expect(out.data[0]?.meta).toBe("null:2");
  });

  it("hands out frozen copies, so a callback cannot corrupt the source", () => {
    const source = sales();
    const before = source.data;
    byRegion().aggregate({
      attempt: (rows) => {
        expect(Object.isFrozen(rows)).toBe(true);
        expect(Object.isFrozen(rows[0])).toBe(true);
        expect(() => {
          (rows[0] as Record<string, unknown>).revenue = 999;
        }).toThrow(TypeError);
        return rows.length;
      },
    });
    expect(source.data).toEqual(before);
  });

  it("validates a column-bound callback's column", () => {
    expect(() => byRegion().aggregate({ x: { column: "nope", fn: () => 1 } })).toThrow(ColumnNotFoundError);
  });
});

describe("groupBy: empty and degenerate datasets", () => {
  it("aggregates an empty dataset to no rows", () => {
    const empty = createDataset([], { columns: ["k", "v"] });
    const out = empty.groupBy("k").aggregate({ n: { op: "count" } });
    expect(out.rowCount).toBe(0);
    expect(out.columns).toEqual(["k", "n"]);
  });

  it("reports zero groups for an empty dataset", () => {
    expect(createDataset([], { columns: ["k"] }).groupBy("k").groupCount).toBe(0);
  });

  it("handles a single group", () => {
    const data = createDataset([
      { k: "only", v: 1 },
      { k: "only", v: 2 },
    ]);
    expect(data.groupBy("k").aggregate({ s: { column: "v", op: "sum" } }).data).toEqual([{ k: "only", s: 3 }]);
  });

  it("handles one row per group", () => {
    const data = createDataset([
      { k: "a", v: 1 },
      { k: "b", v: 2 },
    ]);
    expect(data.groupBy("k").groupCount).toBe(2);
  });
});

describe("groupBy: composability", () => {
  it("feeds an aggregate result back into a query", () => {
    const out = byRegion()
      .aggregate({ total: { column: "revenue", op: "sum" } })
      .query()
      .where("total", ">", 250)
      .orderBy("total", "desc")
      .execute();
    // Both totals are 300, so ordering keeps the earlier group first.
    expect(out.data).toEqual([
      { region: "North", total: 300 },
      { region: "East", total: 300 },
    ]);
  });

  it("sorts an aggregate result", () => {
    const out = byRegion()
      .aggregate({ total: { column: "revenue", op: "sum" } })
      .sort("total", "asc");
    expect(out.data.map((row) => row.region)).toEqual(["South", "North", "East"]);
  });

  it("groups a query result", () => {
    const out = sales()
      .query()
      .where("revenue", ">", 60)
      .execute()
      .groupBy("region")
      .aggregate({ n: { op: "count" } });
    expect(out.data).toEqual([
      { region: "North", n: 2 },
      { region: "South", n: 1 },
      { region: "East", n: 1 },
    ]);
  });

  it("groups a prepared dataset", () => {
    const out = sales()
      .drop(["product"])
      .groupBy("region")
      .aggregate({ total: { column: "revenue", op: "sum" } });
    expect(out.rowCount).toBe(3);
  });

  it("can be aggregated twice from one grouped value", () => {
    const grouped = byRegion();
    const a = grouped.aggregate({ total: { column: "revenue", op: "sum" } });
    const b = grouped.aggregate({ n: { op: "count" } });
    expect(a.columns).toEqual(["region", "total"]);
    expect(b.columns).toEqual(["region", "n"]);
  });
});

describe("groupBy: toDataset and mapGroups", () => {
  it("returns the grouped rows with keys first", () => {
    const out = byRegion().toDataset();
    expect(out.columns).toEqual(["region", "product", "revenue", "qty"]);
    expect(out.rowCount).toBe(5);
  });

  it("orders rows by group, keeping source order within each group", () => {
    const out = byRegion().toDataset();
    expect(out.data.map((row) => row.region)).toEqual(["North", "North", "South", "South", "East"]);
  });

  it("maps each group and concatenates the results", () => {
    const out = byRegion().mapGroups((rows, key) => [{ region: key.region, n: rows.length, first: rows[0]?.product }]);
    expect(out.data).toEqual([
      { region: "North", n: 2, first: "A" },
      { region: "South", n: 2, first: "A" },
      { region: "East", n: 1, first: "B" },
    ]);
  });

  it("rejects a non-function for mapGroups", () => {
    expect(() => byRegion().mapGroups(5 as never)).toThrow(/function/);
  });

  it("rejects a callback that does not return an array", () => {
    expect(() => byRegion().mapGroups(() => ({}) as never)).toThrow(/array of rows/);
  });
});

describe("groupBy: key encoding", () => {
  it("keeps keys distinct when a value contains the separator", () => {
    // Concatenating raw key values lets a separator inside a value forge a boundary, which
    // would merge two unrelated groups and double their counts.
    const data = createDataset([
      { a: "x\u0000string:y", b: "z" },
      { a: "x", b: "y\u0000string:z" },
    ]);

    const grouped = data.groupBy("a", "b");
    expect(grouped.groupCount).toBe(2);
    expect(grouped.sizes).toEqual([1, 1]);
    expect(grouped.aggregate({ n: { op: "count" } }).data).toEqual([
      { a: "x\u0000string:y", b: "z", n: 1 },
      { a: "x", b: "y\u0000string:z", n: 1 },
    ]);
  });

  it('keeps null distinct from the string "null"', () => {
    // The type tag in `stableKey` is what separates these; a bare `String(value)` would merge them.
    const data = createDataset([{ k: null }, { k: "null" }, { k: "undefined" }, { k: undefined }]);

    expect(data.groupBy("k").groupCount).toBe(3);
  });
});
