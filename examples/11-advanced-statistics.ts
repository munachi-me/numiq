/**
 * Advanced statistics: relationships, shape, position, and outliers.
 *
 * Correlations return `{ r, n, reason }` rather than a bare number, because "undefined"
 * is a real answer and deserves to be distinguishable from "zero". Missing values are
 * handled pairwise, and nothing here claims statistical significance.
 */
import { useSampleDataset } from "@munachi-me/numiq";

const sales = await useSampleDataset();

console.log(`Sample: ${sales.rowCount} rows x ${sales.columnCount} columns`);

// A correlation carries its evidence: the coefficient, the pairs it used, and a reason
// when the coefficient is undefined.
console.log("\nCorrelation between quantity and revenue:");
const pearson = sales.correlation("quantity", "revenue");
console.log(`  Pearson  r = ${pearson.r?.toFixed(4)}  (n = ${pearson.n}, ${pearson.reason ?? "computed"})`);
const spearman = sales.rankCorrelation("quantity", "revenue");
console.log(`  Spearman r = ${spearman.r?.toFixed(4)}  (n = ${spearman.n}, ${spearman.reason ?? "computed"})`);

// Rank correlation is higher here: the relationship is monotonic but not linear.
console.log("  Rank correlation exceeds Pearson, so the relationship is monotonic, not linear.");

// A matrix over every numeric column, symmetric by construction.
console.log("\nCorrelation matrix:");
const matrix = sales.correlationMatrix();
console.log(`  columns: ${matrix.columns.join(", ")}`);
for (let row = 0; row < matrix.columns.length; row += 1) {
  const cells = matrix.columns.map((_, column) => String(matrix.matrix[row]?.[column]?.toFixed(4)));
  console.log(`  ${matrix.columns[row]?.padEnd(10)} ${cells.join("  ")}`);
}

// Shape: skewness says which tail is longer, excess kurtosis how heavy the tails are.
console.log("\nDistribution shape (revenue):");
console.log(`  skewness ${sales.skewness("revenue")?.toFixed(4)}  (positive: right tail)`);
console.log(`  kurtosis ${sales.kurtosis("revenue")?.toFixed(4)}  (excess; normal is 0)`);

// The five-number summary, with the mean alongside so skew is visible.
const summary = sales.fiveNumberSummary("revenue");
console.log("\nFive-number summary (revenue):");
console.log(`  min     ${summary.min}`);
console.log(`  q1      ${summary.q1?.toFixed(2)}`);
console.log(`  median  ${summary.median?.toFixed(2)}`);
console.log(`  q3      ${summary.q3?.toFixed(2)}`);
console.log(`  max     ${summary.max}`);
console.log(`  mean    ${summary.mean?.toFixed(2)}  (above the median: right-skewed)`);

// Outliers: unusual values, not errors. IQR is the default because it assumes nothing
// about the distribution.
console.log("\nOutliers in revenue (IQR fences, k = 1.5):");
const outliers = sales.outliers("revenue");
console.log(`  fences: lower ${outliers.fences?.lower.toFixed(2)}, upper ${outliers.fences?.upper.toFixed(2)}`);
console.log(`  found:  ${outliers.outliers.length}`);
for (const outlier of outliers.outliers) {
  console.log(`    row ${outlier.index}: ${outlier.value} (${outlier.side})`);
}

// Z-scores as a column. The source dataset is unchanged.
console.log("\nZ-scores added as a column:");
const scored = sales.withZScores("revenue");
console.log(`  columns now: ${scored.columns.join(", ")}`);
console.log(`  source unchanged: ${!sales.columns.includes("revenue_z")}`);

// A constant column has no spread, so it has no z-scores. The failure is visible in the
// data as nulls rather than hidden as Infinity.
const constant = sales.addColumn("flat", () => 1).withZScores("flat");
console.log(`  constant column scores: ${JSON.stringify(constant.data.slice(0, 3).map((row) => row["flat_z"]))}`);
