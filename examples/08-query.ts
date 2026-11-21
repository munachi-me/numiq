/**
 * Structured queries: filtering, ordering, and projection without string parsing.
 *
 * Every condition is a typed value handed to a method, so there is no query text to
 * evaluate and nothing from the data can become code.
 */
import { createDataset, loadCSV } from "numiq";

const sales = await loadCSV("sales.csv");

console.log("Source data:");
console.log(sales.table());

// Comparison, membership, range, text, and null operators all compose in one chain.
const filtered = sales
  .query()
  .where("amount", ">", 50)
  .and("product", "in", ["Keyboard", "Monitor"])
  .orderBy("amount", "desc")
  .select(["product", "amount"])
  .execute();

console.log("\nProducts over 50, largest first:");
console.log(filtered.table());

// `between` is inclusive at both bounds.
const midRange = sales.query().where("amount", "between", [25, 100]).execute();
console.log(`\nRows with amount between 25 and 100: ${midRange.rowCount}`);

// Text operators are case-sensitive unless you ask otherwise.
const exact = sales.query().where("product", "startsWith", "M").execute();
const loose = sales.query().where("product", "startsWith", "m", { ignoreCase: true }).execute();
console.log(`startsWith "M": ${exact.rowCount} rows, startsWith "m" (ignoreCase): ${loose.rowCount} rows`);

// AND binds tighter than OR: this reads as product = Mouse OR (amount > 100 AND amount < 300).
const precedence = sales.query().where("product", "=", "Mouse").or("amount", ">", 100).and("amount", "<", 300);
console.log("\nHow the conditions group:");
console.log(precedence.toString());
console.log(`Matches ${precedence.execute().rowCount} rows.`);

// Parenthesise explicitly when the default grouping is not what you want.
const grouped = sales
  .query()
  .where("amount", "isNotNull")
  .andGroup((group) => group.where("product", "contains", "o").or("amount", ">", 200))
  .execute();
console.log('\nExplicit grouping: amount IS NOT NULL AND (product contains "o" OR amount > 200)');
console.log(grouped.table());

// A query is immutable, so one base can seed several branches.
const base = sales.query().where("amount", "isNotNull");
const large = base.and("amount", ">", 100).execute();
const small = base.and("amount", "<", 100).execute();
console.log(`\nLarge: ${large.rowCount} rows, small: ${small.rowCount} rows.`);
console.log(`The base query is unchanged and still matches ${base.execute().rowCount} rows.`);

// Missing values never satisfy a comparison, including `!=`, exactly as SQL behaves.
// Rows with a missing region are dropped by the first query and kept by the second.
const withGaps = createDataset([
  { region: "North", revenue: 500 },
  { region: "West", revenue: 150 },
  { region: null, revenue: 900 },
]);

const notNorth = withGaps.query().where("region", "!=", "North").execute();
const notNorthOrMissing = withGaps.query().where("region", "!=", "North").or("region", "isNull").execute();

console.log(`\nregion != "North": ${notNorth.rowCount} rows (the missing region is excluded)`);
console.log(`region != "North" OR region isNull: ${notNorthOrMissing.rowCount} rows`);
