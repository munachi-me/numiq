/**
 * End-to-end use of a data space: three related tables, one relationship each, and the
 * cross-dataset questions the 1.3.0 release is meant to answer.
 */
import { describe, expect, it } from "vitest";
import { createDataSpace, createDataset } from "../../src/index.js";

const customers = [
  { id: 1, name: "Ada", region: "north", segment: "enterprise" },
  { id: 2, name: "Grace", region: "south", segment: "smb" },
  { id: 3, name: "Alan", region: "north", segment: "smb" },
  { id: 4, name: "Edsger", region: "east", segment: "enterprise" },
];

const products = [
  { sku: "B1", category: "book", unit_price: 20 },
  { sku: "T1", category: "toy", unit_price: 35 },
  { sku: "T2", category: "toy", unit_price: 12 },
];

const orders = [
  { order_id: 100, customer_id: 1, sku: "B1", quantity: 2 },
  { order_id: 101, customer_id: 1, sku: "T1", quantity: 1 },
  { order_id: 102, customer_id: 2, sku: "T2", quantity: 5 },
  { order_id: 103, customer_id: 3, sku: "B1", quantity: 3 },
  { order_id: 104, customer_id: 1, sku: "T2", quantity: 1 },
];

function buildSpace() {
  const space = createDataSpace("Retail")
    .addDataset("customers", createDataset(customers, { name: "customers" }))
    .addDataset("products", createDataset(products, { name: "products" }))
    .addDataset("orders", createDataset(orders, { name: "orders" }));

  space.createRelationship({
    from: "orders",
    fromColumn: "customer_id",
    to: "customers",
    toColumn: "id",
    type: "many-to-one",
  });
  space.createRelationship({
    from: "orders",
    fromColumn: "sku",
    to: "products",
    toColumn: "sku",
    type: "many-to-one",
  });
  return space;
}

describe("retail data space", () => {
  it("holds three independent datasets", () => {
    const space = buildSpace();
    expect(space.datasetNames()).toEqual(["customers", "products", "orders"]);
    expect(space.dataset("orders").rowCount).toBe(5);
  });

  it("validates every relationship cleanly", () => {
    const checks = buildSpace().check();
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check.valid).toBe(true);
  });

  it("joins orders to customers without repeating key names", () => {
    const joined = buildSpace().join("orders", "customers");
    expect(joined.rowCount).toBe(5);
    expect(joined.columns).toEqual(
      expect.arrayContaining(["order_id", "customer_id", "sku", "quantity", "name", "region", "segment"]),
    );
  });

  it("joins orders to products", () => {
    const joined = buildSpace().join("orders", "products");
    expect(joined.rowCount).toBe(5);
    expect(joined.columns).toContain("category");
    expect(joined.columns).toContain("unit_price");
  });

  it("computes revenue by customer region across two relationships", () => {
    const space = buildSpace();
    // Revenue lives on neither table alone: quantity is on orders, price on products.
    const revenue = space
      .join("orders", "products")
      .addColumn("revenue", (row) => Number(row.quantity) * Number(row.unit_price));

    const byRegion = revenue
      .join(space.dataset("customers"), { leftOn: "customer_id", rightOn: "id", how: "left" })
      .groupBy("region")
      .aggregate({ revenue: { column: "revenue", op: "sum" } });

    const totals = new Map(byRegion.data.map((row) => [row.region, row.revenue]));
    // north: 2*20 (Ada, B1) + 1*35 (Ada, T1) + 3*20 (Alan, B1) + 1*12 (Ada, T2) = 147
    expect(totals.get("north")).toBe(147);
    // south: 5*12 (Grace, T2) = 60
    expect(totals.get("south")).toBe(60);
    // Edsger never ordered, so a left join leaves that region out of the grouped result.
    expect(totals.has("east")).toBe(false);
  });

  it("aggregates through the space helper", () => {
    const space = buildSpace();
    const result = space.aggregate("orders", "customers", { orders: { op: "count" } }, { groupBy: "segment" });
    const counts = new Map(result.data.map((row) => [row.segment, row.orders]));
    expect(counts.get("enterprise")).toBe(3);
    expect(counts.get("smb")).toBe(2);
  });

  it("filters orders by a related customer column", () => {
    const north = buildSpace().filterRelated("orders", "customers", (row) => row.region === "north");
    expect(north.rowCount).toBe(4);
    expect(north.data.every((row) => row.region === "north")).toBe(true);
  });

  it("chains two relationships through the space", () => {
    const space = buildSpace();
    const enriched = space
      .join("orders", "customers")
      .join(space.dataset("products"), { leftOn: "sku", rightOn: "sku", how: "left" });
    expect(enriched.rowCount).toBe(5);
    expect(enriched.columns).toContain("region");
    expect(enriched.columns).toContain("category");
  });

  it("describes the whole space", () => {
    const described = buildSpace().describe();
    expect(described.map((entry) => entry.name)).toEqual(["customers", "products", "orders"]);
    const ordersSummary = described.find((entry) => entry.name === "orders");
    expect(ordersSummary?.outgoing).toHaveLength(2);
    expect(ordersSummary?.incoming).toHaveLength(0);
    const customersSummary = described.find((entry) => entry.name === "customers");
    expect(customersSummary?.incoming).toEqual(["orders.customer_id->customers.id"]);
  });

  it("detects an orphan after data changes", () => {
    const space = buildSpace();
    space.replaceDataset(
      "orders",
      createDataset([...orders, { order_id: 105, customer_id: 99, sku: "B1", quantity: 1 }]),
    );
    const checks = space.check("orders.customer_id->customers.id");
    expect(checks[0]?.valid).toBe(false);
    expect(checks[0]?.orphans[0]).toMatchObject({ value: 99, rowIndex: 5 });
  });

  it("keeps datasets usable on their own alongside the space", () => {
    const space = buildSpace();
    const direct = space.dataset("products").filter((row) => row.category === "toy");
    expect(direct.rowCount).toBe(2);
    expect(space.dataset("products").rowCount).toBe(3);
  });
});
