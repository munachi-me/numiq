import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { DatasetProfile } from "../../src/core/profile.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const sample = () =>
  createDataset([
    { name: " Ada ", age: 36, salary: 100, dept: "eng" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: "Cara", age: 41, salary: 1000000, dept: "ops" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: null, age: 29, salary: 150, dept: "ops" },
  ]);

describe("profile: summary", () => {
  it("reports the shape", () => {
    const profile = sample().profile();
    expect(profile.summary.rowCount).toBe(5);
    expect(profile.summary.columnCount).toBe(4);
    expect(profile.summary.shape).toEqual([5, 4]);
  });

  it("counts missing cells and their share", () => {
    const profile = sample().profile();
    expect(profile.summary.missingValues).toBe(3);
    expect(profile.summary.missingPercent).toBe(15);
  });

  it("counts duplicate rows", () => {
    expect(sample().profile().summary.duplicateRows).toBe(1);
  });

  it("breaks columns down by kind", () => {
    const { types, typeCount } = sample().profile().summary;
    expect(types).toEqual({ numeric: 2, categorical: 2, temporal: 0, boolean: 0, mixed: 0, empty: 0 });
    expect(typeCount).toBe(2);
  });

  it("lists empty and constant columns", () => {
    const profile = createDataset([
      { a: 1, b: null },
      { a: 1, b: null },
    ]).profile();
    expect(profile.summary.constantColumns).toEqual(["a"]);
    expect(profile.summary.emptyColumns).toEqual(["b"]);
  });

  it("reports a positive memory estimate", () => {
    expect(sample().profile().summary.memoryBytes).toBeGreaterThan(0);
  });

  it("handles a dataset with no rows", () => {
    const profile = createDataset([]).profile();
    expect(profile.summary.rowCount).toBe(0);
    expect(profile.summary.missingPercent).toBe(0);
    expect(profile.findings.map((finding) => finding.code)).toContain("NO_COLUMNS");
  });
});

describe("profile: agreement with describe", () => {
  it("produces the same per-column statistics", () => {
    const data = sample();
    const profile = data.profile();
    for (const column of data.columns) {
      const described = data.describe(column);
      const profiled = profile.get(column);
      expect(profiled.mean).toBe(described.mean);
      expect(profiled.median).toBe(described.median);
      expect(profiled.std).toBe(described.std);
      expect(profiled.unique).toBe(described.unique);
      expect(profiled.missing).toBe(described.missing);
      expect(profiled.min).toEqual(described.min);
      expect(profiled.max).toEqual(described.max);
    }
  });

  it("honours ddof and records it", () => {
    const profile = sample().profile({ ddof: 0 });
    expect(profile.ddof).toBe(0);
    expect(profile.get("age").ddof).toBe(0);
  });

  it("delegates table() to the underlying description", () => {
    const data = sample();
    expect(data.profile().table()).toBe(data.describe().table());
  });
});

describe("profile: overloads", () => {
  it("profiles every column by default", () => {
    expect(sample().profile().profiles).toHaveLength(4);
  });

  it("profiles one named column", () => {
    const profile = sample().profile("age");
    expect(profile.profiles).toHaveLength(1);
    expect(profile.summary.columnCount).toBe(1);
    expect(profile.columns).toEqual(["age"]);
  });

  it("profiles a list of columns in the given order", () => {
    const profile = sample().profile(["salary", "name"]);
    expect(profile.columns).toEqual(["salary", "name"]);
  });

  it("drops repeated names so totals are not double counted", () => {
    const profile = sample().profile(["age", "age"]);
    expect(profile.summary.columnCount).toBe(1);
    expect(profile.summary.missingValues).toBe(2);
  });

  it("rejects an unknown column", () => {
    expect(() => sample().profile("nope")).toThrow(ColumnNotFoundError);
  });

  it("rejects an unknown column inside a list", () => {
    expect(() => sample().profile(["age", "nope"])).toThrow(ColumnNotFoundError);
  });

  it("rejects an empty column list", () => {
    expect(() => sample().profile([])).toThrow(ValidationError);
  });

  it("rejects an empty column name", () => {
    expect(() => sample().profile("")).toThrow(ValidationError);
  });
});

describe("profile: findings", () => {
  it("orders findings by severity", () => {
    const rank = { error: 0, warning: 1, info: 2 };
    const findings = sample().profile().findings;
    const ranks = findings.map((finding) => rank[finding.severity]);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it("flags untrimmed strings", () => {
    const finding = sample()
      .profile()
      .findings.find((item) => item.code === "UNTRIMMED_STRINGS");
    expect(finding?.column).toBe("name");
    expect(finding?.count).toBe(1);
  });

  it("flags duplicate rows at dataset level", () => {
    const finding = sample()
      .profile()
      .findings.find((item) => item.code === "DUPLICATE_ROWS");
    expect(finding?.column).toBeNull();
    expect(finding?.count).toBe(1);
  });

  it("flags a fully missing column as an error", () => {
    const profile = createDataset([{ x: null }, { x: null }]).profile();
    const finding = profile.findings.find((item) => item.code === "ALL_MISSING");
    expect(finding?.severity).toBe("error");
    expect(profile.healthy).toBe(false);
  });

  it("flags constant columns as informational", () => {
    const profile = createDataset([{ x: 7 }, { x: 7 }]).profile();
    const finding = profile.findings.find((item) => item.code === "CONSTANT_COLUMN");
    expect(finding?.severity).toBe("info");
    expect(profile.healthy).toBe(true);
  });

  it("flags mixed types and names them", () => {
    const profile = createDataset([{ x: 1 }, { x: "two" }, { x: true }]).profile();
    const finding = profile.findings.find((item) => item.code === "MIXED_TYPES");
    expect(finding?.severity).toBe("warning");
    expect(Object.keys(finding?.detail.types as object).sort()).toEqual(["boolean", "number", "string"]);
  });

  it("flags IQR outliers on numeric columns", () => {
    const finding = sample()
      .profile()
      .findings.find((item) => item.code === "OUTLIERS");
    expect(finding?.column).toBe("salary");
    expect(finding?.count).toBe(1);
  });

  it("raises missing values to a warning at or above half the column", () => {
    const profile = createDataset([{ x: null }, { x: null }, { x: 1 }]).profile();
    const finding = profile.findings.find((item) => item.code === "MISSING_VALUES");
    expect(finding?.severity).toBe("warning");
  });

  it("truncates findings and records the true total", () => {
    const wide = createDataset(Array.from({ length: 40 }, (_, index) => ({ [`c${index}`]: null })));
    const profile = wide.profile({ maxFindings: 5 });
    expect(profile.findings).toHaveLength(5);
    expect(profile.truncated).toBe(true);
    expect(profile.findingCount).toBeGreaterThan(5);
  });

  it("counts severities before truncation", () => {
    const wide = createDataset(Array.from({ length: 40 }, (_, index) => ({ [`c${index}`]: null })));
    const profile = wide.profile({ maxFindings: 2 });
    expect(profile.bySeverity.error).toBe(40);
    expect(profile.findings).toHaveLength(2);
  });

  it("rejects a negative maxFindings", () => {
    expect(() => sample().profile({ maxFindings: -1 })).toThrow(ValidationError);
  });

  it("filters findings by column", () => {
    const profile = sample().profile();
    const forAge = profile.findingsFor("age");
    expect(forAge.every((finding) => finding.column === "age")).toBe(true);
    expect(forAge.length).toBeGreaterThan(0);
  });
});

describe("profile: immutability and serialization", () => {
  it("does not modify the dataset", () => {
    const data = sample();
    const before = JSON.stringify(data.data);
    data.profile();
    data.profile("age");
    expect(JSON.stringify(data.data)).toBe(before);
  });

  it("returns frozen findings", () => {
    const profile = sample().profile();
    expect(Object.isFrozen(profile.findings)).toBe(true);
    expect(() => {
      (profile.findings as unknown as unknown[]).push({});
    }).toThrow();
  });

  it("round-trips through JSON", () => {
    const profile = sample().profile();
    const parsed = JSON.parse(JSON.stringify(profile.toJSON())) as { rowCount: number; findings: unknown[] };
    expect(parsed.rowCount).toBe(5);
    expect(parsed.findings.length).toBe(profile.findings.length);
  });

  it("is an instance of DatasetProfile", () => {
    expect(sample().profile()).toBeInstanceOf(DatasetProfile);
  });

  it("renders findings as a table", () => {
    const table = sample().profile().findingsTable();
    expect(table).toContain("severity");
    expect(table).toContain("UNTRIMMED_STRINGS");
  });
});
