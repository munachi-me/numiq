/**
 * Grouping and aggregation: summarising rows by key.
 *
 * `groupBy` describes a split; nothing is computed until `aggregate` runs. The result is an
 * ordinary Dataset, so it composes with queries, sorting, and preparation.
 */
import { createDataset, mean, median, std, useSampleDataset } from "@munachi-me/numiq";

const sales = await useSampleDataset();

console.log("Source data (first 5 of 50 orders):");
console.log(sales.head(5).table());

// One output column per aggregation. `count` is the only operation that may omit a column,
// where it counts rows in the group.
const byProduct = sales.groupBy("product").aggregate({
  orders: { op: "count" },
  totalRevenue: { column: "revenue", op: "sum" },
  averageRevenue: { column: "revenue", op: "mean" },
  largestOrder: { column: "revenue", op: "max" },
});

console.log("\nTotals per product:");
console.log(byProduct.table());

// Groups keep first-appearance order, so the output is the same on every run.
console.log(`\nGroup order: ${byProduct.data.map((row) => String(row.product)).join(" -> ")}`);

// The result is a Dataset, so it can be sorted and filtered like any other.
const biggest = byProduct.query().where("totalRevenue", ">", 2000).orderBy("totalRevenue", "desc").execute();

console.log("\nProducts over 2000 in total revenue, largest first:");
console.log(biggest.table());

// Several grouping columns produce one row per combination, again in first-appearance order.
const byRegionProduct = sales.groupBy("region", "product").aggregate({
  orders: { op: "count" },
  revenue: { column: "revenue", op: "sum" },
});

console.log(`\nGrouping by region and product gives ${byRegionProduct.rowCount} combinations.`);
console.log(byRegionProduct.head(5).table());

// Dispersion defaults to the sample formula (dividing by n - 1). Pass `ddof: 0` for the
// population formula. A single-row group has no sample spread, so it reports null.
const dispersion = sales.groupBy("product").aggregate({
  orders: { op: "count" },
  sampleStd: { column: "revenue", op: "std" },
  populationStd: { column: "revenue", op: "std", ddof: 0 },
});

console.log("\nSample versus population standard deviation:");
console.log(dispersion.table());

const single = createDataset([
  { group: "one", value: 10 },
  { group: "two", value: 20 },
  { group: "two", value: 40 },
]);

console.log("\nA group with one row has no sample spread:");
console.log(
  single
    .groupBy("group")
    .aggregate({ spread: { column: "value", op: "std" } })
    .table(),
);

// Missing cells inside a group are excluded from every aggregation, so a mean ignores
// them rather than treating them as zero.
const gappy = createDataset([
  { team: "red", score: 10 },
  { team: "red", score: null },
  { team: "red", score: 30 },
  { team: "blue", score: null },
]);

console.log("\nMissing scores are skipped, not counted as zero:");
console.log(
  gappy
    .groupBy("team")
    .aggregate({
      rows: { op: "count" },
      scored: { column: "score", op: "count" },
      average: { column: "score", op: "mean" },
    })
    .table(),
);

// A missing *key* forms its own group rather than vanishing, so totals still add up.
const missingKey = createDataset([
  { region: "North", revenue: 100 },
  { region: null, revenue: 40 },
  { region: "North", revenue: 60 },
]);

const withMissingGroup = missingKey.groupBy("region").aggregate({ total: { column: "revenue", op: "sum" } });
console.log("\nRows with no region form their own group:");
console.log(withMissingGroup.table());

// Filter it out when it is not wanted.
const labelled = withMissingGroup.query().where("region", "isNotNull").execute();
console.log(`\nAfter dropping the unlabelled group: ${labelled.rowCount} rows.`);

// Custom aggregators receive frozen copies, so they cannot corrupt the dataset. A bare
// callback gets the group's rows; bind a column to receive just that column's values.
const custom = sales.groupBy("product").aggregate({
  orders: { op: "count" },
  revenueRange: {
    column: "revenue",
    fn: (values) => {
      const numbers = values as number[];
      return Math.max(...numbers) - Math.min(...numbers);
    },
  },
  firstCategory: (rows) => rows[0]?.category,
});

console.log("\nCustom aggregators:");
console.log(custom.table());

// The same helpers are exported standalone for use outside a grouping.
const revenues = sales.data.map((row) => Number(row.revenue));
console.log(
  `\nStandalone helpers over all ${revenues.length} order revenues: ` +
    `mean ${mean(revenues)?.toFixed(2)}, median ${median(revenues)?.toFixed(2)}, ` +
    `sample std ${std(revenues)?.toFixed(2)}`,
);

// A numeric aggregation on a text column is a mistake, and it is reported as one rather
// than quietly returning null.
try {
  sales.groupBy("product").aggregate({ bad: { column: "category", op: "sum" } });
} catch (error) {
  console.log(`\nsum on a text column: ${(error as Error).message}`);
}
