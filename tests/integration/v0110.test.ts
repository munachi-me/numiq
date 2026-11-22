import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { pipeline } from "../../src/core/pipeline.js";
import { inferSchema } from "../../src/core/validation.js";

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

describe("v0.11.0 — pipeline workflow", () => {
  it("runs the documented workflow end to end", async () => {
    const result = await pipeline({ name: "sales" })
      .load(() => createDataset(sales()), { name: "load-sales" })
      .transform((data) => data.filter((row) => (row.revenue as number) > 0), { name: "drop-zero" })
      .transform((data) => data.dropDuplicates(["order_id"]), { name: "dedupe" })
      .validate(schema, { name: "schema" })
      .run();

    expect(result.ok).toBe(true);
    expect(result.dataset?.rowCount).toBe(3);
    expect(result.dataset?.columns).toEqual(["order_id", "revenue", "region", "at"]);
    expect(result.steps.map((step) => step.name)).toEqual(["load-sales", "drop-zero", "dedupe", "schema"]);
    expect(result.executed).toBe(4);
  });

  it("reports lineage that explains the row count at each stage", async () => {
    const result = await pipeline()
      .load(() => createDataset(sales()), { name: "source" })
      .transform((data) => data.filter((row) => (row.revenue as number) > 0), { name: "positive" })
      .transform((data) => data.dropDuplicates(["order_id"]), { name: "dedupe" })
      .run();

    expect(result.lineage.map((entry) => entry.rows)).toEqual([5, 4, 3]);
    expect(result.lineage.map((entry) => entry.addedColumns)).toEqual([
      ["order_id", "revenue", "region", "at"],
      [],
      [],
    ]);
  });

  it("keeps working when a step is asynchronous", async () => {
    const result = await pipeline()
      .load(async () => createDataset(sales()), { name: "fetch" })
      .transform((data) => data.filter((row) => (row.revenue as number) > 0), { name: "positive" })
      .validate(schema, { name: "schema" })
      .run();

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.timing)).toEqual(["async", "sync", "sync"]);
    // No dedupe step here, so all four positive-revenue rows survive.
    expect(result.dataset?.rowCount).toBe(4);
  });

  it("stops at the schema step and names it when data is invalid", async () => {
    const dirty = () => [...sales(), { order_id: "bad id", revenue: -5, region: "west", at: "2026-11-04T00:00:00Z" }];
    const result = await pipeline()
      .load(() => createDataset(dirty()))
      .transform((data) => data, { name: "noop" })
      .validate(schema, { name: "schema" })
      .run();

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("schema");
    const issues = result.steps[2]?.validation?.issues ?? [];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.code === "PATTERN_MISMATCH")).toBe(true);
    expect(issues.some((issue) => issue.code === "BELOW_MINIMUM")).toBe(true);
    expect(issues.some((issue) => issue.code === "NOT_ALLOWED")).toBe(true);
  });

  it("composes with the earlier release features", async () => {
    const result = await pipeline()
      .load(() => createDataset(sales()))
      .transform((data) => data.filter((row) => (row.revenue as number) > 0))
      .transform((data) => data.extractPeriod("day", "at", "day"))
      .transform((data) => data.resample({ every: "day", timeColumn: "at", aggregate: { revenue: "sum" } }))
      .run();

    expect(result.ok).toBe(true);
    expect(result.dataset?.columns).toContain("period");
    expect(result.dataset?.rowCount).toBe(3);
  });

  it("validates a schema inferred from clean data", async () => {
    const clean = createDataset(sales());
    const inferred = inferSchema(clean.data, clean.columns);
    const result = await pipeline()
      .load(() => clean)
      .validate(inferred, { name: "inferred" })
      .run();
    expect(result.ok).toBe(true);
  });

  it("reports the same result when the pipeline is reused", async () => {
    const p = pipeline()
      .load(() => createDataset(sales()))
      .transform((data) => data.dropDuplicates(["order_id"]))
      .validate(schema);
    const first = await p.run();
    const second = await p.run();
    expect(first.dataset?.data).toEqual(second.dataset?.data);
    expect(first.lineage).toEqual(second.lineage);
  });

  it("describes the pipeline as data without running it", () => {
    const description = pipeline({ name: "sales" })
      .load(() => createDataset(sales()), { name: "load" })
      .validate(schema, { name: "schema" })
      .describe();

    expect(description.name).toBe("sales");
    expect(description.reproducible).toBe(false);
    expect(description.nonDeterministic).toEqual(["load"]);
    // The schema step is pure data, so it is inspectable even though the load step is not.
    expect(description.steps[1]?.schema).toEqual(schema);
  });
});
