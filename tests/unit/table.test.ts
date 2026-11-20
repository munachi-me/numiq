import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { renderTable } from "../../src/display/table.js";

describe("table rendering", () => {
  const data = createDataset([
    { name: "Alice", age: 24 },
    { name: "Bob", age: 31 },
  ]);

  it("uses idx, not index, as the row label", () => {
    const output = data.table();
    expect(output).toContain("idx");
    expect(output).not.toContain("index");
  });

  it("renders headers and values", () => {
    const output = data.table();
    expect(output).toContain("name");
    expect(output).toContain("Alice");
    expect(output).toContain("31");
  });

  it("reports the visible and total row counts", () => {
    expect(data.table()).toContain("Showing 2 of 2 rows");
  });

  it("reports the shape", () => {
    expect(data.table()).toContain("2 rows × 2 columns");
  });

  it("shows NULL for missing cells", () => {
    const sparse = createDataset([{ a: null }]);
    expect(sparse.table()).toContain("NULL");
  });

  it("formats dates as ISO strings", () => {
    const dated = createDataset([{ when: new Date("2026-01-05T00:00:00Z") }]);
    expect(dated.table()).toContain("2026-01-05T00:00:00.000Z");
  });
});

describe("row limiting", () => {
  const big = createDataset(Array.from({ length: 5000 }, (_, index) => ({ index })));

  it("defaults to 1000 rows", () => {
    const output = big.table();
    expect(output).toContain("Showing 1000 of 5000 rows");
  });

  it("formats only the visible rows", () => {
    // Header, rule, body(1000), rule, summary, shape
    expect(big.table().split("\n")).toHaveLength(1006);
  });

  it("accepts a custom limit", () => {
    expect(big.table({ maxRows: 10 })).toContain("Showing 10 of 5000 rows");
    expect(big.table({ maxRows: 10 }).split("\n")).toHaveLength(16);
  });

  it("renders everything when given Infinity", () => {
    const small = createDataset(Array.from({ length: 5 }, (_, index) => ({ index })));
    expect(small.table({ maxRows: Infinity })).toContain("Showing 5 of 5 rows");
  });

  it("renders no body rows when maxRows is 0", () => {
    expect(big.table({ maxRows: 0 })).toContain("Showing 0 of 5000 rows");
  });

  it("rejects negative and fractional limits", () => {
    expect(() => big.table({ maxRows: -1 })).toThrow(RangeError);
    expect(() => big.table({ maxRows: 1.5 })).toThrow(RangeError);
  });
});

describe("wide datasets", () => {
  const wide = createDataset([Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`c${i}`, i]))]);

  it("truncates columns and says how many were hidden", () => {
    const output = wide.table();
    expect(output).toContain("… 5 more");
    expect(output).toContain("1 rows × 25 columns");
  });

  it("respects maxColumns", () => {
    expect(wide.table({ maxColumns: 3 })).toContain("… 22 more");
  });

  it("rejects a non-positive maxColumns", () => {
    expect(() => wide.table({ maxColumns: 0 })).toThrow(RangeError);
  });
});

describe("cell clipping", () => {
  it("truncates long cells with an ellipsis", () => {
    const data = createDataset([{ a: "x".repeat(100) }]);
    const output = data.table({ maxCellWidth: 10 });
    expect(output).toContain("…");
    expect(output).not.toContain("x".repeat(100));
  });
});

describe("empty datasets", () => {
  it("explains an empty dataset with columns", () => {
    const output = createDataset([], { columns: ["a"] }).table();
    expect(output).toContain("(no rows)");
    expect(output).toContain("idx");
  });

  it("explains a dataset with no columns", () => {
    expect(createDataset([]).table()).toContain("0 columns");
  });
});

describe("options", () => {
  const data = createDataset([{ a: 1 }]);

  it("can hide the index column", () => {
    expect(data.table({ showIndex: false })).not.toContain("idx");
  });

  it("can hide the shape line", () => {
    expect(data.table({ showShape: false })).not.toContain("1 rows × 1 columns");
  });

  it("exposes toTable as an alias", () => {
    expect(data.toTable()).toBe(data.table());
  });

  it("renders standalone via renderTable", () => {
    expect(renderTable([{ a: 1 }], ["a"])).toContain("1 rows × 1 columns");
  });
});
