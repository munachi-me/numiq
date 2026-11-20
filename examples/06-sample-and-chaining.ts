/**
 * The bundled sample dataset and a fluent transformation chain.
 *
 * Run with: npx tsx examples/06-sample-and-chaining.ts
 */
import { useSampleDataset } from "numiq";

const sample = await useSampleDataset();
console.log("sample shape:", sample.shape);
console.log(sample.head(3).table());
console.log();

const top = sample
  .filter((row) => Number(row.revenue) > 100)
  .sort("revenue", "desc")
  .select(["order_id", "product", "revenue"])
  .limit(10);

console.log(top.table());
console.log();
console.log(`original rows: ${sample.rowCount}, filtered rows: ${top.rowCount}`);
