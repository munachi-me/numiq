import { describe, expect, it } from "vitest";
import { loadCSV } from "../../src/node.js";
import { useSampleDataset } from "../../src/core/sample.js";
import { createDataset } from "../../src/core/dataset.js";
import { ValidationError } from "../../src/errors/index.js";

describe("query on a loaded dataset", () => {
  it("filters, orders, and projects the bundled sample", async () => {
    const sample = await useSampleDataset();
    const original = sample.data;

    const result = sample
      .query()
      .where("revenue", ">", 0)
      .orderBy("revenue", "desc")
      .select(["order_id", "region", "revenue"])
      .limit(3)
      .execute();

    expect(result.columns).toEqual(["order_id", "region", "revenue"]);
    expect(result.rowCount).toBe(3);
    expect(result.importReport).toBeNull();
    // The source is untouched, and the projection is strictly narrower than it.
    expect(sample.data).toEqual(original);
    expect(sample.columns).toHaveLength(7);
  });

  it("orders the sample the same way Dataset.sort does", async () => {
    const sample = await useSampleDataset();
    const viaQuery = sample
      .query()
      .orderBy("revenue", "desc")
      .execute()
      .data.map((row) => row.order_id);
    const viaSort = sample.sort("revenue", "desc").data.map((row) => row.order_id);
    expect(viaQuery).toEqual(viaSort);
  });

  it("finds every row when the condition is a tautology", async () => {
    const sample = await useSampleDataset();
    const result = sample.query().where("order_id", "isNotNull").execute();
    expect(result.rowCount).toBe(sample.rowCount);
  });

  it("queries a CSV loaded from the dataset directory", async () => {
    const sales = await loadCSV("sales.csv");
    const result = sales.query().where("amount", ">", 0).execute();
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.columns).toEqual(["product", "amount", "ordered_on"]);
  });

  it("supports string operators on a loaded text column", async () => {
    const sales = await loadCSV("sales.csv");
    const products = sales
      .query()
      .where("product", "isNotNull")
      .execute()
      .data.map((row) => row.product);
    const needle = String(products[0] ?? "");
    const matched = sales.query().where("product", "contains", needle).execute();
    expect(matched.rowCount).toBeGreaterThan(0);
    for (const row of matched.data) expect(String(row.product)).toContain(needle);
  });

  it("filters on a date column loaded as ISO text", async () => {
    const sales = await loadCSV("sales.csv");
    expect(sales.dtypes.ordered_on).toBe("date");
    const all = sales.query().where("ordered_on", "isNotNull").execute();
    expect(all.rowCount).toBe(sales.rowCount);
    const late = sales.query().where("ordered_on", ">", "1900-01-01").execute();
    expect(late.rowCount).toBe(sales.rowCount);
  });

  it("compares a date column the same way before and after cast", async () => {
    const sales = await loadCSV("sales.csv");
    const asText = sales.query().where("ordered_on", ">", "1900-01-01").execute().rowCount;
    const asDate = sales.cast({ ordered_on: "date" }).query().where("ordered_on", ">", "1900-01-01").execute().rowCount;
    expect(asDate).toBe(asText);
  });

  it("rejects an unknown column against a loaded dataset", async () => {
    const sales = await loadCSV("sales.csv");
    expect(() => sales.query().where("nope", "=", 1)).toThrow(/nope/);
  });

  it("keeps a query reusable across executions against loaded data", async () => {
    const sales = await loadCSV("sales.csv");
    const query = sales.query().where("amount", ">", 0);
    const first = query.execute();
    const second = query.execute();
    expect(first.data).toEqual(second.data);
  });

  it("chains a query result into preparation", async () => {
    const sales = await loadCSV("sales.csv");
    const result = sales
      .query()
      .where("amount", "isNotNull")
      .execute()
      .rename({ amount: "value" })
      .drop(["ordered_on"]);
    expect(result.columns).toEqual(["product", "value"]);
  });

  it("validates bounds before scanning", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    expect(() => data.query().where("a", "between", [5, 1])).toThrow(ValidationError);
  });
});
