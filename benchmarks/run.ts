/**
 * Numiq benchmark suite.
 *
 * Run with `npm run bench`. Add `--json out.json` to save results for comparison, or
 * `--filter <text>` to run a subset.
 *
 * Every case measures a whole public operation rather than an internal helper, because
 * the question is how long a caller waits, not whether one loop is tight.
 */

import { writeFileSync } from "node:fs";
import { consume, formatMs, heapUsed, makeJoinInputs, makeSalesRows, seededRandom, time } from "./lib/harness.js";
import type { Sample } from "./lib/harness.js";
import { createDataset } from "../src/core/dataset.js";
import { parseDelimited } from "../src/io/parsers/csv.js";
import { pipeline } from "../src/core/pipeline.js";

interface CaseResult {
  group: string;
  name: string;
  rows: number;
  timing: Sample;
}

const SIZES = [
  { label: "small", rows: 1_000 },
  { label: "medium", rows: 25_000 },
  { label: "large", rows: 100_000 },
] as const;

const filterArg = process.argv.indexOf("--filter");
const filter = filterArg === -1 ? null : (process.argv[filterArg + 1] ?? "");
const jsonArg = process.argv.indexOf("--json");
const jsonPath = jsonArg === -1 ? null : (process.argv[jsonArg + 1] ?? "benchmarks/results/latest.json");

const results: CaseResult[] = [];

function selected(group: string, name: string): boolean {
  if (filter === null) return true;
  return `${group} ${name}`.toLowerCase().includes(filter.toLowerCase());
}

async function bench(group: string, name: string, rows: number, run: () => unknown | Promise<unknown>): Promise<void> {
  if (!selected(group, name)) return;
  const timing = await time(run);
  results.push({ group, name, rows, timing });
  console.log(
    `  ${name.padEnd(38)} ${formatMs(timing.median).padStart(10)}  (min ${formatMs(timing.min)}, p95 ${formatMs(timing.p95)})`,
  );
}

/** A CSV document of the given row count, built once so parsing is what gets measured. */
function makeCsv(rows: number): string {
  const random = seededRandom(11);
  const lines = ["order_id,region,channel,units,revenue,cost,sold_at"];
  const base = Date.UTC(2024, 0, 1);
  const regions = ["north", "south", "east", "west"];
  const channels = ["web", "store", "partner", "phone"];
  for (let index = 0; index < rows; index += 1) {
    const region = regions[Math.floor(random() * 4)] as string;
    const channel = channels[Math.floor(random() * 4)] as string;
    const units = 1 + Math.floor(random() * 20);
    const revenue = (Math.round(random() * 100_000) / 100).toFixed(2);
    const cost = (Math.round(random() * 60_000) / 100).toFixed(2);
    const date = new Date(base + Math.floor(random() * 365) * 86_400_000).toISOString().slice(0, 10);
    lines.push(`${index + 1},${region},${channel},${units},${revenue},${cost},${date}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log(`Numiq benchmarks  |  node ${process.version}  |  ${new Date().toISOString()}`);
  const baselineHeap = heapUsed();
  console.log(`baseline heap: ${(baselineHeap / 1024 / 1024).toFixed(1)}MB\n`);

  for (const size of SIZES) {
    const rows = makeSalesRows(size.rows);
    console.log(`${size.label} (${size.rows.toLocaleString()} rows)`);

    await bench("construct", "createDataset(rows)", size.rows, () => consume(createDataset(rows)));

    const dataset = createDataset(rows);
    await bench("access", "data getter (full copy)", size.rows, () => consume(dataset.data));
    await bench("access", "schema getter", size.rows, () => consume(dataset.schema));
    await bench("access", "info()", size.rows, () => consume(dataset.info()));

    await bench("transform", "filter (numeric)", size.rows, () =>
      consume(dataset.filter((row) => (row.revenue as number) > 500)),
    );
    await bench("transform", "sort (numeric column)", size.rows, () => consume(dataset.sort("revenue", "desc")));
    await bench("transform", "select (3 columns)", size.rows, () =>
      consume(dataset.select(["order_id", "region", "revenue"])),
    );
    await bench("transform", "groupBy + aggregate", size.rows, () =>
      consume(
        dataset.groupBy("region").aggregate({
          total: { column: "revenue", op: "sum" },
          orders: { op: "count" },
        }),
      ),
    );
    await bench("transform", "describe()", size.rows, () => consume(dataset.describe()));
    await bench("transform", "toTable()", size.rows, () => consume(dataset.toTable()));

    console.log("");
  }

  // Joins are measured separately: the dimension side stays fixed, so the number
  // reported is the cost of probing, not of building both inputs.
  const { fact, dimension } = makeJoinInputs(100_000);
  const factData = createDataset(fact);
  const dimensionData = createDataset(dimension);
  console.log("joins (100,000 fact rows x 200 dimension rows)");
  await bench("join", "inner join on rep_id", 100_000, () =>
    consume(factData.join(dimensionData, { on: "rep_id", how: "inner" })),
  );
  console.log("");

  // Parsing is measured on text, since that is what a caller hands over.
  console.log("parsing");
  for (const rows of [10_000, 50_000]) {
    const csv = makeCsv(rows);
    await bench("parse", `parseDelimited ${rows.toLocaleString()} rows`, rows, () =>
      consume(parseDelimited(csv, { format: "csv", delimiter: "," })),
    );
  }
  console.log("");

  // A pipeline chain, to catch per-step overhead that single operations hide.
  const chainData = createDataset(makeSalesRows(25_000));
  console.log("pipeline (25,000 rows)");
  await bench("pipeline", "load -> filter -> sort -> validate", 25_000, async () => {
    const built = pipeline()
      .load(() => chainData)
      .transform((data) => data.filter((row) => (row.revenue as number) > 500))
      .transform((data) => data.sort("revenue", "desc"))
      .validate({ revenue: { type: "number" } })
      .build();
    consume(await built.run());
  });
  console.log("");

  const peakHeap = heapUsed();
  console.log(
    `heap after run: ${(peakHeap / 1024 / 1024).toFixed(1)}MB (delta ${((peakHeap - baselineHeap) / 1024 / 1024).toFixed(1)}MB)`,
  );

  if (jsonPath !== null) {
    writeFileSync(
      jsonPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, cases: results }, null, 2)}\n`,
    );
    console.log(`\nwrote ${jsonPath}`);
  }
}

await main();
