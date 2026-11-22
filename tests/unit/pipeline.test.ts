import { describe, it, expect, vi } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { pipeline, Pipeline, PipelineError } from "../../src/core/pipeline.js";
import { ValidationError } from "../../src/errors/index.js";

const rows = () => [
  { id: 1, revenue: 100, region: "north" },
  { id: 2, revenue: 0, region: "south" },
  { id: 3, revenue: 250, region: "north" },
];

describe("pipeline definition", () => {
  it("builds nothing when a pipeline is defined", async () => {
    const loader = vi.fn(() => createDataset(rows()));
    const p = pipeline().load(loader);
    expect(loader).not.toHaveBeenCalled();
    expect(p.length).toBe(1);
  });

  it("is chainable and keeps step order", () => {
    const p = pipeline()
      .load(() => createDataset(rows()), { name: "source" })
      .transform((data) => data.limit(2), { name: "trim" })
      .validate({ id: { type: "integer" } }, { name: "check" });
    expect(p.stepNames).toEqual(["source", "trim", "check"]);
  });

  it("names steps automatically when none is given", () => {
    const p = pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data);
    expect(p.stepNames).toEqual(["load-1", "transform-2"]);
  });

  it("rejects a pipeline that does not start with a load step", () => {
    expect(() => pipeline().transform((data) => data)).toThrow(/must start with a load step/);
  });

  it("rejects a second load step", () => {
    const p = pipeline().load(() => createDataset(rows()));
    expect(() => p.load(() => createDataset(rows()))).toThrow(/must be the first step/);
  });

  it("rejects duplicate step names", () => {
    const p = pipeline().load(() => createDataset(rows()), { name: "a" });
    expect(() => p.transform((data) => data, { name: "a" })).toThrow(/Duplicate step name/);
  });

  it("rejects an empty step name at the step that declares it", () => {
    expect(() => pipeline().load(() => createDataset(rows()), { name: "  " })).toThrow(/non-empty string/);
  });

  it("rejects a non-function transform", () => {
    const p = pipeline().load(() => createDataset(rows()));
    expect(() => p.transform("nope" as never)).toThrow(ValidationError);
  });
});

describe("pipeline execution — synchronous steps", () => {
  it("runs every step and returns the final dataset", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.filter((row) => (row.revenue as number) > 0))
      .run();
    expect(result.ok).toBe(true);
    expect(result.dataset?.rowCount).toBe(2);
    expect(result.executed).toBe(2);
    expect(result.total).toBe(2);
  });

  it("marks synchronous steps as sync", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data)
      .run();
    expect(result.steps.map((step) => step.timing)).toEqual(["sync", "sync"]);
  });

  it("records row and column counts per step", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.limit(2))
      .run();
    expect(result.steps[0]?.rows).toBe(3);
    expect(result.steps[0]?.columns).toBe(3);
    expect(result.steps[1]?.rows).toBe(2);
  });

  it("accepts an array of rows from a transform", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform(() => [{ id: 9 }])
      .run();
    expect(result.dataset?.columns).toEqual(["id"]);
  });

  it("accepts a column-oriented object from a load step", async () => {
    const result = await pipeline()
      .load(() => ({ id: [1, 2] }))
      .run();
    expect(result.dataset?.rowCount).toBe(2);
  });
});

describe("pipeline execution — asynchronous steps", () => {
  it("awaits a promise returned by a load step", async () => {
    const result = await pipeline()
      .load(async () => createDataset(rows()))
      .run();
    expect(result.ok).toBe(true);
    expect(result.steps[0]?.timing).toBe("async");
  });

  it("awaits a promise returned by a transform", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform(async (data) => data.limit(1))
      .run();
    expect(result.dataset?.rowCount).toBe(1);
    expect(result.steps[1]?.timing).toBe("async");
  });

  it("mixes synchronous and asynchronous steps in one pipeline", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.limit(3))
      .transform(async (data) => data.limit(2))
      .transform((data) => data.limit(1))
      .run();
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.timing)).toEqual(["sync", "sync", "async", "sync"]);
    expect(result.dataset?.rowCount).toBe(1);
  });

  it("awaits an async tap without replacing the dataset", async () => {
    const seen: number[] = [];
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .tap(async (data) => {
        await Promise.resolve();
        seen.push(data.rowCount);
      })
      .run();
    expect(seen).toEqual([3]);
    expect(result.dataset?.rowCount).toBe(3);
  });
});

describe("pipeline execution — failures", () => {
  it("returns ok false and names the failing step", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform(
        () => {
          throw new Error("kaboom");
        },
        { name: "explode" },
      )
      .run();
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("explode");
    expect(result.failedIndex).toBe(1);
    expect(result.dataset).toBeNull();
  });

  it("keeps reports for the steps that succeeded", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.limit(1), { name: "ok" })
      .transform(
        () => {
          throw new Error("bad");
        },
        { name: "bad" },
      )
      .run();
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2]?.error?.message).toBe("bad");
  });

  it("stops at the failing step and does not run later ones", async () => {
    const later = vi.fn((data: unknown) => data);
    await pipeline()
      .load(() => createDataset(rows()))
      .transform(() => {
        throw new Error("bad");
      })
      .transform(later as never)
      .run();
    expect(later).not.toHaveBeenCalled();
  });

  it("records an async rejection with async timing", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform(async () => {
        throw new Error("async bad");
      })
      .run();
    expect(result.ok).toBe(false);
    expect(result.steps[1]?.timing).toBe("async");
    expect(result.steps[1]?.error?.message).toBe("async bad");
  });

  it("carries the Numiq error code when the failure has one", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.select(["missing"]))
      .run();
    expect(result.steps[1]?.error?.code).toBe("COLUMN_NOT_FOUND");
  });

  it("throws a PipelineError naming the step when asked", async () => {
    const p = pipeline({ name: "orders" })
      .load(() => createDataset(rows()))
      .transform(
        () => {
          throw new Error("bad");
        },
        { name: "explode" },
      );
    await expect(p.run({ throwOnError: true })).rejects.toThrow(PipelineError);
    await expect(p.run({ throwOnError: true })).rejects.toThrow(/orders.*step 2 of 2.*explode/);
  });

  it("exposes the step index and original error on PipelineError", async () => {
    const p = pipeline()
      .load(() => createDataset(rows()))
      .transform(
        () => {
          throw new Error("original");
        },
        { name: "boom" },
      );
    const error = await p.run({ throwOnError: true }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipelineError);
    const pipelineError = error as PipelineError;
    expect(pipelineError.step).toBe("boom");
    expect(pipelineError.stepIndex).toBe(1);
    expect(pipelineError.stepKind).toBe("transform");
    expect((pipelineError.original as Error).message).toBe("original");
  });

  it("rejects a transform that returns something unusable", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform(() => 42)
      .run();
    expect(result.ok).toBe(false);
    expect(result.steps[1]?.error?.message).toMatch(/must return a Dataset or an array of rows/);
  });

  it("reports a load step that produces nothing usable", async () => {
    const result = await pipeline()
      .load(() => "nope")
      .run();
    expect(result.ok).toBe(false);
    expect(result.steps[0]?.error?.message).toMatch(/did not produce a usable dataset/);
  });

  it("runs an empty pipeline without throwing", async () => {
    const result = await pipeline().run();
    expect(result.ok).toBe(false);
    expect(result.total).toBe(0);
  });
});

describe("pipeline validation steps", () => {
  it("passes when the data matches the schema", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate({ revenue: { type: "integer", min: 0 } })
      .run();
    expect(result.ok).toBe(true);
    expect(result.steps[1]?.validation?.valid).toBe(true);
  });

  it("fails the pipeline when validation fails", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate({ revenue: { type: "integer", min: 1 } }, { name: "check" })
      .run();
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("check");
    expect(result.steps[1]?.error?.message).toMatch(/failed validation/);
  });

  it("attaches the validation report to the failing step", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate({ revenue: { min: 1 } })
      .run();
    expect(result.steps[1]?.validation?.valid).toBe(false);
    expect(result.steps[1]?.validation?.issueCount).toBe(1);
  });

  it("accepts a schema computed from the incoming dataset", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate((data) => {
        expect(data.columns).toContain("revenue");
        return { id: { type: "integer" } };
      })
      .run();
    expect(result.ok).toBe(true);
  });

  it("reports a missing column as a validation failure", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate({ absent: {} })
      .run();
    expect(result.ok).toBe(false);
    expect(result.steps[1]?.validation?.issues[0]?.code).toBe("MISSING_COLUMN");
  });

  it("does not modify the dataset when validation passes", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .validate({ id: {} })
      .run();
    expect(result.dataset?.data).toEqual(createDataset(rows()).data);
  });
});

describe("pipeline lineage", () => {
  it("records one entry per step in order", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()), { name: "source" })
      .transform((data) => data.drop(["region"]), { name: "narrow" })
      .transform((data) => data.addColumn("flag", () => true), { name: "widen" })
      .run();
    expect(result.lineage.map((entry) => entry.name)).toEqual(["source", "narrow", "widen"]);
  });

  it("records added and removed columns per step", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()), { name: "source" })
      .transform((data) => data.drop(["region"]), { name: "narrow" })
      .transform((data) => data.addColumn("flag", () => true), { name: "widen" })
      .run();
    expect(result.lineage[1]?.removedColumns).toEqual(["region"]);
    expect(result.lineage[2]?.addedColumns).toEqual(["flag"]);
  });

  it("keeps lineage metadata out of the row values", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.limit(1))
      .run();
    const row = result.dataset?.data[0] ?? {};
    expect(Object.keys(row)).toEqual(["id", "revenue", "region"]);
  });

  it("stops lineage at the last step that completed", async () => {
    const result = await pipeline()
      .load(() => createDataset(rows()), { name: "source" })
      .transform(
        () => {
          throw new Error("bad");
        },
        { name: "bad" },
      )
      .run();
    expect(result.lineage.map((entry) => entry.name)).toEqual(["source"]);
  });

  it("exposes lineage on the pipeline after a successful run", async () => {
    const p = pipeline().load(() => createDataset(rows()));
    expect(p.lineage).toEqual([]);
    await p.run();
    expect(p.lineage).toHaveLength(1);
  });

  it("returns a copy so mutating it cannot corrupt the pipeline", async () => {
    const p = pipeline().load(() => createDataset(rows()));
    await p.run();
    const lineage = p.lineage as Array<{ name: string }>;
    lineage[0]!.name = "hacked";
    expect(p.lineage[0]?.name).toBe("load-1");
  });
});

describe("pipeline reuse and reproducibility", () => {
  it("runs the same pipeline twice with the same result", async () => {
    const p = pipeline()
      .load(() => createDataset(rows()))
      .transform((data) => data.filter((row) => (row.revenue as number) > 0));
    const first = await p.run();
    const second = await p.run();
    expect(first.dataset?.data).toEqual(second.dataset?.data);
  });

  it("is not affected by mutating the input after definition", async () => {
    const input = rows();
    const p = pipeline().load(() => createDataset(input));
    input.push({ id: 99, revenue: 1, region: "west" });
    const result = await p.run();
    expect(result.dataset?.rowCount).toBe(4);
  });

  it("reports a definition with callbacks as not reproducible", () => {
    const description = pipeline()
      .load(() => createDataset(rows()))
      .describe();
    expect(description.reproducible).toBe(false);
    expect(description.nonDeterministic).toEqual(["load-1"]);
  });

  it("reports every custom step by name", () => {
    const description = pipeline()
      .load(() => createDataset(rows()), { name: "load" })
      .transform((data) => data, { name: "clean" })
      .describe();
    expect(description.nonDeterministic).toEqual(["load", "clean"]);
  });

  it("describes step kinds without running them", () => {
    const loader = vi.fn(() => createDataset(rows()));
    const description = pipeline()
      .load(loader, { name: "source" })
      .transform((data) => data, { name: "clean" })
      .validate({ id: {} }, { name: "check" })
      .tap(() => undefined, { name: "log" })
      .describe();
    expect(description.steps.map((step) => step.kind)).toEqual(["load", "transform", "validate", "tap"]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("includes a data-only schema in the description", () => {
    const description = pipeline()
      .load(() => createDataset(rows()))
      .validate({ id: { type: "integer" } }, { name: "check" })
      .describe();
    expect(description.steps[1]?.schema).toEqual({ id: { type: "integer" } });
    expect(description.steps[1]?.custom).toBe(false);
  });

  it("clones a stored schema so later mutation cannot change it", async () => {
    const schema = { id: { type: "integer" as const } };
    const p = pipeline()
      .load(() => createDataset(rows()))
      .validate(schema, { name: "check" });
    schema.id = { type: "string" as never };
    const result = await p.run();
    expect(result.ok).toBe(true);
  });

  it("marks a callback schema as custom", () => {
    const description = pipeline()
      .load(() => createDataset(rows()))
      .validate(() => ({ id: {} }), { name: "check" })
      .describe();
    expect(description.steps[1]?.custom).toBe(true);
    expect(description.steps[1]?.schema).toBeUndefined();
  });
});

describe("Pipeline class", () => {
  it("can be constructed directly", async () => {
    const p = new Pipeline({ name: "direct" });
    expect(p.name).toBe("direct");
    p.load(() => createDataset(rows()));
    expect((await p.run()).ok).toBe(true);
  });

  it("defaults its name", () => {
    expect(new Pipeline().name).toBe("Pipeline");
  });

  it("passes step context to callbacks", async () => {
    const contexts: Array<{ index: number; name: string; total: number }> = [];
    await pipeline()
      .load((context) => {
        contexts.push(context);
        return createDataset(rows());
      })
      .transform((data, context) => {
        contexts.push({ index: context.index, name: context.name, total: context.total });
        return data;
      })
      .run();
    expect(contexts).toEqual([
      { index: 0, name: "load-1", total: 2 },
      { index: 1, name: "transform-2", total: 2 },
    ]);
  });

  it("gives a transform the incoming dataset as context input", async () => {
    let seen = 0;
    await pipeline()
      .load(() => createDataset(rows()))
      .transform((data, context) => {
        seen = context.input?.rowCount ?? 0;
        return data;
      })
      .run();
    expect(seen).toBe(3);
  });
});
