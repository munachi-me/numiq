import { describe, expect, it } from "vitest";
import { createDataset } from "../../src/index.js";

/**
 * v1.1.0 adds a data-intelligence surface: `profile()` and the quality reports answer
 * "is this dataset ready", while `normalizeText()` and the `unique` validation rule are
 * the fixes for what they find.
 *
 * The point of these tests is cross-surface consistency. Several methods look at the same
 * cells, and a package is only trustworthy if they agree: a missing value is missing
 * everywhere, a duplicate is a duplicate everywhere, and an outlier count does not depend
 * on which method you asked.
 */
const messy = () =>
  createDataset([
    { name: " Ada ", age: 36, salary: 100, dept: "eng" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: "Cara", age: 41, salary: 1000000, dept: "ops" },
    { name: "bob", age: null, salary: 200, dept: "eng" },
    { name: null, age: 29, salary: 150, dept: "ops" },
  ]);

describe("v1.1.0 data quality workflow", () => {
  it("agrees on missing values across every surface", () => {
    const data = messy();
    const profile = data.profile();
    const report = data.missingValues();

    expect(report.totalMissing).toBe(profile.summary.missingValues);
    for (const column of data.columns) {
      const fromDescribe = data.describe(column).missing;
      const fromProfile = profile.get(column).missing;
      const fromReport = report.columns.find((item) => item.column === column)?.missing;
      expect(fromProfile).toBe(fromDescribe);
      expect(fromReport).toBe(fromDescribe);
    }
  });

  it("agrees on duplicates between profile(), findDuplicates() and dropDuplicates()", () => {
    const data = messy();
    const profileCount = data.profile().summary.duplicateRows;
    const report = data.findDuplicates();
    const afterDrop = data.dropDuplicates();

    expect(report.duplicateRows).toBe(profileCount);
    expect(report.removable).toBe(profileCount);
    expect(afterDrop.rowCount).toBe(data.rowCount - profileCount);
  });

  it("agrees on outliers between profile(), detectOutliers() and outliers()", () => {
    const data = messy();
    const fromReport = data.detectOutliers();
    const salary = fromReport.columns.find((column) => column.column === "salary");
    const fromMethod = data.outliers("salary");
    const fromProfile = data
      .profile()
      .findings.find((finding) => finding.code === "OUTLIERS" && finding.column === "salary");

    expect(salary?.count).toBe(fromMethod.outliers.length);
    expect(fromProfile?.count).toBe(fromMethod.outliers.length);
  });

  it("agrees on severity between profile() and getQualityReport()", () => {
    const data = messy();
    const report = data.getQualityReport();
    for (const finding of data.profile().findings) {
      const counterpart = report.findings.find((item) => item.code === finding.code && item.column === finding.column);
      expect(counterpart?.severity, `${finding.code} on ${String(finding.column)}`).toBe(finding.severity);
    }
  });

  it("lets a detected problem be fixed and the problem disappear", () => {
    const data = messy();
    expect(data.profile().findings.some((finding) => finding.code === "UNTRIMMED_STRINGS")).toBe(true);

    const { dataset, changedRows } = data.normalizeText({ case: "lower" });
    expect(changedRows).toBeGreaterThan(0);
    expect(dataset.profile().findings.some((finding) => finding.code === "UNTRIMMED_STRINGS")).toBe(false);
    expect(dataset.data[0]?.name).toBe("ada");
  });

  it("lets duplicates be removed after being found", () => {
    const data = messy();
    const duplicates = data.findDuplicates();
    const cleaned = data.dropDuplicates();
    expect(cleaned.findDuplicates().duplicateRows).toBe(0);
    expect(duplicates.duplicateRows).toBeGreaterThan(0);
  });

  it("catches a duplicate key that findDuplicates also finds", () => {
    const data = createDataset([{ id: 1 }, { id: 2 }, { id: 1 }]);
    const validation = data.validate({ id: { unique: true } });
    expect(validation.valid).toBe(false);
    expect(validation.issueCount).toBe(data.findDuplicates({ columns: ["id"] }).duplicateRows);
  });

  it("never mutates the dataset across the whole surface", () => {
    const data = messy();
    const before = JSON.stringify(data.data);
    data.profile();
    data.profile("name");
    data.getQualityReport();
    data.missingValues();
    data.findDuplicates();
    data.detectOutliers();
    data.normalizeText({ case: "upper" });
    expect(JSON.stringify(data.data)).toBe(before);
  });

  it("keeps describe() unchanged by the new surface", () => {
    const data = messy();
    const before = data.describe();
    data.profile();
    const after = data.describe();
    expect(after.table()).toBe(before.table());
    expect(after.profiles.length).toBe(before.profiles.length);
  });

  it("works end to end on a clean dataset without findings", () => {
    const clean = createDataset([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
      { a: 3, b: "z" },
    ]);
    const profile = clean.profile();
    expect(profile.healthy).toBe(true);
    expect(profile.summary.missingValues).toBe(0);
    expect(profile.summary.duplicateRows).toBe(0);
    expect(profile.findings.filter((finding) => finding.severity === "warning")).toEqual([]);
    expect(clean.getQualityReport().findings).toEqual([]);
  });

  it("reports on a single column without dataset-level noise", () => {
    const profile = messy().profile("age");
    expect(profile.columns).toEqual(["age"]);
    expect(profile.findings.every((finding) => finding.column === "age")).toBe(true);
  });

  it("only reports duplicate rows when every column is profiled", () => {
    const data = messy();
    expect(data.profile().findings.some((finding) => finding.code === "DUPLICATE_ROWS")).toBe(true);
    expect(data.profile(["name", "age"]).findings.some((finding) => finding.code === "DUPLICATE_ROWS")).toBe(false);
  });
});
