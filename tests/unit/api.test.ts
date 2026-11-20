import { describe, it, expect } from "vitest";
import Numiq, * as named from "../../src/index.js";
import * as nodeEntry from "../../src/node.js";

describe("public surface", () => {
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
      expect((nodeEntry as Record<string, unknown>)[member], `node/${member} diverged`).toBe(
        (named as Record<string, unknown>)[member],
      );
    }
  });

  it("does not leak internal helpers", () => {
    expect(named).not.toHaveProperty("setLocalFileReader");
    expect(named).not.toHaveProperty("createNormalizedDataset");
    expect(named).not.toHaveProperty("ReportBuilder");
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
