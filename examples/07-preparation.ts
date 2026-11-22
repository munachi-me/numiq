/**
 * Data preparation: cleaning and deriving columns without mutating the source.
 *
 * Run with: npx tsx examples/07-preparation.ts
 */
import { createDataset } from "@munachi-me/numiq";

const orders = createDataset([
  { order_id: 1, qty: 2, unit_price: 10, region: "N", internal_note: "rush" },
  { order_id: 2, qty: null, unit_price: 5, region: "S", internal_note: null },
  { order_id: 2, qty: 4, unit_price: 2.5, region: "N", internal_note: "dupe" },
  { order_id: 3, qty: 1, unit_price: null, region: null, internal_note: null },
]);

console.log("source");
console.log(orders.table());
console.log();

// Fill gaps, drop the internal column, and compute a derived column.
const cleaned = orders
  .drop(["internal_note"])
  .fillMissing({ qty: "median", unit_price: 0, region: "Unknown" })
  .addColumn("total", (row) => Number(row.qty) * Number(row.unit_price));

console.log("cleaned");
console.log(cleaned.table());
console.log();

// De-duplicate on a key, keeping the first row of each order.
const perOrder = cleaned.dropDuplicates(["order_id"]);

console.log("one row per order");
console.log(perOrder.table());
console.log();

// Replacing values, casting types, and a reproducible sample.
const normalised = perOrder
  .replace({ region: { from: "Unknown", to: "n/a" } })
  .cast({ order_id: "string" })
  .sort("total", "desc");

console.log("normalised");
console.log(normalised.table());
console.log();

const sample = normalised.sample(2, { seed: 7 });
console.log("sample (seed 7, same rows every run)");
console.log(sample.table());
console.log();

console.log(`source rows: ${orders.rowCount}, cleaned rows: ${cleaned.rowCount}`);
console.log(`source columns unchanged: ${orders.columns.join(", ")}`);
