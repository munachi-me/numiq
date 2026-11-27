/**
 * Large files and interchange.
 *
 * Two edges of the same problem. Reading a file too big for memory, and handing a dataset
 * to something that is not Numiq — a chart, a worker, another process. Both are boundaries,
 * so both have an explicit API rather than an implicit behaviour.
 */
import {
  chunkDelimited,
  collectChunks,
  createDataset,
  fromInterchange,
  fromTableData,
  reduceChunks,
  toCSV,
  toInterchange,
  toObjects,
  toTableData,
} from "@munachi-me/numiq";

// ---------------------------------------------------------------- a file too big to hold

const header = "order_id,region,revenue";
const body = Array.from({ length: 5_000 }, (_, index) => {
  const region = ["north", "south", "east"][index % 3];
  return `${index + 1},${region},${((index % 50) + 1) * 2.5}`;
});
const csv = [header, ...body].join("\n");

// Nothing parses until the loop asks for a chunk.
let chunks = 0;
let rows = 0;
for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 1_000 })) {
  chunks += 1;
  rows += chunk.rowCount;
}
console.log(`streamed ${rows} rows in ${chunks} chunks`);

// Progress is reported per chunk, and returning false stops the loop early.
let stoppedAt = 0;
for (const chunk of chunkDelimited(csv, "csv", {
  chunkSize: 1_000,
  onProgress: (progress) => {
    stoppedAt = progress.delivered;
    return progress.chunk < 1;
  },
})) {
  void chunk;
}
console.log(`stopped after ${stoppedAt} rows`);

// When the answer is one number, fold each chunk and drop it.
const totalRevenue = reduceChunks(
  csv,
  "csv",
  (sum, chunk) => sum + chunk.data.reduce((inner, row) => inner + Number(row.revenue), 0),
  0,
  { chunkSize: 1_000 },
);
console.log(`total revenue: ${totalRevenue}`);

// When you did want one dataset, say so explicitly.
const collected = collectChunks(csv, "csv", { chunkSize: 1_000 });
console.log(`collected: ${collected.rowCount} rows x ${collected.columnCount} columns`);

// ---------------------------------------------------------------- handing data to a consumer

const sales = createDataset(
  [
    { region: "north", revenue: 120.5, at: "2026-11-01" },
    { region: "south", revenue: 80, at: "2026-11-02" },
    { region: "east", revenue: null, at: "2026-11-03" },
  ],
  { name: "sales" },
);

// A header plus row-major cells, for a chart library that wants columns and rows.
const table = toTableData(sales);
console.log("\n--- table data ---");
console.log(table.columns.join(" | "));
for (const row of table.rows) console.log(row.map((cell) => String(cell ?? "—")).join(" | "));

// Plain records, for anything that takes objects.
console.log("\nfirst object:", JSON.stringify(toObjects(sales)[0]));

// CSV text, for a spreadsheet or a download.
console.log("\n--- CSV ---");
console.log(toCSV(sales, { newline: "\n" }));

// The interchange contract: what a consumer such as Numviz reads.
const payload = toInterchange(sales);
console.log("--- interchange payload ---");
console.log(`format: ${payload.format} v${payload.version}`);
console.log(`missing values are: ${String(payload.missingValue)}`);
for (const column of payload.columns) {
  console.log(`  ${column.name}: ${column.type} (${column.role}${column.nullable ? ", nullable" : ""})`);
}

// And back again, so the boundary is two-way.
const rebuilt = fromInterchange(payload);
console.log(
  `rebuilt: ${rebuilt.rowCount} rows, identical: ${JSON.stringify(rebuilt.data) === JSON.stringify(sales.data)}`,
);

// Ragged input is padded by default and rejected when you ask it to be strict.
const padded = fromTableData({ columns: ["a", "b"], rows: [[1]] });
console.log(`padded row: ${JSON.stringify(padded.data[0])}`);
try {
  fromTableData({ columns: ["a", "b"], rows: [[1]] }, { strict: true });
} catch (error) {
  console.log(`strict: ${(error as Error).message}`);
}
