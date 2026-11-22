/**
 * Conditional columns, joins, and reshaping.
 *
 * Three ways to get the table you need from the one you have: derive a column from
 * ordered rules, bring in columns from a related table, and change the shape without
 * changing the data.
 */
import { createDataset, useSampleDataset } from "@munachi-me/numiq";

const sales = await useSampleDataset();
console.log(`Sample: ${sales.rowCount} rows x ${sales.columnCount} columns`);

// ------------------------------------------------------------- conditional columns

const banded = sales.addConditionalColumn(
  "orderSize",
  [
    { when: (row) => (row.quantity as number) >= 5, then: "bulk" },
    { when: (row) => (row.quantity as number) >= 3, then: "standard" },
  ],
  { else: "single" },
);

console.log("\nOrder size bands:");
console.log(banded.groupBy("orderSize").aggregate({ n: { op: "count" } }).data);

const { report } = sales.addConditionalColumnReport(
  "orderSize",
  [
    { when: (row) => (row.quantity as number) >= 5, then: "bulk" },
    { when: (row) => (row.quantity as number) >= 3, then: "standard" },
  ],
  { else: "single" },
);
console.log("Rule coverage:", {
  matched: report.matched,
  unmatched: report.unmatched,
  rows: report.rowCount,
});

// A rule that can never fire is visible in the counts rather than silently absent.
const deadRule = sales.addConditionalColumnReport("flag", [
  { when: (row) => (row.quantity as number) > 1000, then: "impossible" },
  { when: () => true, then: "reachable" },
]).report;
console.log("Dead-rule check, matched per rule:", deadRule.matched);

// ---------------------------------------------------------------- joins

const regions = createDataset([
  { region: "North", manager: "Ada" },
  { region: "South", manager: "Bo" },
  { region: "East", manager: "Cy" },
  { region: "West", manager: "Dee" },
]);

const enriched = sales.join(regions, { on: "region", how: "left" });
console.log("\nAfter joining a region lookup:", {
  columns: enriched.columns.length,
  rows: enriched.rowCount,
});

const joined = sales.joinReport(regions, { on: "region", how: "full" }).report;
console.log("Join coverage:", {
  matched: joined.matched,
  leftUnmatched: joined.leftUnmatched,
  rightUnmatched: joined.rightUnmatched,
});

// A missing key matches nothing, so an unmatched lookup value stays null rather than
// being guessed.
const orphan = createDataset([{ region: "Nowhere", manager: "Nobody" }]);
console.log("Unmatched lookup row:", orphan.joinReport(sales, { on: "region", how: "full" }).report);

// ---------------------------------------------------------------- reshaping

const wide = createDataset([
  { region: "North", Q1: 10, Q2: 20 },
  { region: "South", Q1: 30, Q2: 40 },
]);
console.log("\nWide:");
console.log(wide.data);

const long = wide.melt({ idVars: "region" });
console.log("Long:");
console.log(long.data);

const back = long.pivot({ columns: "variable", values: "value" });
console.log("Pivoted back, identical to the original:", JSON.stringify(back.data) === JSON.stringify(wide.data));

// Pivoting the sample: revenue per region per category, first value per cell.
const grid = sales.pivotReport({ columns: "category", values: "revenue", index: "region" });
console.log("\nRevenue grid:", grid.pivoted, `(collapsed ${grid.collapsed} cells)`);

// Stacking keeps this dataset's rows first and unions the columns.
const combined = sales.head(3).concat(sales.tail(3));
console.log("Stacked rows:", combined.rowCount, "columns:", combined.columns.length);

// Strict mode refuses a schema drift that a union would hide.
try {
  sales.head(3).concat(sales.drop(["region"]), { columns: "strict" });
} catch (error) {
  console.log("Strict concat rejected mismatched columns:", (error as Error).message.slice(0, 60) + "...");
}
