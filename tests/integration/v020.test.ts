import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCSV, loadJSON, loadTSV, createDataset, useSampleDataset } from "../../src/node.js";
import { ColumnNotFoundError, ImportError, ValidationError } from "../../src/errors/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

let projectDir: string;
let datasetDir: string;

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "numiq-v020-"));
  datasetDir = path.join(projectDir, "dataset");
  await mkdir(datasetDir, { recursive: true });
  await writeFile(path.join(datasetDir, "sales.csv"), "product,amount\nMouse,25\nKeyboard,75\n");
  await writeFile(path.join(datasetDir, "employees.tsv"), "name\trole\nAda\tEngineer\n");
  await writeFile(path.join(datasetDir, "customers.json"), '[{"name":"Ada"},{"name":"Lin"}]');
  // A file outside the dataset folder, reachable only by escaping the sandbox.
  await writeFile(path.join(projectDir, "secret.csv"), "token\ns3cr3t\n");
  await symlink(path.join(projectDir, "secret.csv"), path.join(datasetDir, "link.csv"));
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("project dataset folder", () => {
  it("loads a bare filename from <root>/dataset", async () => {
    const data = await loadCSV("sales.csv", { datasetDir: projectDir });
    expect(data.columns).toEqual(["product", "amount"]);
    expect(data.rowCount).toBe(2);
  });

  it("loads TSV and JSON the same way", async () => {
    const tsv = await loadTSV("employees.tsv", { datasetDir: projectDir });
    expect(tsv.columns).toEqual(["name", "role"]);
    const json = await loadJSON("customers.json", { datasetDir: projectDir });
    expect(json.rowCount).toBe(2);
  });

  it("rejects an absolute path", async () => {
    await expect(loadCSV(path.join(datasetDir, "sales.csv"), { datasetDir: projectDir })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects parent traversal", async () => {
    await expect(loadCSV("../secret.csv", { datasetDir: projectDir })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects Windows separators on any platform", async () => {
    await expect(loadCSV("..\\secret.csv", { datasetDir: projectDir })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a nested path", async () => {
    await expect(loadCSV("sub/sales.csv", { datasetDir: projectDir })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a symlink that escapes the dataset folder", async () => {
    await expect(loadCSV("link.csv", { datasetDir: projectDir })).rejects.toBeInstanceOf(ImportError);
  });

  it("reports a missing file with the expected path", async () => {
    await expect(loadCSV("absent.csv", { datasetDir: projectDir })).rejects.toThrow(/absent\.csv/);
  });

  it("reports a missing dataset folder with guidance", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "numiq-empty-"));
    try {
      await expect(loadCSV("sales.csv", { datasetDir: empty })).rejects.toThrow(/dataset folder/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects an empty filename", async () => {
    await expect(loadCSV("", { datasetDir: projectDir })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("useSampleDataset", () => {
  it("has exactly 7 columns and 50 rows", async () => {
    const sample = await useSampleDataset();
    expect(sample.shape).toEqual([50, 7]);
    expect(sample.columns).toEqual(["order_id", "date", "product", "category", "region", "quantity", "revenue"]);
  });

  it("carries an import report naming the sample source", async () => {
    const sample = await useSampleDataset();
    expect(sample.importReport?.source).toBe("sample-sales");
    expect(sample.importReport?.rowsRead).toBe(50);
  });

  it("is deterministic across calls", async () => {
    const [a, b] = await Promise.all([useSampleDataset(), useSampleDataset()]);
    expect(a.data).toEqual(b.data);
  });

  it("does not depend on the consumer's dataset folder", async () => {
    const sample = await useSampleDataset();
    expect(sample.rowCount).toBe(50);
  });

  it("embeds a copy identical to the checked-in CSV asset", async () => {
    // The drift risk is between assets/sample-sales.csv and the generated module that is
    // bundled into the package, not between the asset and parsed values (which are
    // normalized: "48.00" legitimately becomes the number 48).
    const asset = await readFile(path.join(repoRoot, "assets", "sample-sales.csv"), "utf8");
    const { SAMPLE_SALES_CSV } = await import("../../src/data/sample-sales.js");
    expect(SAMPLE_SALES_CSV).toBe(asset);
  });

  it("infers sensible types", async () => {
    const sample = await useSampleDataset();
    expect(sample.dtypes.quantity).toBe("integer");
    expect(sample.dtypes.revenue).toBe("number");
    expect(sample.dtypes.date).toBe("date");
  });
});

describe("fluent API", () => {
  const rows = [
    { product: "A", revenue: 10 },
    { product: "B", revenue: 300 },
    { product: "C", revenue: 50 },
    { product: "D", revenue: 300 },
  ];

  it("returns a Dataset from every transformation", () => {
    const data = createDataset(rows);
    expect(data.filter((row) => Number(row.revenue) > 0).constructor.name).toBe("Dataset");
    expect(data.sort("revenue").constructor.name).toBe("Dataset");
    expect(data.select(["product"]).constructor.name).toBe("Dataset");
    expect(data.limit(1).constructor.name).toBe("Dataset");
  });

  it("chains in the documented order", () => {
    const result = createDataset(rows)
      .filter((row) => Number(row.revenue) > 20)
      .sort("revenue", "desc")
      .select(["product", "revenue"])
      .limit(2);
    expect(result.data).toEqual([
      { product: "B", revenue: 300 },
      { product: "D", revenue: 300 },
    ]);
  });

  it("leaves the original dataset unchanged", () => {
    const data = createDataset(rows);
    data
      .filter((row) => Number(row.revenue) > 100)
      .sort("revenue", "desc")
      .limit(1);
    expect(data.rowCount).toBe(4);
    expect(data.columns).toEqual(["product", "revenue"]);
    expect(data.data[0]).toEqual({ product: "A", revenue: 10 });
  });

  it("refuses a predicate that writes to the row it is given", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    expect(() =>
      data.filter((row) => {
        (row as Record<string, unknown>).a = 999;
        return true;
      }),
    ).toThrow(TypeError);
    expect(data.data).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("keeps ties in their original order", () => {
    const sorted = createDataset(rows).sort("revenue", "desc");
    expect(sorted.data.map((row) => row.product)).toEqual(["B", "D", "C", "A"]);
  });

  it("sorts nulls last in both directions", () => {
    const data = createDataset([{ v: 2 }, { v: null }, { v: 1 }]);
    expect(data.sort("v").data.map((row) => row.v)).toEqual([1, 2, null]);
    expect(data.sort("v", "desc").data.map((row) => row.v)).toEqual([2, 1, null]);
  });

  it("selects columns in the requested order", () => {
    const data = createDataset(rows).select(["revenue", "product"]);
    expect(data.columns).toEqual(["revenue", "product"]);
  });

  it("drops the import report on derived datasets", async () => {
    const sample = await useSampleDataset();
    expect(sample.limit(5).importReport).toBeNull();
    expect(sample.filter(() => true).importReport).toBeNull();
  });

  it("rejects an unknown column", () => {
    const data = createDataset(rows);
    expect(() => data.sort("nope")).toThrow(ColumnNotFoundError);
    expect(() => data.select(["nope"])).toThrow(ColumnNotFoundError);
  });

  it("rejects invalid arguments", () => {
    const data = createDataset(rows);
    expect(() => data.limit(-1)).toThrow(ValidationError);
    expect(() => data.limit(1.5)).toThrow(ValidationError);
    expect(() => data.select([])).toThrow(ValidationError);
    expect(() => data.select(["product", "product"])).toThrow(ValidationError);
    expect(() => data.sort("revenue", "sideways" as "asc")).toThrow(ValidationError);
  });

  it("works end to end on the sample dataset", async () => {
    const sample = await useSampleDataset();
    const top = sample
      .filter((row) => Number(row.revenue) > 100)
      .sort("revenue", "desc")
      .select(["order_id", "product", "revenue"])
      .limit(10);
    expect(top.rowCount).toBeLessThanOrEqual(10);
    expect(top.columns).toEqual(["order_id", "product", "revenue"]);
    const revenues = top.data.map((row) => Number(row.revenue));
    expect([...revenues].sort((a, b) => b - a)).toEqual(revenues);
  });
});
