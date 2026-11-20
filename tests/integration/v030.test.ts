import { describe, it, expect } from "vitest";
import { loadCSV } from "../../src/node.js";
import { useSampleDataset } from "../../src/core/sample.js";
import { createDataset } from "../../src/core/dataset.js";

describe("preparation on a loaded dataset", () => {
  it("prepares the bundled sample without touching the source", async () => {
    const sample = await useSampleDataset();
    const original = sample.data;

    const prepared = sample
      .drop(["category"])
      .rename({ quantity: "units" })
      .addColumn("line_total", (row) => Number(row.units) * Number(row.revenue));

    expect(sample.columns).toEqual(["order_id", "date", "product", "category", "region", "quantity", "revenue"]);
    expect(prepared.columns).toEqual(["order_id", "date", "product", "region", "units", "revenue", "line_total"]);
    expect(sample.data).toEqual(original);
    expect(prepared.rowCount).toBe(sample.rowCount);
  });

  it("keeps the import report on the source and drops it on the result", async () => {
    const sales = await loadCSV("sales.csv");
    expect(sales.importReport).not.toBeNull();
    expect(sales.dropMissing().importReport).toBeNull();
  });

  it("casts a loaded column and preserves row count", async () => {
    const sales = await loadCSV("sales.csv");
    expect(sales.columns).toEqual(["product", "amount", "ordered_on"]);
    const cast = sales.cast({ product: "string", amount: "number", ordered_on: "date" });
    expect(cast.rowCount).toBe(sales.rowCount);
    expect(typeof cast.data[0]?.amount).toBe("number");
    expect(cast.data[0]?.ordered_on).toBeInstanceOf(Date);
  });

  it("filters then fills on real data", async () => {
    const sample = await useSampleDataset();
    const result = sample.filter((row) => Number(row.revenue) > 100).fillMissing({ revenue: 0 });
    expect(result.rowCount).toBeLessThanOrEqual(sample.rowCount);
    expect(result.data.every((row) => Number(row.revenue) > 100)).toBe(true);
    expect(result.rowCount).toBeGreaterThan(0);
  });

  it("de-duplicates a loaded dataset by a key column", async () => {
    const sales = await loadCSV("sales.csv");
    const uniqueProducts = sales.dropDuplicates(["product"]);
    expect(uniqueProducts.rowCount).toBe(sales.distinct("product").length);
  });

  it("samples a loaded dataset reproducibly", async () => {
    const sales = await loadCSV("sales.csv");
    const first = sales.sample(2, { seed: 2024 }).data;
    const second = sales.sample(2, { seed: 2024 }).data;
    expect(first).toEqual(second);
    expect(first.length).toBe(2);
  });

  it("runs a full preparation chain on a loaded file", async () => {
    const sales = await loadCSV("sales.csv");
    const prepared = sales
      .select(["product", "amount"])
      .map("amount", (value) => Number(value))
      .filter((row) => Number(row.amount) > 0)
      .sort("amount", "desc")
      .dropDuplicates(["product"])
      .head(3);

    expect(prepared.columns).toEqual(["product", "amount"]);
    expect(prepared.rowCount).toBeLessThanOrEqual(3);
    const amounts = prepared.data.map((row) => Number(row.amount));
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });
});

describe("preparation edge cases", () => {
  it("handles an empty dataset through every method", () => {
    const empty = createDataset([], { columns: ["a", "b"] });
    expect(empty.drop(["b"]).columns).toEqual(["a"]);
    expect(empty.rename({ a: "x" }).columns).toEqual(["x", "b"]);
    expect(empty.dropMissing().rowCount).toBe(0);
    expect(empty.fillMissing({ a: 0 }).rowCount).toBe(0);
    expect(empty.replace({ a: { from: 1, to: 2 } }).rowCount).toBe(0);
    expect(empty.map("a", (value) => value).rowCount).toBe(0);
    expect(empty.addColumn("c", []).columns).toEqual(["a", "b", "c"]);
    expect(empty.cast({ a: "string" }).rowCount).toBe(0);
    expect(empty.dropDuplicates().rowCount).toBe(0);
    expect(empty.sample(0).rowCount).toBe(0);
  });

  it("handles a single-row dataset", () => {
    const one = createDataset([{ a: null }]);
    expect(one.fillMissing({ a: 7 }).data).toEqual([{ a: 7 }]);
    expect(one.dropDuplicates().rowCount).toBe(1);
  });

  it("handles a mixed-type column", () => {
    const mixed = createDataset([{ v: 1 }, { v: "text" }]);
    expect(mixed.schema.v?.type).toBe("mixed");
    expect(mixed.dropDuplicates().rowCount).toBe(2);
    expect(() => mixed.fillMissing({ v: "mean" })).toThrow(/needs a numeric column/);
  });

  it("does not share row objects between a source and its derivatives", () => {
    const source = createDataset([{ a: 1 }]);
    const derived = source.addColumn("b", () => 2);
    expect(derived.data[0]).not.toBe(source.data[0]);
    expect(Object.isFrozen(derived.data[0])).toBe(false);
  });

  it("returns copies, so mutating what a caller receives cannot corrupt the dataset", () => {
    const source = createDataset([{ a: 1 }]);
    const derived = source.map("a", (value) => Number(value) + 1);
    const row = derived.data[0] as Record<string, unknown>;
    row.a = 99;
    expect(derived.data[0]?.a).toBe(2);
  });
});
