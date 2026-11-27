import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { QualityReport } from "../../src/core/quality.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const sample = () =>
  createDataset([
    { name: " Ada ", age: 36, salary: 100, dept: "eng" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: "Cara", age: 41, salary: 1000000, dept: "ops" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: null, age: 29, salary: 150, dept: "ops" },
  ]);

describe("missingValues", () => {
  it("counts missing cells per column", () => {
    const report = sample().missingValues();
    expect(report.totalMissing).toBe(3);
    expect(report.totalCells).toBe(20);
    expect(report.percent).toBe(15);
  });

  it("locates the missing rows", () => {
    const report = sample().missingValues();
    const age = report.columns.find((column) => column.column === "age");
    expect(age?.rows).toEqual([1, 3]);
    expect(age?.truncated).toBe(false);
  });

  it("lists affected columns worst first", () => {
    expect(sample().missingValues().affected).toEqual(["age", "name"]);
  });

  it("agrees with profile()", () => {
    const data = sample();
    expect(data.missingValues().totalMissing).toBe(data.profile().summary.missingValues);
  });

  it("agrees with describe() per column", () => {
    const data = sample();
    for (const column of data.columns) {
      const summary = data.missingValues().columns.find((item) => item.column === column);
      expect(summary?.missing).toBe(data.describe(column).missing);
    }
  });

  it("caps recorded rows and flags truncation", () => {
    const data = createDataset([{ x: null }, { x: null }, { x: null }]);
    const summary = data.missingValues({ maxRows: 1 }).columns[0];
    expect(summary?.rows).toHaveLength(1);
    expect(summary?.truncated).toBe(true);
    expect(summary?.missing).toBe(3);
  });

  it("restricts to chosen columns", () => {
    const report = sample().missingValues({ columns: ["age"] });
    expect(report.columns).toHaveLength(1);
    expect(report.totalCells).toBe(5);
  });

  it("rejects an unknown column", () => {
    expect(() => sample().missingValues({ columns: ["nope"] })).toThrow(ColumnNotFoundError);
  });

  it("rejects a negative maxRows", () => {
    expect(() => sample().missingValues({ maxRows: -1 })).toThrow(ValidationError);
  });
});

describe("findDuplicates", () => {
  it("finds whole-row duplicates", () => {
    const report = sample().findDuplicates();
    expect(report.duplicateRows).toBe(1);
    expect(report.groups[0]?.rows).toEqual([1, 3]);
  });

  it("reports the repeated values", () => {
    const report = sample().findDuplicates();
    expect(report.groups[0]?.values).toEqual({ name: "bob", age: null, salary: 200, dept: "eng" });
  });

  it("honours a subset of key columns", () => {
    expect(sample().findDuplicates({ columns: ["dept"] }).duplicateRows).toBe(3);
  });

  it("agrees with profile() duplicate count", () => {
    const data = sample();
    expect(data.findDuplicates().duplicateRows).toBe(data.profile().summary.duplicateRows);
  });

  it("counts what dropDuplicates would remove", () => {
    const data = sample();
    const report = data.findDuplicates();
    expect(report.removable).toBe(report.duplicateRows);
    expect(data.dropDuplicates().rowCount).toBe(data.rowCount - report.duplicateRows);
  });

  it("returns nothing when every row is unique", () => {
    const report = createDataset([{ a: 1 }, { a: 2 }]).findDuplicates();
    expect(report.groups).toEqual([]);
    expect(report.duplicateRows).toBe(0);
  });

  it("orders the largest group first", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }, { a: 2 }, { a: 2 }, { a: 1 }]);
    expect(data.findDuplicates().groups[0]?.rows).toHaveLength(3);
  });

  it("caps groups and flags truncation", () => {
    const rows = Array.from({ length: 10 }, () => [{ a: 1 }, { a: 1 }]).flat();
    const report = createDataset(rows).findDuplicates({ maxGroups: 1 });
    expect(report.groups).toHaveLength(1);
    expect(report.duplicateRows).toBeGreaterThan(1);
  });

  it("rejects an empty key list", () => {
    expect(() => sample().findDuplicates({ columns: [] })).toThrow(ValidationError);
  });
});

describe("detectOutliers", () => {
  it("locates outliers by row", () => {
    const report = sample().detectOutliers();
    const salary = report.columns.find((column) => column.column === "salary");
    expect(salary?.outliers).toEqual([{ row: 2, value: 1000000 }]);
  });

  it("skips non-numeric and missing cells", () => {
    const report = sample().detectOutliers();
    expect(report.columns.some((column) => column.column === "name")).toBe(false);
  });

  it("exposes the fences used", () => {
    const salary = sample()
      .detectOutliers()
      .columns.find((column) => column.column === "salary");
    expect(salary?.bounds.lower).toBe(75);
    expect(salary?.bounds.upper).toBe(275);
  });

  it("supports the z-score method", () => {
    const report = sample().detectOutliers({ method: "zscore" });
    expect(report.columns[0]?.method).toBe("zscore");
  });

  it("restricts to chosen columns", () => {
    const report = sample().detectOutliers({ columns: ["age"] });
    expect(report.columns.map((column) => column.column)).toEqual(["age"]);
  });

  it("agrees with profile() outlier counts", () => {
    const data = sample();
    const report = data.detectOutliers();
    for (const column of report.columns) {
      const finding = data.profile().findings.find((item) => item.code === "OUTLIERS" && item.column === column.column);
      expect(finding?.count ?? 0).toBe(column.count);
    }
  });

  it("rejects an unknown method", () => {
    expect(() => sample().detectOutliers({ method: "nope" as "iqr" })).toThrow(ValidationError);
  });

  it("rejects a non-positive factor", () => {
    expect(() => sample().detectOutliers({ factor: 0 })).toThrow(ValidationError);
  });

  it("returns no outliers for a constant column", () => {
    const report = createDataset([{ x: 5 }, { x: 5 }, { x: 5 }]).detectOutliers();
    expect(report.totalOutliers).toBe(0);
  });
});

describe("qualityReport", () => {
  it("returns a QualityReport", () => {
    expect(sample().qualityReport()).toBeInstanceOf(QualityReport);
  });

  it("ranks errors before warnings before info", () => {
    const report = sample().qualityReport();
    const rank = { error: 0, warning: 1, info: 2 };
    const ranks = report.findings.map((finding) => rank[finding.severity]);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it("is healthy when nothing is an error", () => {
    expect(sample().qualityReport().healthy).toBe(true);
  });

  it("is unhealthy when a column is entirely missing", () => {
    expect(createDataset([{ x: null }]).qualityReport().healthy).toBe(false);
  });

  it("matches profile() severity for every shared finding", () => {
    const data = sample();
    const profile = data.profile().findings;
    const report = data.qualityReport().findings;
    for (const finding of profile) {
      const counterpart = report.find((item) => item.code === finding.code && item.column === finding.column);
      expect(counterpart?.severity, `${finding.code} on ${String(finding.column)}`).toBe(finding.severity);
    }
  });

  it("matches profile() counts for every shared finding", () => {
    const data = sample();
    const report = data.qualityReport().findings;
    for (const finding of data.profile().findings) {
      const counterpart = report.find((item) => item.code === finding.code && item.column === finding.column);
      expect(counterpart?.count, `${finding.code} on ${String(finding.column)}`).toBe(finding.count);
    }
  });

  it("filters by column and by code", () => {
    const report = sample().qualityReport();
    expect(report.forColumn("age").every((finding) => finding.column === "age")).toBe(true);
    expect(report.forCode("DUPLICATE_ROWS")).toHaveLength(1);
  });

  it("counts severities", () => {
    const report = sample().qualityReport();
    const total = report.bySeverity.error + report.bySeverity.warning + report.bySeverity.info;
    expect(total).toBe(report.findings.length);
  });

  it("renders a table and serializes", () => {
    const report = sample().qualityReport();
    expect(report.table()).toContain("severity");
    expect(JSON.parse(JSON.stringify(report.toJSON())).rowCount).toBe(5);
  });

  it("does not modify the dataset", () => {
    const data = sample();
    const before = JSON.stringify(data.data);
    data.qualityReport();
    data.detectOutliers();
    data.findDuplicates();
    data.missingValues();
    expect(JSON.stringify(data.data)).toBe(before);
  });
});
