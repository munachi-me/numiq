import { describe, expect, it } from "vitest";
import { loadCSV } from "../../src/node.js";
import { useSampleDataset } from "../../src/core/sample.js";

describe("describe on a loaded dataset", () => {
  it("profiles every column of the bundled sample", async () => {
    const sample = await useSampleDataset();
    const description = sample.describe();

    expect(description.rowCount).toBe(sample.rowCount);
    expect(description.columnCount).toBe(sample.columnCount);
    expect(description.columns).toEqual([...sample.columns]);
  });

  it("agrees with the dataset's own column view", async () => {
    const sample = await useSampleDataset();
    for (const column of sample.columns) {
      const profile = sample.describe(column);
      const view = sample.column(column);
      expect(profile.count).toBe(view.values.length - view.missing);
      expect(profile.missing).toBe(view.missing);
      expect(profile.unique).toBe(view.unique);
    }
  });

  it("sums revenue the same way the grouping engine does", async () => {
    const sample = await useSampleDataset();
    const grouped = sample.groupBy("region").aggregate({
      total: { column: "revenue", op: "sum" },
      mean: { column: "revenue", op: "mean" },
    });
    const profile = sample.describe("revenue");

    const groupedTotal = grouped.data.reduce((total, row) => total + Number(row.total), 0);
    expect(groupedTotal).toBeCloseTo(Number(profile.sum), 6);

    // The mean of group means, weighted by group size, is the overall mean.
    const sizes = sample.groupBy("region").sizes;
    const weighted =
      grouped.data.reduce((total, row, index) => total + Number(row.mean) * (sizes[index] ?? 0), 0) / sample.rowCount;
    expect(weighted).toBeCloseTo(Number(profile.mean), 6);
  });

  it("reports arithmetic only for numeric columns of the sample", async () => {
    const sample = await useSampleDataset();
    const description = sample.describe();

    for (const profile of description.profiles) {
      if (profile.kind === "numeric") {
        expect(profile.sum).not.toBeNull();
        expect(profile.mean).not.toBeNull();
      } else {
        expect(profile.sum).toBeNull();
        expect(profile.mean).toBeNull();
        expect(profile.median).toBeNull();
        expect(profile.variance).toBeNull();
      }
    }
  });

  it("counts every row exactly once across columns", async () => {
    const sample = await useSampleDataset();
    for (const profile of sample.describe().profiles) {
      expect(profile.count + profile.missing).toBe(sample.rowCount);
    }
  });

  it("works on a CSV loaded from disk", async () => {
    const data = await loadCSV("sales.csv");
    const description = data.describe();
    expect(description.rowCount).toBe(data.rowCount);
    expect(description.get("amount").kind).toBe("numeric");
  });

  it("keeps the description independent of later derivations", async () => {
    const sample = await useSampleDataset();
    const description = sample.describe();
    sample.filter((row) => Number(row.revenue) > 1e9);
    expect(description.rowCount).toBe(sample.rowCount);
  });
});
