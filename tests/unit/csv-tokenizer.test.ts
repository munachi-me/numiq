import { describe, it, expect } from "vitest";
import { tokenize, detectDelimiter } from "../../src/io/parsers/csv-tokenizer.js";
import { FormatError } from "../../src/errors/index.js";

describe("tokenize", () => {
  it("splits plain rows on the delimiter", () => {
    expect(tokenize("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps delimiters inside quoted fields", () => {
    expect(tokenize('a,b\n"x,y",2\n', ",")).toEqual([
      ["a", "b"],
      ["x,y", "2"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(tokenize('a\n"She said ""hi"""\n', ",")).toEqual([["a"], ['She said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(tokenize('a\n"one\ntwo"\n', ",")).toEqual([["a"], ["one\ntwo"]]);
  });

  it("normalizes CRLF inside quotes so CRLF and LF sources agree", () => {
    const crlf = tokenize('a\r\n"one\r\ntwo"\r\n', ",");
    const lf = tokenize('a\n"one\ntwo"\n', ",");
    expect(crlf).toEqual(lf);
    expect(crlf[1]![0]).toBe("one\ntwo");
  });

  it("treats a stray quote inside an unquoted field as literal text", () => {
    expect(tokenize('product,size\nMonitor 5" wide,24\n', ",")).toEqual([
      ["product", "size"],
      ['Monitor 5" wide', "24"],
    ]);
  });

  it("handles lone CR record separators", () => {
    expect(tokenize("a,b\r1,2\r", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not emit a trailing blank record for a final newline", () => {
    expect(tokenize("a\n1\n", ",")).toEqual([["a"], ["1"]]);
  });

  it("preserves empty trailing cells", () => {
    expect(tokenize("a,b\n1,\n", ",")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => tokenize('a\n"open\n', ",")).toThrow(FormatError);
  });

  it("returns no records for empty input", () => {
    expect(tokenize("", ",")).toEqual([]);
  });
});

describe("detectDelimiter", () => {
  it("detects commas, tabs, semicolons, and pipes", () => {
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a;b\n1;2")).toBe(";");
    expect(detectDelimiter("a|b\n1|2")).toBe("|");
  });

  it("is not fooled by a preamble line without the delimiter", () => {
    expect(detectDelimiter("report title\na;b\n1;2\n")).toBe(";");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('a,b\n"x;y;z",2\n')).toBe(",");
  });

  it("falls back to a comma when nothing is detected", () => {
    expect(detectDelimiter("single")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});
