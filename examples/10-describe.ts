/**
 * Descriptive statistics: profiling columns with `describe()`.
 *
 * `describe()` profiles every column and returns a table-ready description;
 * `describe(column)` returns one column's profile directly. Statistics that do not apply to
 * a column's type are `null` rather than `0`, so a categorical column never reports a sum.
 */
import { useSampleDataset } from "@munachi-me/numiq";

const sales = await useSampleDataset();

console.log(`Sample: ${sales.rowCount} rows x ${sales.columnCount} columns`);

// One row per column. The table shows a readable subset of the statistics.
console.log("\nEvery column at a glance:");
console.log(sales.describe().table());

// A single column returns its profile, not a one-row table.
const revenue = sales.describe("revenue");
console.log("\nRevenue profile:");
console.log(`  count   ${revenue.count}`);
console.log(`  missing ${revenue.missing}`);
console.log(`  unique  ${revenue.unique}`);
console.log(`  sum     ${revenue.sum?.toFixed(2)}`);
console.log(`  mean    ${revenue.mean?.toFixed(2)}`);
console.log(`  median  ${revenue.median?.toFixed(2)}`);
console.log(`  min     ${String(revenue.min)}`);
console.log(`  max     ${String(revenue.max)}`);
console.log(`  range   ${revenue.range}`);
console.log(`  std     ${revenue.std?.toFixed(2)}`);
console.log(`  q1/q3   ${revenue.q1} / ${revenue.q3}  (IQR ${revenue.iqr})`);

// The sample formula divides by n - 1. Ask for the population formula explicitly and the
// profile records which one produced it.
const population = sales.describe("revenue", { ddof: 0 });
console.log(`\nSample std ${revenue.std?.toFixed(4)} vs population std ${population.std?.toFixed(4)}`);
console.log(`ddof used: ${population.ddof}`);

// A categorical column gets counts, mode, and bounds, but no arithmetic. `null` means
// "not meaningful here", which is different from zero.
const region = sales.describe("region");
console.log(`\nRegion column: kind=${region.kind} unique=${region.unique} mode=${String(region.mode)}`);
console.log(`  sum=${String(region.sum)} mean=${String(region.mean)}  <- null, not 0`);

// Extra percentiles can be requested per call.
const deciles = sales.describe("revenue", { percentiles: [10, 25, 50, 75, 90] });
console.log("\nRevenue percentiles:");
for (const [key, value] of Object.entries(deciles.percentiles)) {
  console.log(`  ${key.padEnd(4)} ${value?.toFixed(2)}`);
}

// The description is an analytical result, not a Dataset. Convert when a table is needed.
console.log("\nFull statistics as a Dataset:");
console.log(sales.describe().toDataset().select(["name", "kind", "count", "missing", "mean", "q1", "q3"]).table());

// Profiling does not touch the source data.
console.log(`\nSource unchanged: ${sales.rowCount} rows after profiling.`);
