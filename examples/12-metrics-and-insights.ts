/**
 * Metrics and insights: reusable calculations, and observations that carry their evidence.
 *
 * A metric keeps its definition, so the number can be printed, grouped, compared, and
 * recalculated later. The insight engine only reports what the data supports, and every
 * observation includes the values behind it.
 */
import { useSampleDataset } from "numiq";

const sales = await useSampleDataset();

console.log(`Sample: ${sales.rowCount} rows x ${sales.columnCount} columns`);

// ---------------------------------------------------------------- metric definitions

console.log("\nMetric definitions:");
const revenue = sales.createMetric({
  name: "Total Revenue",
  column: "revenue",
  aggregation: "sum",
  format: { prefix: "$", decimals: 2, unit: "currency" },
});

console.log(`  ${revenue.name}: ${revenue.value}`);
console.log(`  defined as ${revenue.definition}`);
console.log(`  computed over ${revenue.metric.rows} rows, ${revenue.metric.values} present values`);
// The format hints are carried, never applied: Numiq renders nothing.
console.log(`  format hints: ${JSON.stringify(revenue.format)}`);

const orders = sales.createMetric({ name: "Orders", aggregation: "count" });
console.log(`  ${orders.name}: ${orders.value} (${orders.definition})`);

// A custom calculation gets the column's present values.
const spread = sales.createMetric({
  name: "Revenue range",
  column: "revenue",
  fn: (values) => Math.max(...(values as number[])) - Math.min(...(values as number[])),
});
console.log(`  ${spread.name}: ${spread.value} (${spread.definition})`);

// ---------------------------------------------------------------- grouped metrics

console.log("\nRevenue by region:");
const byRegion = sales.createMetric({
  name: "Revenue",
  column: "revenue",
  aggregation: "sum",
  groupBy: ["region"],
});

for (const group of byRegion.byGroup().groups) {
  console.log(`  ${String(group.key.region).padEnd(6)} ${String(group.value).padStart(10)}  (${group.rows} rows)`);
}

// A grouped metric becomes a table named after the metric.
const table = byRegion.toDataset();
console.log(`  -> ${table.rows.length} rows x ${table.columns.length} columns: ${table.columns.join(", ")}`);

// ---------------------------------------------------------------- comparison

const north = sales.filter((row) => row.region === "North");
const northRevenue = revenue.recalculate(north.data, north.columns);
const comparison = revenue.compare({ to: northRevenue.metric, label: "North" });

console.log("\nComparison:");
console.log(`  all regions vs ${comparison.other}: difference ${comparison.difference?.toFixed(2)}`);
console.log(`  ratio ${comparison.ratio?.toFixed(2)}x  (${comparison.reason ?? "complete"})`);

// ---------------------------------------------------------------- insights

console.log("\nInsights:");
const report = sales.insights();

for (const insight of report.insights) {
  console.log(`  [${insight.kind}] ${insight.title}`);
  console.log(`      ${insight.detail}`);
}

if (report.skipped.length > 0) {
  console.log("\nChecks that could not run:");
  for (const skipped of report.skipped) {
    console.log(`  ${skipped.kind}: ${skipped.reason}`);
  }
}

console.log(`\nThresholds used: ${JSON.stringify(report.thresholds)}`);
console.log(`Truncated: ${report.truncated}`);

// Lowering the correlation threshold surfaces a relationship the default hides. The
// coefficient is unchanged; only the bar for reporting it moved.
const permissive = sales.insights({ strongCorrelation: 0.4 });
const correlation = permissive.insights.find((insight) => insight.kind === "correlation");
console.log(`\nAt a 0.4 threshold: ${correlation?.title ?? "still none"}`);
