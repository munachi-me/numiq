/**
 * Window functions and time-series operations.
 *
 * Values that depend on a row's position among its neighbours, and grouping by calendar
 * intervals. Every window call states its order explicitly, so the result never depends on
 * the order the dataset happens to be in.
 */
import { createDataset } from "numiq";

const orders = createDataset(
  [
    { store: "north", at: "2026-11-01T09:00:00Z", units: 4 },
    { store: "north", at: "2026-11-02T09:00:00Z", units: 4 },
    { store: "north", at: "2026-11-03T09:00:00Z", units: 6 },
    { store: "north", at: "2026-11-04T09:00:00Z", units: 8 },
    { store: "south", at: "2026-11-01T10:00:00Z", units: 10 },
    { store: "south", at: "2026-11-03T10:00:00Z", units: 20 },
    { store: "south", at: "2026-11-04T10:00:00Z", units: 30 },
  ],
  { name: "orders" },
);

console.log(`Orders: ${orders.rowCount} rows x ${orders.columnCount} columns\n`);

// ------------------------------------------------------------------- ranking

const ranked = orders.rank("rank", {
  partitionBy: "store",
  orderBy: { column: "units", direction: "desc" },
});

console.log("Rank by units within each store:");
console.log(ranked.select(["store", "at", "units", "rank"]).table());

// rank leaves a gap after a tie; denseRank does not.
const tied = createDataset([{ score: 10 }, { score: 20 }, { score: 20 }, { score: 30 }]);
console.log("\nTies: rank vs denseRank");
console.log(tied.rank("rank", { orderBy: "score" }).denseRank("dense", { orderBy: "score" }).table());

// ------------------------------------------------------------------- offsets

const withDelta = orders
  .lag("previous", "units", { partitionBy: "store", orderBy: "at" })
  .lead("next", "units", { partitionBy: "store", orderBy: "at", fill: 0 });

console.log("\nPrevious and next units within each store:");
console.log(withDelta.select(["store", "at", "units", "previous", "next"]).table());

// ------------------------------------------------------------ running values

const running = orders
  .cumSum("total", "units", { partitionBy: "store", orderBy: "at" })
  .cumMean("average", "units", { partitionBy: "store", orderBy: "at" });

console.log("\nRunning total and running mean:");
console.log(running.select(["store", "at", "units", "total", "average"]).table());

// ------------------------------------------------------------- moving values

const moving = orders
  .rollingMean("avg2", "units", { partitionBy: "store", orderBy: "at", window: 2 })
  .rollingMax("peak3", "units", { partitionBy: "store", orderBy: "at", window: 3 });

console.log("\nRolling mean and rolling maximum (leading rows are null by default):");
console.log(moving.select(["store", "at", "units", "avg2", "peak3"]).table());

// A shorter leading window can be accepted explicitly.
console.log("\nSame rolling mean with minPeriods: 1:");
console.log(
  orders
    .rollingMean("avg2", "units", { partitionBy: "store", orderBy: "at", window: 2, minPeriods: 1 })
    .select(["store", "at", "units", "avg2"])
    .table(),
);

// ---------------------------------------------------------------- time series

console.log("\nSorted by time, oldest first:");
console.log(orders.sortByTime("at").select(["store", "at", "units"]).head(4).table());

const daily = orders.resample({ every: "day", timeColumn: "at", aggregate: { units: "sum" } });

console.log("\nDaily totals across both stores:");
console.log(daily.table());

const {
  dataset: reported,
  bucketed,
  dropped,
} = orders.resampleReport({
  every: "week",
  timeColumn: "at",
  aggregate: { units: "sum", store: "count" },
});

console.log(`\nWeekly totals (${bucketed} rows bucketed, ${dropped} dropped):`);
console.log(reported.table());

console.log("\nWeek buckets present:");
console.log(orders.periodBuckets("at", "week"));

// extractPeriod labels rows so they can be grouped on like any other column.
const byWeek = orders
  .extractPeriod("week", "at", "week")
  .groupBy("week")
  .aggregate({ units_total: { column: "units", op: "sum" } });

console.log("\nGrouped by extracted week label:");
console.log(byWeek.table());

// ------------------------------------------------------------------- ordering

// Without an order there is no "previous" row, so the call is rejected.
try {
  orders.cumSum("total", "units", {} as never);
} catch (error) {
  console.log("\nMissing orderBy rejected:", (error as Error).message.slice(0, 72) + "...");
}

// UTC bucketing: the same instant always lands in the same bucket.
const zoned = createDataset([{ at: "2026-11-16T10:00:00+02:00", v: 1 }]);
console.log("\n+02:00 offset buckets as 08:00Z:");
console.log(zoned.resample({ every: "hour", timeColumn: "at", aggregate: { v: "sum" } }).table());

// The original dataset is never modified.
console.log(`\nOriginal dataset still ${orders.rowCount} rows and ${orders.columnCount} columns.`);
