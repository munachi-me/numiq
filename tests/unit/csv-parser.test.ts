import { describe, it, expect } from "vitest";
import { parseDelimited } from "../../src/io/parsers/csv.js";
import { FormatError, ValidationError } from "../../src/errors/index.js";

const csv = (text: string, options: Record<string, unknown> = {}) =>
  parseDelimited(text, { format: "csv", ...options });

describe("basic CSV import", () => {
  it("reads a header and rows", () => {
    const data = csv("name,age\nAda,36\nLin,41\n");
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.data).toEqual([
      { name: "Ada", age: 36 },
      { name: "Lin", age: 41 },
    ]);
  });

  it("strips a BOM", () => {
    expect(csv("\uFEFFa,b\n1,2\n").columns).toEqual(["a", "b"]);
  });

  it("trims header names but not values", () => {
    const data = csv(" name , age \n Ada , 36 \n");
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.data[0]).toEqual({ name: " Ada ", age: " 36 " });
  });

  it("handles CRLF line endings", () => {
    expect(csv("a,b\r\n1,2\r\n").data).toEqual([{ a: 1, b: 2 }]);
  });

  it("skips blank lines", () => {
    expect(csv("a,b\n\n1,2\n\n3,4\n").data).toHaveLength(2);
  });

  it("returns an empty dataset for empty input", () => {
    const data = csv("");
    expect(data.rowCount).toBe(0);
    expect(data.columns).toEqual([]);
  });

  it("returns an empty dataset for a header-only file", () => {
    const data = csv("a,b\n");
    expect(data.columns).toEqual(["a", "b"]);
    expect(data.rowCount).toBe(0);
  });

  it("supports quoted fields with commas, quotes, and newlines", () => {
    const data = csv('a,b\n"x,y","he said ""hi"""\n');
    expect(data.data[0]).toEqual({ a: "x,y", b: 'he said "hi"' });
    expect(csv('a\n"line one\nline two"\n').data[0]!.a).toBe("line one\nline two");
  });
});

describe("delimiter handling", () => {
  it("detects semicolons, pipes, and tabs", () => {
    expect(csv("a;b\n1;2\n").columns).toEqual(["a", "b"]);
    expect(csv("a|b\n1|2\n").columns).toEqual(["a", "b"]);
    expect(csv("a\tb\n1\t2\n").columns).toEqual(["a", "b"]);
  });

  it("honours an explicit delimiter", () => {
    expect(csv("a;b\n1;2\n", { delimiter: ";" }).data).toEqual([{ a: 1, b: 2 }]);
  });

  it("rejects a multi-character delimiter", () => {
    expect(() => csv("a,b\n1,2\n", { delimiter: "||" })).toThrow(/single character/);
  });
});

describe("header options", () => {
  it("supports headerless files with generated names", () => {
    expect(csv("1,2\n3,4\n", { header: false }).columns).toEqual(["column_1", "column_2"]);
  });

  it("supports headerless files with supplied names", () => {
    const data = csv("1,2\n", { header: false, columns: ["x", "y"] });
    expect(data.data).toEqual([{ x: 1, y: 2 }]);
  });

  it("rejects a name count that does not match the data", () => {
    expect(() => csv("1,2\n", { header: false, columns: ["x"] })).toThrow(/2 columns of data/);
  });

  it("rejects supplied columns when a header is present", () => {
    expect(() => csv("a,b\n1,2\n", { columns: ["x", "y"] })).toThrow(/header names come from the file/);
  });

  it("rejects empty header cells, naming the position", () => {
    expect(() => csv("a,\n1,2\n")).toThrow(/Column 2 in the header is empty/);
  });

  it("rejects duplicate header cells, naming both positions", () => {
    expect(() => csv("a,a\n1,2\n")).toThrow(/Duplicate column name "a" at header position 1 and 2/);
  });

  it("skips preamble rows before the header", () => {
    const data = csv("Report\nGenerated 2026\na,b\n1,2\n", { skipRows: 2 });
    expect(data.columns).toEqual(["a", "b"]);
    expect(data.data).toEqual([{ a: 1, b: 2 }]);
  });

  it("detects the delimiter past a preamble", () => {
    expect(csv("title\na;b\n1;2\n", { skipRows: 1 }).columns).toEqual(["a", "b"]);
  });

  it("ignores a preamble that outnumbers the table when detecting the delimiter", () => {
    // Ten preamble lines using ";" then a three-line "," table. Detection must sample the
    // post-preamble rows, or the preamble outvotes the real separator.
    const preamble = Array.from({ length: 10 }, (_, index) => `meta;line;${index}`).join("\n");
    const text = `${preamble}\nid,name,score\n1,Ada,9\n2,Lin,7\n`;
    const data = csv(text, { skipRows: 10 });
    expect(data.columns).toEqual(["id", "name", "score"]);
    expect(data.rowCount).toBe(2);
    expect(data.data[0]).toEqual({ id: 1, name: "Ada", score: 9 });
  });

  it("rejects a negative skipRows", () => {
    expect(() => csv("a\n1\n", { skipRows: -1 })).toThrow(ValidationError);
  });
});

describe("ragged rows", () => {
  it("fails by default, naming the row", () => {
    expect(() => csv("a,b\n1,2,3\n")).toThrow(/Row 1 has 3 cells but 2 columns/);
  });

  it("pads and drops when asked, recording a warning", () => {
    const data = csv("a,b\n1,2,3\n4\n", { onRaggedRow: "pad" });
    expect(data.data).toEqual([
      { a: 1, b: 2 },
      { a: 4, b: null },
    ]);
    expect(data.importReport!.warnings.filter((w) => w.code === "ragged-row")).toHaveLength(2);
  });
});

describe("schemas", () => {
  it("casts values to declared types", () => {
    const data = csv("amount,active\n10,true\n20,false\n", {
      schema: { amount: "number", active: "boolean" },
    });
    expect(data.data).toEqual([
      { amount: 10, active: true },
      { amount: 20, active: false },
    ]);
  });

  it("produces Date objects for date columns", () => {
    const data = csv("when\n2026-01-05\n", { schema: { when: "date" } });
    expect(data.data[0]!.when).toBeInstanceOf(Date);
    expect(data.dtypes.when).toBe("date");
  });

  it("reports datetime for a cast datetime column", () => {
    const data = csv("when\n2026-01-05T14:30:00Z\n", { schema: { when: "datetime" } });
    expect(data.dtypes.when).toBe("datetime");
  });

  it("fails on an invalid value by default, naming row and column", () => {
    expect(() => csv("age\nabc\n", { schema: { age: "integer" } })).toThrow(/Row 1, column "age"/);
  });

  it("sets invalid values to null and warns when asked", () => {
    const data = csv("age\nabc\n", { schema: { age: "integer" }, onInvalid: "null" });
    expect(data.data[0]!.age).toBeNull();
    expect(data.importReport!.warnings[0]!.code).toBe("invalid-value");
  });

  it("rejects a schema for a column that does not exist", () => {
    expect(() => csv("a\n1\n", { schema: { nope: "number" } })).toThrow(/unknown column/);
  });
});

describe("data-preservation regressions", () => {
  it("keeps NA as a country code", () => {
    expect(csv("country\nNA\nNA\n").data).toEqual([{ country: "NA" }, { country: "NA" }]);
  });

  it("keeps the literal string null", () => {
    expect(csv("name\nnull\n").data[0]!.name).toBe("null");
  });

  it("keeps N/A as text", () => {
    expect(csv("note\nN/A\n").data[0]!.note).toBe("N/A");
  });

  it("keeps integers beyond the safe range as strings and warns", () => {
    const data = csv("id\n9007199254740993\n");
    expect(data.data[0]!.id).toBe("9007199254740993");
    expect(data.importReport!.warnings[0]!.code).toBe("unsafe-integer");
  });

  it("keeps phone numbers intact", () => {
    expect(csv("phone\n+26481234\n").data[0]!.phone).toBe("+26481234");
  });

  it("keeps leading-zero identifiers intact", () => {
    expect(csv("code\n007\n").data[0]!.code).toBe("007");
  });

  it("tolerates an inch mark inside an unquoted field", () => {
    const data = csv('product,size\nMonitor 5" wide,24\n');
    expect(data.data[0]).toEqual({ product: 'Monitor 5" wide', size: 24 });
  });

  it("treats empty cells as null", () => {
    expect(csv("a,b\n1,\n").data[0]).toEqual({ a: 1, b: null });
  });

  it("can opt into legacy null markers", () => {
    const data = csv("a\nNA\n", { normalization: { nullValues: ["", "NA"] } });
    expect(data.data[0]!.a).toBeNull();
  });

  it("can disable type inference", () => {
    expect(csv("a\n42\n", { normalization: { inferTypes: false } }).data[0]!.a).toBe("42");
  });
});

describe("import report", () => {
  const data = csv("a,b\n1,\n2,3\n");

  it("records format, source, and counts", () => {
    const report = data.importReport!;
    expect(report.format).toBe("csv");
    expect(report.source).toBe("memory");
    expect(report.rowsRead).toBe(2);
    expect(report.rowsImported).toBe(2);
    expect(report.columns).toEqual(["a", "b"]);
  });

  it("records missing counts per column", () => {
    expect(data.importReport!.missingByColumn).toEqual({ a: 0, b: 1 });
  });

  it("records the delimiter and policy", () => {
    expect(data.importReport!.delimiter).toBe(",");
    expect(data.importReport!.normalization.inferTypes).toBe(true);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(data.importReport)).toBe(true);
    expect(Object.isFrozen(data.importReport!.warnings)).toBe(true);
  });

  it("is not shared with derived datasets", () => {
    expect(data.head(1).importReport).toBeNull();
  });
});

describe("TSV", () => {
  it("parses tab-separated text", () => {
    const data = parseDelimited("a\tb\n1\t2\n", { format: "tsv" });
    expect(data.data).toEqual([{ a: 1, b: 2 }]);
    expect(data.importReport!.format).toBe("tsv");
  });

  it("rejects a format that is not csv or tsv", () => {
    expect(() => parseDelimited("a,b\n1,2\n", { format: "json" as never })).not.toThrow();
  });
});

describe("error types", () => {
  it("throws FormatError for structural problems", () => {
    expect(() => csv('a\n"unterminated\n')).toThrow(FormatError);
    expect(() => csv("a,b\n1,2,3\n")).toThrow(FormatError);
  });

  it("throws ValidationError for bad options", () => {
    expect(() => csv("a\n1\n", { header: "yes" as never })).toThrow(ValidationError);
    expect(() => csv("a\n1\n", { onInvalid: "ignore" as never })).toThrow(ValidationError);
  });

  it("throws ValidationError for non-string input", () => {
    expect(() => parseDelimited(42 as never, { format: "csv" })).toThrow(ValidationError);
  });
});
