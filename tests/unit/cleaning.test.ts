import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { normalizeText } from "../../src/core/prepare.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const rows = [
  { name: "  Ada  ", city: "New   York", score: 1 },
  { name: "bob", city: " new york ", score: 2 },
  { name: "CARA", city: "Boston", score: 3 },
];

describe("normalizeText: whitespace", () => {
  it("trims leading and trailing whitespace by default", () => {
    const { dataset } = createDataset(rows).normalizeText();
    expect(dataset.data.map((row) => row.name)).toEqual(["Ada", "bob", "CARA"]);
  });

  it("collapses inner runs when asked", () => {
    const { dataset } = createDataset(rows).normalizeText({ whitespace: "collapse" });
    expect(dataset.data[0]?.city).toBe("New York");
  });

  it("leaves whitespace alone with mode none", () => {
    const { dataset } = createDataset(rows).normalizeText({ whitespace: "none" });
    expect(dataset.data[0]?.name).toBe("  Ada  ");
  });

  it("replaces extra whitespace characters before trimming", () => {
    const data = createDataset([{ a: "\u00a0x\u00a0" }]);
    const { dataset } = data.normalizeText({ extraWhitespace: ["\u00a0"] });
    expect(dataset.data[0]?.a).toBe("x");
  });

  it("rejects an unknown whitespace mode", () => {
    expect(() => createDataset(rows).normalizeText({ whitespace: "nope" as "trim" })).toThrow(ValidationError);
  });
});

describe("normalizeText: case", () => {
  it("lowercases", () => {
    const { dataset } = createDataset(rows).normalizeText({ case: "lower" });
    expect(dataset.data.map((row) => row.name)).toEqual(["ada", "bob", "cara"]);
  });

  it("uppercases", () => {
    const { dataset } = createDataset(rows).normalizeText({ case: "upper" });
    expect(dataset.data[0]?.name).toBe("ADA");
  });

  it("title-cases each word", () => {
    const { dataset } = createDataset([{ a: "new york city" }]).normalizeText({ case: "title" });
    expect(dataset.data[0]?.a).toBe("New York City");
  });

  it("applies case after trimming", () => {
    const { dataset } = createDataset([{ a: "  MiXeD  " }]).normalizeText({ case: "lower" });
    expect(dataset.data[0]?.a).toBe("mixed");
  });

  it("rejects an unknown case mode", () => {
    expect(() => createDataset(rows).normalizeText({ case: "nope" as "lower" })).toThrow(ValidationError);
  });
});

describe("normalizeText: safety", () => {
  it("leaves non-string cells untouched", () => {
    const { dataset } = createDataset(rows).normalizeText({ case: "lower" });
    expect(dataset.data.map((row) => row.score)).toEqual([1, 2, 3]);
  });

  it("keeps null values null", () => {
    const { dataset } = createDataset([{ a: null }]).normalizeText({ case: "upper" });
    expect(dataset.data[0]?.a).toBeNull();
  });

  it("does not modify the source dataset", () => {
    const data = createDataset(rows);
    const before = JSON.stringify(data.data);
    data.normalizeText({ case: "lower" });
    expect(JSON.stringify(data.data)).toBe(before);
  });

  it("reports rows changed per column", () => {
    const { changes } = createDataset(rows).normalizeText({ case: "lower" });
    expect(changes.find((change) => change.column === "name")?.changed).toBe(2);
    expect(changes.find((change) => change.column === "score")?.changed).toBe(0);
  });

  it("reports total changed rows", () => {
    const { changedRows } = createDataset(rows).normalizeText();
    expect(changedRows).toBe(2);
  });

  it("caps examples per column", () => {
    const many = createDataset(Array.from({ length: 20 }, () => ({ a: " x " })));
    const change = many.normalizeText().changes.find((item) => item.column === "a");
    expect(change?.changed).toBe(20);
    expect(change?.examples.length).toBeLessThanOrEqual(5);
    expect(change?.examples[0]).toEqual({ row: 0, before: " x ", after: "x" });
  });

  it("reports the examined row count", () => {
    const change = createDataset(rows).normalizeText().changes[0];
    expect(change?.examined).toBe(3);
  });

  it("rejects a dataset with no columns, like the other prepare helpers", () => {
    expect(() => createDataset([]).normalizeText({ case: "upper" })).toThrow(ValidationError);
  });

  it("preserves column order and count", () => {
    const data = createDataset(rows);
    const { dataset } = data.normalizeText({ case: "upper" });
    expect(dataset.columns).toEqual(data.columns);
  });
});

describe("normalizeText: free function", () => {
  it("works on raw rows and targets chosen columns", () => {
    const raw = rows.map((row) => ({ ...row }));
    const result = normalizeText(raw, ["name", "city", "score"], ["city"], { case: "lower" });
    expect(result.rows[1]?.city).toBe("new york");
    expect(result.rows[0]?.name).toBe("  Ada  ");
  });

  it("rejects an unknown column", () => {
    expect(() => normalizeText(rows, ["name"], ["nope"])).toThrow(ColumnNotFoundError);
  });

  it("rejects empty extra whitespace entries", () => {
    expect(() => normalizeText(rows, ["name"], ["name"], { extraWhitespace: [""] })).toThrow(ValidationError);
  });

  it("escapes regular expression metacharacters in extra whitespace", () => {
    const raw = [{ a: "x.y" }];
    const result = normalizeText(raw, ["a"], ["a"], { extraWhitespace: ["."] });
    expect(result.rows[0]?.a).toBe("x y");
  });
});
