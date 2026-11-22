/**
 * Pipelines, schema validation, and data lineage.
 *
 * A pipeline is a definition: building one runs nothing. That makes the same workflow
 * reusable, inspectable before it runs, and able to mix synchronous and asynchronous steps
 * without changing the calling code.
 */
import { pipeline, inferSchema, createDataset, PipelineError } from "numiq";

const sales = () => [
  { order_id: "A-1", revenue: 120.5, region: "north", at: "2026-11-01T09:00:00Z" },
  { order_id: "A-2", revenue: 0, region: "north", at: "2026-11-01T11:00:00Z" },
  { order_id: "A-3", revenue: 80, region: "south", at: "2026-11-02T10:00:00Z" },
  { order_id: "A-1", revenue: 120.5, region: "north", at: "2026-11-01T09:00:00Z" },
  { order_id: "A-4", revenue: 40, region: "south", at: "2026-11-03T15:00:00Z" },
];

const schema = {
  order_id: { type: "string" as const, nullable: false, pattern: "[A-Z]-\\d+" },
  revenue: { type: "number" as const, nullable: false, min: 0 },
  region: { type: "string" as const, allowed: ["north", "south"] },
};

// ---------------------------------------------------------------- schema validation

const dirty = createDataset([
  ...sales(),
  { order_id: "bad id", revenue: -5, region: "west", at: "2026-11-04T00:00:00Z" },
]);

const report = dirty.validate(schema);
console.log("--- validation report ---");
console.log(`valid: ${report.valid} | issues: ${report.issueCount} | invalid rows: ${report.invalidRows}`);
console.log(`checked ${report.checked} cells across ${report.columnCount} columns`);
for (const issue of report.issues) {
  console.log(`  [${issue.code}] row ${issue.row} "${issue.column}": ${issue.message}`);
}

// Infer a schema from clean data and reuse it as a starting point.
const clean = createDataset(sales());
const inferred = inferSchema(clean.data, clean.columns);
console.log("\n--- inferred schema ---");
console.log(inferred);

// ---------------------------------------------------------------- a full pipeline

const workflow = pipeline({ name: "sales" })
  .load(async () => createDataset(sales()), { name: "load-sales" })
  .transform((data) => data.filter((row) => (row.revenue as number) > 0), { name: "drop-zero" })
  .transform((data) => data.dropDuplicates(["order_id"]), { name: "dedupe" })
  .validate(schema, { name: "schema" })
  .tap((data) => console.log(`  [tap] ${data.rowCount} rows after validation`), { name: "log" })
  .build();

// describe() runs nothing, so the definition can be reviewed before it executes.
const description = workflow.describe();
console.log("\n--- pipeline description ---");
console.log(`name: ${description.name} | reproducible: ${description.reproducible}`);
console.log(`callback steps: ${description.nonDeterministic.join(", ")}`);
for (const step of description.steps) {
  console.log(`  ${step.index}. ${step.name} (${step.kind})${step.custom ? " [callback]" : " [data]"}`);
}

const result = await workflow.run();

console.log("\n--- run report ---");
console.log(`ok: ${result.ok} | executed: ${result.executed}/${result.total}`);
for (const step of result.steps) {
  console.log(`  ${step.name}: ${step.timing}, ${step.rows} rows, ${step.durationMs}ms`);
}
console.log(`result rows: ${result.dataset?.rowCount}`);

console.log("\n--- lineage ---");
for (const entry of result.lineage) {
  const added = entry.addedColumns.length ? `+${entry.addedColumns.join(",")}` : "";
  const removed = entry.removedColumns.length ? `-${entry.removedColumns.join(",")}` : "";
  console.log(`  ${entry.name}: ${entry.rows} rows, ${entry.columns.length} cols ${added} ${removed}`.trimEnd());
}

// The pipeline is reusable: running it again produces the same result.
const again = await workflow.run();
console.log(`\nreused pipeline produced identical data: ${JSON.stringify(again.dataset?.data) === JSON.stringify(result.dataset?.data)}`);

// ---------------------------------------------------------------- failure reporting

const broken = pipeline({ name: "broken" })
  .load(() => createDataset([{ id: 1, amount: -10 }]))
  .transform((data) => data, { name: "noop" })
  .validate({ amount: { min: 0 } }, { name: "amount-check" });

const failed = await broken.run();
console.log("\n--- failure report ---");
console.log(`ok: ${failed.ok} | failed at step ${failed.failedStep} (index ${failed.failedIndex})`);
console.log(`message: ${failed.steps[failed.failedIndex ?? 0]?.error?.message}`);

try {
  await broken.run({ throwOnError: true });
} catch (error) {
  if (error instanceof PipelineError) {
    console.log(`PipelineError step="${error.step}" index=${error.stepIndex} code=${error.code}`);
  }
}
