import { describe, it, expect } from "vitest";
import Numiq, * as named from "../../src/index.js";
import * as nodeEntry from "../../src/node.js";

describe("public surface", () => {
  const FILE_LOADERS = ["loadCSV", "loadJSON", "loadTSV"];

  const expected = [
    "Dataset",
    "createDataset",
    "renderTable",
    "loadCSV",
    "loadJSON",
    "loadTSV",
    "loadURL",
    "parseDelimited",
    "parseJSON",
    "detectDelimiter",
    "tokenize",
    "DEFAULT_NORMALIZATION",
    "resolveNormalization",
    "normalizeCell",
    "NumiqError",
    "ValidationError",
    "ImportError",
    "FormatError",
    "EnvironmentError",
    "ColumnNotFoundError",
    // 1.2.0 — distributions, regression, hypothesis tests, sampling, cohorts
    "normalCdf",
    "normalQuantile",
    "normalDistribution",
    "uniformDistribution",
    "binomialDistribution",
    "poissonDistribution",
    "tCdf",
    "tQuantile",
    "chiSquareCdf",
    "chiSquareQuantile",
    "fCdf",
    "fQuantile",
    "incompleteBeta",
    "incompleteGamma",
    "drawSamples",
    "linearRegression",
    "oneSampleTTest",
    "twoSampleTTest",
    "pairedTTest",
    "chiSquareTest",
    "oneWayAnova",
    "jarqueBeraTest",
    "meanConfidenceInterval",
    "stratifiedSample",
    "systematicSample",
    "percentChange",
    "cohortAnalysis",
    "DataSpace",
    "createDataSpace",
  ];

  it("exports every documented member by name", () => {
    for (const member of expected) {
      expect(named, `missing named export ${member}`).toHaveProperty(member);
    }
  });

  it("the default export matches the named exports exactly", () => {
    for (const member of expected) {
      expect(Numiq[member as keyof typeof Numiq], `default/${member} diverged`).toBe(
        (named as Record<string, unknown>)[member],
      );
    }
  });

  it("the Node entry re-exports the same objects", () => {
    for (const member of expected) {
      // The file loaders are the documented exception: each entry point binds its own
      // reader, so the two entries must not share these function objects.
      if (FILE_LOADERS.includes(member)) continue;
      expect((nodeEntry as Record<string, unknown>)[member], `node/${member} diverged`).toBe(
        (named as Record<string, unknown>)[member],
      );
    }
  });

  it("the Node entry binds its own file loaders", () => {
    for (const member of FILE_LOADERS) {
      expect((nodeEntry as Record<string, unknown>)[member], `node/${member} is shared`).not.toBe(
        (named as Record<string, unknown>)[member],
      );
    }
  });

  it("the Node default namespace matches its named exports", () => {
    const namespace = nodeEntry as Record<string, unknown>;
    for (const key of Object.keys(namespace).filter((name) => name !== "default")) {
      expect((nodeEntry.default as Record<string, unknown>)[key], `default.${key} diverged`).toBe(namespace[key]);
    }
  });

  it("keeps every runtime export in the default namespace (automatic parity)", () => {
    const namespace = named as Record<string, unknown>;
    const runtimeExports = Object.keys(namespace).filter((key) => key !== "default");
    expect(runtimeExports.length).toBeGreaterThan(10);
    for (const key of runtimeExports) {
      expect(Numiq, `named export "${key}" is missing from the default namespace`).toHaveProperty(key);
      expect((Numiq as Record<string, unknown>)[key], `default.${key} is not the same object`).toBe(namespace[key]);
    }
  });

  it("does not leak internal helpers", () => {
    expect(named).not.toHaveProperty("inferColumnType");
    expect(named).not.toHaveProperty("describeColumn");
    expect(named).not.toHaveProperty("setLocalFileReader");
    expect(named).not.toHaveProperty("createFileLoaders");
    expect(named).not.toHaveProperty("createNormalizedDataset");
    expect(named).not.toHaveProperty("ReportBuilder");
  });

  it("keeps the core entry free of filesystem access when the Node entry is loaded", async () => {
    // Regression: the reader used to live in module-level state, so importing the Node
    // entry silently granted filesystem access to this browser-safe entry. The reader is
    // now captured per entry point, making isolation independent of import order.
    await expect(named.loadCSV("sales.csv")).rejects.toBeInstanceOf(named.EnvironmentError);
    await expect(named.loadJSON("users.json")).rejects.toBeInstanceOf(named.EnvironmentError);
    await expect(named.loadTSV("people.tsv")).rejects.toBeInstanceOf(named.EnvironmentError);
  });

  it("supports the documented end-to-end flow", async () => {
    const data = Numiq.parseDelimited("name,score\nAda,9\nLin,7\n", { format: "csv" });
    expect(data.table()).toContain("Ada");
    expect(data.info().rowCount).toBe(2);
    expect(Numiq.createDataset(data.data).shape).toEqual([2, 2]);
  });
});

describe("display", () => {
  it("prints the table and returns the dataset", () => {
    const data = named.createDataset([{ a: 1 }]);
    const printed: string[] = [];
    const original = console.log;
    console.log = (message: string) => printed.push(message);
    try {
      expect(data.display()).toBe(data);
    } finally {
      console.log = original;
    }
    expect(printed[0]).toContain("1 rows × 1 columns");
  });
});
