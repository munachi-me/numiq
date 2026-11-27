import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { ValidationError } from "../../src/errors/index.js";

describe("validation: unique rule", () => {
  it("accepts distinct values", () => {
    const report = createDataset([{ id: 1 }, { id: 2 }, { id: 3 }]).validate({ id: { unique: true } });
    expect(report.valid).toBe(true);
    expect(report.issueCount).toBe(0);
  });

  it("rejects a repeated value", () => {
    const report = createDataset([{ id: 1 }, { id: 2 }, { id: 1 }]).validate({ id: { unique: true } });
    expect(report.valid).toBe(false);
    expect(report.issues[0]?.code).toBe("DUPLICATE_VALUE");
    expect(report.issues[0]?.row).toBe(2);
  });

  it("names the first row the value appeared in", () => {
    const report = createDataset([{ id: 5 }, { id: 5 }]).validate({ id: { unique: true } });
    expect(report.issues[0]?.message).toContain("row 0");
  });

  it("reports one issue per repeated occurrence", () => {
    const report = createDataset([{ id: 1 }, { id: 1 }, { id: 1 }]).validate({ id: { unique: true } });
    expect(report.issueCount).toBe(2);
    expect(report.invalidRows).toBe(2);
  });

  it("exempts missing values", () => {
    const report = createDataset([{ id: null }, { id: null }, { id: 1 }]).validate({ id: { unique: true } });
    expect(report.valid).toBe(true);
  });

  it("distinguishes types, so a number and a string differ", () => {
    // A mixed column is needed: `createDataset` normalizes a uniform-looking column, so
    // "1" alongside 1 would arrive as the number 1.
    const report = createDataset([{ id: "a" }, { id: 1 }]).validate({ id: { unique: true } });
    expect(report.valid).toBe(true);
  });

  it("distinguishes a Date from its ISO string", () => {
    const report = createDataset([{ id: new Date("2020-01-01") }, { id: "2020-01-01" }]).validate({
      id: { unique: true },
    });
    expect(report.valid).toBe(true);
  });

  it("supports a composite key", () => {
    const rows = [
      { a: 1, b: 1 },
      { a: 1, b: 2 },
      { a: 1, b: 1 },
    ];
    const report = createDataset(rows).validate({ a: { unique: ["a", "b"] } });
    expect(report.valid).toBe(false);
    expect(report.issues[0]?.code).toBe("DUPLICATE_VALUE");
  });

  it("accepts unique combinations that repeat a single column", () => {
    const rows = [
      { a: 1, b: 1 },
      { a: 1, b: 2 },
    ];
    const report = createDataset(rows).validate({ a: { unique: ["a", "b"] } });
    expect(report.valid).toBe(true);
  });

  it("reports a missing key column", () => {
    const report = createDataset([{ a: 1 }]).validate({ a: { unique: ["a", "b"] } });
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === "MISSING_COLUMN")).toBe(true);
  });

  it("ignores unique: false", () => {
    const report = createDataset([{ id: 1 }, { id: 1 }]).validate({ id: { unique: false } });
    expect(report.valid).toBe(true);
  });

  it("composes with other rules on the same column", () => {
    const rows = [{ id: 1 }, { id: 1 }, { id: "x" }];
    const report = createDataset(rows).validate({ id: { type: "integer", unique: true } });
    expect(report.byCode.DUPLICATE_VALUE).toBe(1);
    expect(report.byCode.TYPE_MISMATCH).toBe(1);
  });

  it("rejects a malformed unique value", () => {
    expect(() => createDataset([{ a: 1 }]).validate({ a: { unique: "yes" as unknown as boolean } })).toThrow(
      ValidationError,
    );
  });

  it("is skipped by columnsOnly mode", () => {
    const report = createDataset([{ id: 1 }, { id: 1 }]).validate({ id: { unique: true } }, { columnsOnly: true });
    expect(report.valid).toBe(true);
  });

  it("agrees with findDuplicates on the same column", () => {
    const data = createDataset([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }]);
    const report = data.validate({ id: { unique: true } });
    expect(report.issueCount).toBe(data.findDuplicates({ columns: ["id"] }).duplicateRows);
  });
});
