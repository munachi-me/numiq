/**
 * Data spaces: several datasets and the relationships between them.
 *
 * A `Dataset` answers questions about one table. Real analysis spans several — orders
 * reference customers, line items reference products — and the joins that link them are
 * normally written out at every call site. A data space records those links once.
 */
import { createDataSpace, createDataset } from "@munachi-me/numiq";

const customers = createDataset(
  [
    { id: 1, name: "Ada", region: "north", segment: "enterprise" },
    { id: 2, name: "Grace", region: "south", segment: "smb" },
    { id: 3, name: "Alan", region: "north", segment: "smb" },
  ],
  { name: "customers" },
);

const products = createDataset(
  [
    { sku: "B1", category: "book", unit_price: 20 },
    { sku: "T1", category: "toy", unit_price: 35 },
  ],
  { name: "products" },
);

const orders = createDataset(
  [
    { order_id: 100, customer_id: 1, sku: "B1", quantity: 2 },
    { order_id: 101, customer_id: 1, sku: "T1", quantity: 1 },
    { order_id: 102, customer_id: 2, sku: "B1", quantity: 5 },
    { order_id: 103, customer_id: 3, sku: "B1", quantity: 3 },
  ],
  { name: "orders" },
);

// ---------------------------------------------------------------- build the space

const space = createDataSpace("Retail");
space.addDataset("customers", customers);
space.addDataset("products", products);
space.addDataset("orders", orders);

// Keys are declared once. Cardinality is checked against the data immediately.
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

console.log(`space "${space.name}": ${space.size} datasets, ${space.relationshipCount} relationships`);
for (const summary of space.describe()) {
  console.log(
    `  ${summary.name}: ${summary.rowCount} rows x ${summary.columnCount} cols ` +
      `(out ${summary.outgoing.length}, in ${summary.incoming.length})`,
  );
}

// ------------------------------------------------------------ referential integrity

for (const check of space.check()) {
  const label = check.relationship.name;
  if (check.valid) {
    console.log(`  ${label}: valid (${check.nullKeys} null keys)`);
  } else {
    console.log(`  ${label}: ${check.orphans.length} orphans, ${check.duplicates.length} duplicate keys`);
  }
}

// --------------------------------------------------------- relationship-keyed joins

// No key names repeated: they come from the relationship.
const withCustomer = space.join("orders", "customers");
console.log("\n--- orders joined to customers ---");
console.log(withCustomer.select(["order_id", "quantity", "name", "region"]).table());

// ------------------------------------------------------- cross-dataset aggregation

// Group by a column that lives on customers, not on orders.
const byRegion = space.aggregate(
  "orders",
  "customers",
  { orders: { op: "count" }, units: { column: "quantity", op: "sum" } },
  { groupBy: "region" },
);
console.log("--- order count and units by customer region ---");
console.log(byRegion.table());

// Revenue needs a column from each of two related tables.
const revenue = space
  .join("orders", "products")
  .addColumn("revenue", (row) => Number(row.quantity) * Number(row.unit_price));
const byCategory = revenue.groupBy("category").aggregate({ revenue: { column: "revenue", op: "sum" } });
console.log("--- revenue by product category ---");
console.log(byCategory.table());

// ------------------------------------------------------- cross-dataset filtering

const northOnly = space.filterRelated("orders", "customers", (row) => row.region === "north");
console.log(`\nnorth-only orders: ${northOnly.rowCount} of ${space.dataset("orders").rowCount}`);

// ------------------------------------------------------- detecting broken references

// Replacing data re-validates the relationships that touch it. Adding an order for a
// customer that does not exist is allowed — orphans are a finding, not a modelling error —
// but `check()` now reports it.
space.replaceDataset(
  "orders",
  createDataset([...orders.data, { order_id: 104, customer_id: 99, sku: "B1", quantity: 1 }], {
    name: "orders",
  }),
);
const [orphanCheck] = space.check("orders.customer_id->customers.id");
console.log(`after adding a dangling reference: valid=${orphanCheck?.valid}`);
for (const orphan of orphanCheck?.orphans ?? []) {
  console.log(`  row ${orphan.rowIndex}: customer_id ${String(orphan.value)} has no customer`);
}
