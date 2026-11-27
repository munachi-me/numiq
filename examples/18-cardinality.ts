/**
 * Cardinality, and the 2.0.0 names.
 *
 * "How many distinct values are in this column" and "which values are they" are two
 * different questions that used to share one method. They now have one name each.
 */
import { createDataset } from "@munachi-me/numiq";

const orders = createDataset([
  { order_id: 1, region: "north", revenue: 120 },
  { order_id: 2, region: "south", revenue: 80 },
  { order_id: 3, region: "north", revenue: 200 },
  { order_id: 4, region: "east", revenue: null },
  { order_id: 5, region: "south", revenue: 150 },
]);

// The values, in first-seen order. `unique()` and `distinct()` agree.
console.log("regions:", orders.unique("region"));
console.log("same as distinct:", JSON.stringify(orders.unique("region")) === JSON.stringify(orders.distinct("region")));

// The count, which is a separate question and now has its own name.
console.log("region count:", orders.uniqueCount("region"));
console.log("order count: ", orders.uniqueCount("order_id"), "(every id is distinct)");

// null is not a value, so it appears in neither answer.
console.log("revenues:", orders.unique("revenue"), "count:", orders.uniqueCount("revenue"));

// A column of ids is unique when the count equals the row count — the usual check.
const idIsKey = orders.uniqueCount("order_id") === orders.rowCount;
console.log("order_id is a key:", idIsKey);

// The renamed quality report, and the alias that still works.
console.log("\nhealthy:", orders.qualityReport().healthy);
console.log("via deprecated alias:", orders.getQualityReport().healthy);

// The table alias still delegates too, but the message says which name to prefer.
console.log("\n--- table ---");
console.log(orders.table({ maxRows: 3 }));
