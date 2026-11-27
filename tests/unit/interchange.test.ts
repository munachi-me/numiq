import { describe, expect, it } from "vitest";
import {
  chunkDelimited,
  collectChunks,
  createDataset,
  fromInterchange,
  fromTableData,
  isInterchangePayload,
  reduceChunks,
  toCSV,
  toInterchange,
  toObjects,
  toTableData,
} from "../../src/index.js";
import { ValidationError } from "../../src/errors/index.js";
import type { InterchangePayload } from "../../src/index.js";

const rows = [
  { region: "north", revenue: 120.5, active: true },
  { region: "south", revenue: 80, active: false },
  { region: "east", revenue: null, active: true },
];

const dataset = () => createDataset(rows, { name: "sales" });

describe("toTableData / fromTableData", () => {
  it("produces a header plus row-major cells", () => {
    const table = toTableData(dataset());
    expect(table.columns).toEqual(["region", "revenue", "active"]);
    expect(table.rows).toEqual([
      ["north", 120.5, true],
      ["south", 80, false],
      ["east", null, true],
    ]);
  });

  it("round-trips through fromTableData", () => {
    const table = toTableData(dataset());
    const rebuilt = fromTableData(table, { name: "sales" });
    expect(rebuilt.columns).toEqual(dataset().columns);
    expect(rebuilt.data).toEqual(dataset().data);
  });

  it("rejects a non-table input", () => {
    expect(() => fromTableData({} as never)).toThrow(ValidationError);
    expect(() => fromTableData({ columns: [], rows: [] })).toThrow(/at least one column/);
  });

  it("rejects a row that is not an array", () => {
    expect(() => fromTableData({ columns: ["a"], rows: ["x" as never] })).toThrow(/not an array/);
  });

  it("pads a short row with null by default", () => {
    const rebuilt = fromTableData({ columns: ["a", "b"], rows: [[1]] });
    expect(rebuilt.data).toEqual([{ a: 1, b: null }]);
  });

  it("truncates a long row by default", () => {
    const rebuilt = fromTableData({ columns: ["a"], rows: [[1, 2]] });
    expect(rebuilt.data).toEqual([{ a: 1 }]);
  });

  it("throws on a ragged row in strict mode", () => {
    expect(() => fromTableData({ columns: ["a", "b"], rows: [[1]] }, { strict: true })).toThrow(
      /has 1 cells but there are 2 columns/,
    );
    expect(() => fromTableData({ columns: ["a"], rows: [[1, 2]] }, { strict: true })).toThrow(/has 2 cells/);
  });
});

describe("toObjects", () => {
  it("returns plain records", () => {
    expect(toObjects(dataset())[0]).toEqual(rows[0]);
  });

  it("returns fresh objects a caller may mutate", () => {
    const objects = toObjects(dataset());
    objects[0]!.region = "changed";
    expect(dataset().data[0]?.region).toBe("north");
  });
});

describe("toCSV", () => {
  it("writes a header and rows", () => {
    const csv = toCSV(createDataset([{ a: 1, b: "x" }]));
    expect(csv).toBe("a,b\n1,x");
  });

  it("writes missing values as empty fields", () => {
    const csv = toCSV(createDataset([{ a: null, b: "x" }]));
    expect(csv).toBe("a,b\n,x");
  });

  it("quotes fields holding the delimiter", () => {
    const csv = toCSV(createDataset([{ a: "x,y" }]));
    expect(csv).toBe('a\n"x,y"');
  });

  it("escapes embedded quotes by doubling", () => {
    const csv = toCSV(createDataset([{ a: 'he said "hi"' }]));
    expect(csv).toBe('a\n"he said ""hi"""');
  });

  it("quotes fields holding a newline", () => {
    const csv = toCSV(createDataset([{ a: "line1\nline2" }]));
    expect(csv).toBe('a\n"line1\nline2"');
  });

  it("omits the header when asked", () => {
    expect(toCSV(createDataset([{ a: 1 }]), { header: false })).toBe("1");
  });

  it("honours a custom delimiter and newline", () => {
    const csv = toCSV(createDataset([{ a: 1, b: 2 }]), { delimiter: "\t", newline: "\r\n" });
    expect(csv).toBe("a\tb\r\n1\t2");
  });

  it("rejects a multi-character delimiter", () => {
    expect(() => toCSV(createDataset([{ a: 1 }]), { delimiter: "::" })).toThrow(ValidationError);
  });
});

describe("interchange payload", () => {
  it("carries the format marker and version", () => {
    const payload = toInterchange(dataset());
    expect(payload.format).toBe("numiq.table");
    expect(payload.version).toBe(1);
    expect(payload.missingValue).toBeNull();
  });

  it("describes every column with a role", () => {
    const payload = toInterchange(dataset());
    expect(payload.columns).toEqual([
      { name: "region", type: "string", nullable: false, role: "dimension" },
      { name: "revenue", type: "number", nullable: true, role: "measure" },
      { name: "active", type: "boolean", nullable: false, role: "dimension" },
    ]);
  });

  it("reports shape and metadata", () => {
    const payload = toInterchange(dataset());
    expect(payload.rowCount).toBe(3);
    expect(payload.columnCount).toBe(3);
    expect(payload.name).toBe("sales");
    expect(payload.metadata).toEqual({});
  });

  it("uses null for missing cells", () => {
    const payload = toInterchange(dataset());
    expect(payload.rows[2]).toEqual(["east", null, true]);
  });

  it("round-trips through fromInterchange", () => {
    const rebuilt = fromInterchange(toInterchange(dataset()));
    expect(rebuilt.columns).toEqual(dataset().columns);
    expect(rebuilt.data).toEqual(dataset().data);
    expect(rebuilt.name).toBe("sales");
  });

  it("recognises a valid payload", () => {
    expect(isInterchangePayload(toInterchange(dataset()))).toBe(true);
    expect(isInterchangePayload(null)).toBe(false);
    expect(isInterchangePayload({})).toBe(false);
    expect(isInterchangePayload({ format: "numiq.table", version: 2, columns: [], rows: [] })).toBe(false);
    expect(isInterchangePayload({ format: "other", version: 1, columns: [], rows: [] })).toBe(false);
  });

  it("rejects an invalid payload in fromInterchange", () => {
    expect(() => fromInterchange({ format: "nope" } as unknown as InterchangePayload)).toThrow(
      /format "numiq.table" and version 1/,
    );
  });

  it("classifies column roles from dtype", () => {
    const payload = toInterchange(createDataset([{ d: "2026-01-01", n: 1, s: "x" }]));
    const roles = new Map(payload.columns.map((column) => [column.name, column.role]));
    expect(roles.get("d")).toBe("temporal");
    expect(roles.get("n")).toBe("measure");
    expect(roles.get("s")).toBe("dimension");
  });
});

describe("chunkDelimited", () => {
  const csv = ["id,name", "1,Ada", "2,Grace", "3,Alan", "4,Edsger", "5,Barbara"].join("\n");

  it("splits into chunks of the requested size", () => {
    const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2 })];
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.rowCount)).toEqual([2, 2, 1]);
  });

  it("gives every chunk the same columns", () => {
    for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 2 })) {
      expect(chunk.columns).toEqual(["id", "name"]);
    }
  });

  it("delivers every row exactly once and in order", () => {
    const names = [...chunkDelimited(csv, "csv", { chunkSize: 2 })].flatMap((chunk) =>
      chunk.data.map((row) => row.name),
    );
    expect(names).toEqual(["Ada", "Grace", "Alan", "Edsger", "Barbara"]);
  });

  it("keeps a quoted newline inside one record", () => {
    const quoted = ["id,note", '1,"line one', 'line two"', "2,plain"].join("\n");
    const chunks = [...chunkDelimited(quoted, "csv", { chunkSize: 1 })];
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.data[0]?.note).toBe("line one\nline two");
    expect(chunks[1]?.data[0]?.note).toBe("plain");
  });

  it("reports progress after each chunk", () => {
    const seen: number[] = [];
    const iterator = chunkDelimited(csv, "csv", {
      chunkSize: 2,
      onProgress: (progress) => {
        seen.push(progress.delivered);
      },
    });
    while (iterator.next().done !== true) {
      // drain
    }
    expect(seen).toEqual([2, 4, 5]);
  });

  it("stops early when onProgress returns false", () => {
    const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2, onProgress: () => false })];
    expect(chunks).toHaveLength(1);
  });

  it("stops when the signal is aborted", () => {
    const controller = new AbortController();
    const chunks: unknown[] = [];
    for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 1, signal: controller.signal })) {
      chunks.push(chunk);
      controller.abort();
    }
    expect(chunks).toHaveLength(1);
  });

  it("rejects a bad chunk size", () => {
    expect(() => [...chunkDelimited(csv, "csv", { chunkSize: 0 })]).toThrow(/positive integer/);
    expect(() => [...chunkDelimited(csv, "csv", { chunkSize: 1.5 })]).toThrow(/positive integer/);
  });

  it("rejects a bad format", () => {
    expect(() => [...chunkDelimited(csv, "json" as never)]).toThrow(/must be "csv" or "tsv"/);
  });

  it("returns nothing for a header-only file", () => {
    expect([...chunkDelimited("a,b", "csv")]).toEqual([]);
  });

  it("handles TSV", () => {
    const tsv = ["a\tb", "1\t2", "3\t4"].join("\n");
    const chunks = [...chunkDelimited(tsv, "tsv", { chunkSize: 1 })];
    expect(chunks.map((chunk) => chunk.rowCount)).toEqual([1, 1]);
    expect(chunks[0]?.data[0]).toEqual({ a: 1, b: 2 });
  });

  it("is lazy: nothing parses until iterated", () => {
    const generator = chunkDelimited(csv, "csv", { chunkSize: 2 });
    expect(typeof generator.next).toBe("function");
    expect(generator.next().done).toBe(false);
  });
});

describe("reduceChunks", () => {
  const csv = ["id,amount", "1,10", "2,20", "3,30", "4,40", "5,50"].join("\n");

  it("folds chunks into a running total", () => {
    const total = reduceChunks(
      csv,
      "csv",
      (sum, chunk) => sum + chunk.data.reduce((inner, row) => inner + Number(row.amount), 0),
      0,
      { chunkSize: 2 },
    );
    expect(total).toBe(150);
  });

  it("reports increasing progress", () => {
    const seen: number[] = [];
    reduceChunks(
      csv,
      "csv",
      (_count, chunk, progress) => {
        seen.push(progress.delivered);
        return progress.delivered;
      },
      0,
      { chunkSize: 2 },
    );
    expect(seen).toEqual([2, 4, 5]);
  });
});

describe("collectChunks", () => {
  it("concatenates chunks into one dataset", () => {
    const csv = ["id,name", "1,Ada", "2,Grace", "3,Alan"].join("\n");
    const collected = collectChunks(csv, "csv", { chunkSize: 2 });
    expect(collected.rowCount).toBe(3);
    expect(collected.columns).toEqual(["id", "name"]);
  });

  it("returns an empty dataset for an empty source", () => {
    expect(collectChunks("a,b", "csv").rowCount).toBe(0);
  });

  it("matches a whole-file parse", () => {
    const csv = ["id,v", "1,1.5", "2,2.5", "3,3.5", "4,4.5"].join("\n");
    const collected = collectChunks(csv, "csv", { chunkSize: 2 });
    expect(collected.data).toEqual([
      { id: 1, v: 1.5 },
      { id: 2, v: 2.5 },
      { id: 3, v: 3.5 },
      { id: 4, v: 4.5 },
    ]);
  });

  it("re-infers column types instead of trusting the payload", () => {
    const payload = JSON.parse(JSON.stringify(toInterchange(createDataset([{ n: 1, s: "a" }]))));
    payload.columns[0].type = "string";
    payload.columns[1].type = "number";
    const rebuilt = fromInterchange(payload);
    expect(rebuilt.dtypes.n).toBe("integer");
    expect(rebuilt.dtypes.s).toBe("string");
  });
});
