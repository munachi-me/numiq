/**
 * Cast columns to real types with a schema.
 *
 * Run with: npx tsx examples/02-type-casting.ts
 */
import { loadCSV } from "numiq";

const sales = await loadCSV("examples/data/sales.csv", {
  schema: {
    amount: "number",
    ordered_on: "date",
  },
});

const [first] = sales.data;
console.log("amount:", typeof first?.amount, first?.amount);
console.log("ordered_on:", first?.ordered_on instanceof Date ? "Date" : typeof first?.ordered_on);
console.log("dtypes:", sales.dtypes);

// Without a schema, dates stay strings and are only reported as dates.
const raw = await loadCSV("examples/data/sales.csv");
console.log("raw date value:", typeof raw.data[0]?.ordered_on, raw.dtypes.ordered_on);
