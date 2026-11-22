/**
 * Errors are typed and carry stable codes.
 *
 * Run with: npx tsx examples/05-errors.ts
 */
import { createDataset, loadCSV, NumiqError, FormatError, ColumnNotFoundError } from "@munachi-me/numiq";

const data = createDataset([{ a: 1 }]);

try {
  data.column("missing");
} catch (error) {
  if (error instanceof ColumnNotFoundError) {
    console.log("unknown column:", error.column, "available:", error.available);
    console.log("code:", error.code);
  }
}

try {
  await loadCSV("users.json"); // a .json file, so loadCSV refuses it
} catch (error) {
  if (error instanceof FormatError) console.log("wrong loader:", error.message);
}

try {
  await loadCSV("does-not-exist.csv");
} catch (error) {
  if (error instanceof NumiqError) console.log("import failure:", error.code, "-", error.message);
}
