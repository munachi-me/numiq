/**
 * Load a CSV file and inspect it.
 *
 * Run with: npx tsx examples/01-load-and-inspect.ts
 */
import { loadCSV } from "numiq";

const sales = await loadCSV("examples/data/sales.csv");

console.log(sales.table());
console.log();
console.log(sales.info());
console.log();

for (const column of sales.columns) {
  const view = sales.column(column);
  console.log(`${column}: type=${view.type} unique=${view.unique} missing=${view.missing}`);
}

console.log();
console.log("Report:", {
  format: sales.importReport?.format,
  rowsRead: sales.importReport?.rowsRead,
  warnings: sales.importReport?.warnings.length,
});
