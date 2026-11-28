import { describe, expect, it } from "vitest";
import {
  chunkDelimited,
  collectChunks,
  createDataset,
  fromInterchange,
  fromTableData,
  isInterchangePayload,
  parseDelimited,
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
      /format must be "numiq\.table", received "nope"/,
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

  it("reports the source row number, not the position within the chunk", () => {
    // Each chunk is re-parsed on its own, so without an offset the third chunk would report
    // "Row 1" for a row that is the fifth data record of the file.
    const ragged = ["a,b", "1,2", "3,4", "5,6", "7,8,9"].join("\n");
    expect(() => {
      for (const chunk of chunkDelimited(ragged, "csv", { chunkSize: 2 })) void chunk;
    }).toThrow("Row 4 has 3 cells but 2 columns are expected.");
  });

  it("reports the source row number for a bad cast in a later chunk", () => {
    const csv = ["a,b", "1,2", "3,4", "5,6", "x,8"].join("\n");
    expect(() => {
      for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 2, schema: { a: { type: "integer" } } })) {
        void chunk;
      }
    }).toThrow('Row 4, column "a": "x" is not a valid integer.');
  });

  it("numbers rows identically to a whole-file parse", () => {
    const csv = ["a,b", "1,2", "3,4", "5,6", "7,8,9"].join("\n");
    const messageOf = (run: () => unknown): string => {
      try {
        run();
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const whole = messageOf(() => parseDelimited(csv, { format: "csv" }));
    const chunked = messageOf(() => {
      for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 2 })) void chunk;
    });
    expect(chunked).toBe(whole);
  });

  it("numbers rows past a skipped preamble the same way as a whole-file parse", () => {
    const csv = ["# note", "a,b", "1,2", "3,4", "5,6", "7,8,9"].join("\n");
    const collect = (run: () => unknown): string => {
      try {
        run();
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const whole = collect(() => parseDelimited(csv, { format: "csv", skipRows: 1 }));
    const chunked = collect(() => {
      for (const chunk of chunkDelimited(csv, "csv", { chunkSize: 2, skipRows: 1 })) void chunk;
    });
    expect(chunked).toBe(whole);
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

  describe("agrees with a whole-file parse", () => {
    const cases = [
      { name: "a leading blank line", csv: "\nname,age\nAda,36\nLin,41\n", options: {} },
      {
        name: "a blank line inside a skipped preamble",
        csv: "Report: sales\n\nregion,revenue\nnorth,100\nsouth,200\n",
        options: { skipRows: 2 },
      },
      { name: "blank lines between records", csv: "name,age\nAda,36\n\n\nLin,41\n", options: {} },
    ];

    for (const { name, csv, options } of cases) {
      it(`matches parseDelimited with ${name}`, () => {
        const whole = parseDelimited(csv, { format: "csv", ...options });
        const chunks = [...chunkDelimited(csv, "csv", { ...options, chunkSize: 1 })];
        expect(chunks[0]?.columns).toEqual(whole.columns);
        expect(chunks.reduce((total, chunk) => total + chunk.rowCount, 0)).toBe(whole.rowCount);
        expect(chunks.flatMap((chunk) => chunk.data)).toEqual(whole.data);
      });
    }
  });

  it("reports lastRecord as a zero-based index and reduceChunks agrees", () => {
    const csv = "a,b\n1,2\n\n3,4\n5,6\n";
    const seen: unknown[] = [];
    const iterator = chunkDelimited(csv, "csv", { chunkSize: 1, onProgress: (p) => void seen.push({ ...p }) });
    while (iterator.next().done !== true) {
      // drain
    }
    const reduced: unknown[] = [];
    reduceChunks(
      csv,
      "csv",
      (total, chunk, progress) => {
        reduced.push({ ...progress });
        return total + chunk.rowCount;
      },
      0,
      { chunkSize: 1 },
    );
    expect(seen).toEqual([
      { chunk: 0, rows: 1, delivered: 1, lastRecord: 0 },
      { chunk: 1, rows: 1, delivered: 2, lastRecord: 1 },
      { chunk: 2, rows: 1, delivered: 3, lastRecord: 2 },
    ]);
    expect(reduced).toEqual(seen);
  });

  describe("headerless chunking", () => {
    const csv = "1,2\n3,4\n5,6\n";

    it("keeps the first record as data and names columns the same way", () => {
      const whole = parseDelimited(csv, { format: "csv", header: false });
      const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2, header: false })];
      expect(chunks[0]?.columns).toEqual(whole.columns);
      expect(chunks.flatMap((chunk) => chunk.data)).toEqual(whole.data);
      expect(chunks[0]?.rowCount).toBe(2);
    });

    it("accepts explicit columns instead of throwing", () => {
      const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2, header: false, columns: ["x", "y"] })];
      expect(chunks[0]?.columns).toEqual(["x", "y"]);
      expect(chunks.flatMap((chunk) => chunk.data)[0]).toEqual({ x: 1, y: 2 });
    });

    it("rejects a column count that does not match the data", () => {
      expect(() => [...chunkDelimited(csv, "csv", { header: false, columns: ["x"] })]).toThrow(
        /2 columns of data were found, but 1 column names/,
      );
    });

    it("still rejects columns when a header is present", () => {
      expect(() => [...chunkDelimited("a,b\n1,2\n", "csv", { columns: ["x", "y"] })]).toThrow(/header is true/);
    });
  });

  it("keeps the header when a file has no data records", () => {
    // The generator yields no chunk when there is nothing to chunk, so collectChunks() has
    // to fall back to a whole-file parse rather than return a columnless dataset.
    for (const text of ["a,b\n", "a,b\n\n\n,\n"]) {
      const whole = parseDelimited(text, { format: "csv" });
      const collected = collectChunks(text, "csv", { chunkSize: 2 });
      expect(collected.columns).toEqual(["a", "b"]);
      expect(collected.columns).toEqual(whole.columns);
      expect(collected.rowCount).toBe(0);
      expect(collected.data).toEqual(whole.data);
    }
  });
});

describe("chunkDelimited is genuinely incremental", () => {
  // The old implementation tokenized the whole file before yielding, so a malformed record
  // at the end threw before the first chunk arrived. These tests pin that down: the first
  // chunk must be available without having read the rest of the input.
  const tailBroken = 'a,b\n1,2\n3,4\n5,6\n7,"unterminated\n';

  it("delivers the first chunk before a later malformed record is reached", () => {
    const iterator = chunkDelimited(tailBroken, "csv", { chunkSize: 2 });
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.rowCount).toBe(2);
    // Draining still surfaces the error, so the malformed tail is not silently ignored.
    expect(() => {
      while (iterator.next().done !== true) {
        // drain
      }
    }).toThrow(/unterminated/);
  });

  it("does not tokenize past the first chunk when the caller stops early", () => {
    const iterator = chunkDelimited(tailBroken, "csv", { chunkSize: 2 });
    iterator.next();
    // Abandoning the iterator must not read the malformed tail. If chunking were eager this
    // line would already have thrown from inside `chunkDelimited`.
    expect(() => iterator.return?.(undefined)).not.toThrow();
  });

  it("respects chunk sizes and delivers every record exactly once in order", () => {
    const csv = ["id,name", ...Array.from({ length: 25 }, (_, i) => `${i},n${i}`)].join("\n");
    const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 10 })];
    expect(chunks.map((chunk) => chunk.rowCount)).toEqual([10, 10, 5]);
    const ids = chunks.flatMap((chunk) => chunk.data.map((row) => row.id));
    expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(new Set(ids).size).toBe(25);
  });

  it("handles quoted delimiters, escaped quotes, and multiline fields", () => {
    const csv = ["id,note", '1,"a, b"', '2,"say ""hi"""', '3,"line one\nline two"', "4,plain"].join("\n");
    const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2 })];
    const notes = chunks.flatMap((chunk) => chunk.data.map((row) => row.note));
    expect(notes).toEqual(["a, b", 'say "hi"', "line one\nline two", "plain"]);
    expect(chunks.map((chunk) => chunk.rowCount)).toEqual([2, 2]);
  });

  it("treats CRLF and LF sources identically", () => {
    const lf = 'id,note\n1,"a\nb"\n2,plain\n';
    const crlf = 'id,note\r\n1,"a\r\nb"\r\n2,plain\r\n';
    const shape = (text: string) =>
      [...chunkDelimited(text, "csv", { chunkSize: 1 })].map((chunk) => ({ columns: chunk.columns, rows: chunk.data }));
    expect(shape(crlf)).toEqual(shape(lf));
    expect(shape(crlf).flatMap((chunk) => chunk.rows)).toEqual([
      { id: 1, note: "a\nb" },
      { id: 2, note: "plain" },
    ]);
  });

  it("handles an empty body and a final partial chunk", () => {
    expect([...chunkDelimited("a,b", "csv")]).toEqual([]);
    expect([...chunkDelimited("", "csv")]).toEqual([]);
    const chunks = [...chunkDelimited("a,b\n1,2\n3,4\n5,6", "csv", { chunkSize: 2 })];
    expect(chunks.map((chunk) => chunk.rowCount)).toEqual([2, 1]);
  });

  it("reports the same progress as before, including lastRecord", () => {
    const seen: unknown[] = [];
    const iterator = chunkDelimited("a,b\n1,2\n\n3,4\n5,6\n", "csv", {
      chunkSize: 1,
      onProgress: (progress) => void seen.push({ ...progress }),
    });
    while (iterator.next().done !== true) {
      // drain
    }
    expect(seen).toEqual([
      { chunk: 0, rows: 1, delivered: 1, lastRecord: 0 },
      { chunk: 1, rows: 1, delivered: 2, lastRecord: 1 },
      { chunk: 2, rows: 1, delivered: 3, lastRecord: 2 },
    ]);
  });

  it("stops on an aborted signal and on onProgress returning false", () => {
    const controller = new AbortController();
    const delivered: number[] = [];
    for (const chunk of chunkDelimited("a,b\n1,2\n3,4\n5,6\n", "csv", { chunkSize: 1, signal: controller.signal })) {
      delivered.push(chunk.rowCount);
      controller.abort();
    }
    expect(delivered).toEqual([1]);
    expect([...chunkDelimited("a,b\n1,2\n3,4\n", "csv", { chunkSize: 1, onProgress: () => false })]).toHaveLength(1);
  });

  it("agrees with a whole-file parse across quoting edge cases", () => {
    const csv = ["id,note", '1,"a, b"', '2,"multi\nline"', '3,"q ""x"""', "4,"].join("\n");
    const whole = parseDelimited(csv, { format: "csv" });
    const chunks = [...chunkDelimited(csv, "csv", { chunkSize: 2 })];
    expect(chunks.flatMap((chunk) => chunk.data)).toEqual(whole.data);
    expect(chunks[0]?.columns).toEqual(whole.columns);
  });

  it("keeps reduceChunks and collectChunks correct", () => {
    const csv = ["id,amount", ...Array.from({ length: 12 }, (_, i) => `${i},${i}`)].join("\n");
    expect(
      reduceChunks(csv, "csv", (sum, chunk) => sum + chunk.data.reduce((s, row) => s + Number(row.amount), 0), 0, {
        chunkSize: 5,
      }),
    ).toBe(66);
    const collected = collectChunks(csv, "csv", { chunkSize: 5 });
    expect(collected.rowCount).toBe(12);
    expect(collected.data).toEqual(parseDelimited(csv, { format: "csv" }).data);
  });

  it("retains only a chunk, not the whole tokenized file", () => {
    // A structural check rather than a timing threshold: with a small chunk the generator
    // must be able to deliver many chunks while a malformed tail stays unread. A large file
    // makes the difference observable without measuring bytes.
    const lines = ["id,v", ...Array.from({ length: 5000 }, (_, i) => `${i},${i * 2}`)];
    const text = `${lines.join("\n")}\n99999,"broken\n`;
    const iterator = chunkDelimited(text, "csv", { chunkSize: 100 });
    let chunks = 0;
    let rows = 0;
    for (const chunk of iterator) {
      chunks += 1;
      rows += chunk.rowCount;
      if (chunks === 10) break;
    }
    expect(chunks).toBe(10);
    expect(rows).toBe(1000);
  });
});

describe("interchange payload validation is strict", () => {
  const valid = () => JSON.parse(JSON.stringify(toInterchange(dataset())));

  const cases: { name: string; mutate: (payload: Record<string, unknown>) => void }[] = [
    { name: "a missing format", mutate: (p) => delete p.format },
    { name: "an incorrect format", mutate: (p) => (p.format = "numiq.other") },
    { name: "an unsupported version", mutate: (p) => (p.version = 2) },
    { name: "a non-string name", mutate: (p) => (p.name = 7) },
    { name: "a missing name", mutate: (p) => delete p.name },
    { name: "columns that are not an array", mutate: (p) => (p.columns = {}) },
    { name: "rows that are not an array", mutate: (p) => (p.rows = "nope") },
    { name: "a negative rowCount", mutate: (p) => (p.rowCount = -1) },
    { name: "a fractional rowCount", mutate: (p) => (p.rowCount = 1.5) },
    { name: "a rowCount that disagrees with rows", mutate: (p) => (p.rowCount = 99) },
    { name: "a columnCount that disagrees with columns", mutate: (p) => (p.columnCount = 9) },
    { name: "a non-null missingValue", mutate: (p) => (p.missingValue = "NA") },
    { name: "missing metadata", mutate: (p) => delete p.metadata },
    { name: "metadata that is not an object", mutate: (p) => (p.metadata = []) },
    { name: "an empty column name", mutate: (p) => ((p.columns as { name: string }[])[0]!.name = "") },
    {
      name: "a column with an unsupported dtype",
      mutate: (p) => ((p.columns as { type: string }[])[0]!.type = "money"),
    },
    { name: "a non-boolean nullable", mutate: (p) => ((p.columns as { nullable: unknown }[])[0]!.nullable = "yes") },
    { name: "an invalid role", mutate: (p) => ((p.columns as { role: string }[])[0]!.role = "metric") },
    { name: "a column that is not an object", mutate: (p) => ((p.columns as unknown[])[0] = "region") },
    { name: "a ragged row", mutate: (p) => ((p.rows as unknown[][])[0] = ["north"]) },
    { name: "a row that is not an array", mutate: (p) => ((p.rows as unknown[])[0] = "north") },
  ];

  for (const { name, mutate } of cases) {
    it(`rejects ${name}`, () => {
      const payload = valid();
      mutate(payload);
      expect(isInterchangePayload(payload)).toBe(false);
      expect(() => fromInterchange(payload)).toThrow(ValidationError);
    });
  }

  it("accepts a valid payload and round-trips it", () => {
    const payload = valid();
    expect(isInterchangePayload(payload)).toBe(true);
    const rebuilt = fromInterchange(payload);
    expect(rebuilt.columns).toEqual(dataset().columns);
    expect(rebuilt.data).toEqual(dataset().data);
    expect(rebuilt.name).toBe("sales");
  });

  it("accepts an empty dataset that still has columns", () => {
    const payload = toInterchange(createDataset([], { columns: ["a", "b"], name: "empty" }));
    expect(isInterchangePayload(payload)).toBe(true);
    const rebuilt = fromInterchange(payload);
    expect(rebuilt.rowCount).toBe(0);
    expect(rebuilt.columns).toEqual(["a", "b"]);
  });

  it("names the offending field in the error", () => {
    const payload = valid();
    payload.rowCount = 99;
    expect(() => fromInterchange(payload)).toThrow(/rowCount is 99 but 3 rows were supplied/);
  });

  it("does not truncate or pad a ragged row", () => {
    const payload = valid();
    (payload.rows as unknown[][])[0] = ["north"];
    payload.rowCount = 3;
    expect(() => fromInterchange(payload)).toThrow(/row 0 has 1 cells but there are 3 columns/);
  });
});

describe("interchange metadata is JSON-safe", () => {
  const withMetadata = (metadata: unknown) =>
    createDataset([{ a: 1 }], { metadata: metadata as Record<string, unknown> });

  it("accepts plain, nested, array, and null metadata", () => {
    const metadata = { source: "test", nested: { deep: { n: 1 } }, list: [1, "two", null, { x: true }], nothing: null };
    const payload = toInterchange(withMetadata(metadata));
    expect(payload.metadata).toEqual(metadata);
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(fromInterchange(payload).metadata).toEqual(metadata);
  });

  it("preserves valid metadata through a JSON round trip", () => {
    const metadata = { a: 1, b: [true, null, "x"], c: { d: -0.5 } };
    const restored = fromInterchange(JSON.parse(JSON.stringify(toInterchange(withMetadata(metadata)))));
    expect(restored.metadata).toEqual(metadata);
  });

  const rejected: { name: string; metadata: () => unknown; match: RegExp }[] = [
    { name: "a BigInt", metadata: () => ({ big: 1n }), match: /BigInt/ },
    { name: "a function", metadata: () => ({ fn: () => 1 }), match: /function/ },
    { name: "a symbol", metadata: () => ({ sym: Symbol("s") }), match: /symbol/ },
    { name: "an undefined value", metadata: () => ({ missing: undefined }), match: /undefined/ },
    { name: "NaN", metadata: () => ({ n: Number.NaN }), match: /NaN/ },
    { name: "Infinity", metadata: () => ({ n: Number.POSITIVE_INFINITY }), match: /Infinity/ },
    { name: "an invalid Date", metadata: () => ({ when: new Date(Number.NaN) }), match: /invalid Date/ },
  ];

  for (const { name, metadata, match } of rejected) {
    it(`rejects ${name} with a ValidationError`, () => {
      expect(() => toInterchange(withMetadata(metadata()))).toThrow(ValidationError);
      expect(() => toInterchange(withMetadata(metadata()))).toThrow(match);
    });
  }

  it("detects a circular reference in a hand-built payload", () => {
    // `createDataset()` clones metadata, so a cycle never reaches a real dataset (it overflows
    // in the clone). A payload arriving from outside has not been through that clone, so the
    // guard is exercised where it is actually reachable.
    const payload = JSON.parse(JSON.stringify(toInterchange(dataset())));
    payload.metadata = { name: "loop" };
    payload.metadata.self = payload.metadata;
    expect(isInterchangePayload(payload)).toBe(false);
    expect(() => fromInterchange(payload)).toThrow(/circular reference/);
  });

  it("cannot store a circular reference in a dataset at all", () => {
    const metadata: Record<string, unknown> = { name: "loop" };
    metadata.self = metadata;
    // Documents the existing boundary: cloning rejects the cycle before interchange runs.
    expect(() => withMetadata(metadata)).toThrow(RangeError);
  });

  it("normalises a Map or class instance to a plain object before interchange", () => {
    // `createDataset()` deep-clones metadata, which flattens anything that is not a plain
    // object. The result is JSON-safe, so interchange accepts it.
    const source = createDataset([{ a: 1 }], {
      metadata: {
        map: new Map([["k", "v"]]),
        instance: new (class Custom {
          x = 1;
        })(),
      } as never,
    });
    const payload = toInterchange(source);
    expect(payload.metadata).toEqual({ map: {}, instance: { x: 1 } });
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it("accepts a Date because it serialises to an ISO string", () => {
    const when = new Date("2026-01-02T03:04:05.000Z");
    const payload = toInterchange(withMetadata({ when }));
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.parse(JSON.stringify(payload)).metadata.when).toBe("2026-01-02T03:04:05.000Z");
  });

  it("does not mutate the dataset's metadata when validating", () => {
    const metadata = { keep: "me", nested: { n: 1 } };
    const source = withMetadata(metadata);
    const before = JSON.parse(JSON.stringify(source.metadata));
    toInterchange(source);
    expect(source.metadata).toEqual(before);
  });

  it("enforces the same contract when reading a payload", () => {
    const payload = JSON.parse(JSON.stringify(toInterchange(dataset())));
    payload.metadata = { bad: 1n };
    expect(isInterchangePayload(payload)).toBe(false);
    expect(() => fromInterchange(payload)).toThrow(/BigInt/);
  });
});
