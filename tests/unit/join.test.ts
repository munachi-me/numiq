import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { joinTables } from "../../src/core/join.js";
import { ColumnNotFoundError } from "../../src/errors/index.js";

const orders = () => [
  { order: 1, customer: 10, total: 100 },
  { order: 2, customer: 20, total: 200 },
  { order: 3, customer: 30, total: 300 },
];

const customers = () => [
  { customer: 10, name: "Ada" },
  { customer: 20, name: "Bo" },
  { customer: 40, name: "Dee" },
];

describe("join: inner", () => {
  it("keeps only matching rows and is the default", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer" });
    expect(result.rowCount).toBe(2);
    expect(result.data).toEqual([
      { order: 1, customer: 10, total: 100, name: "Ada" },
      { order: 2, customer: 20, total: 200, name: "Bo" },
    ]);
  });

  it("produces the same result when how is explicit", () => {
    const data = createDataset(orders());
    const left = createDataset(customers());
    expect(data.join(left, { on: "customer", how: "inner" }).data).toEqual(data.join(left, { on: "customer" }).data);
  });

  it("drops the right key column when it duplicates the left one", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer" });
    expect(result.columns).toEqual(["order", "customer", "total", "name"]);
  });
});

describe("join: left, right, full", () => {
  it("left keeps every left row and nulls the right side", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer", how: "left" });
    expect(result.rowCount).toBe(3);
    expect(result.data[2]).toEqual({ order: 3, customer: 30, total: 300, name: null });
  });

  it("right keeps every right row and nulls the left side", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer", how: "right" });
    expect(result.rowCount).toBe(3);
    expect(result.data.map((row) => row.name)).toEqual(["Ada", "Bo", "Dee"]);
    expect(result.data[2]).toEqual({ order: null, customer: 40, total: null, name: "Dee" });
  });

  it("full keeps both sides", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer", how: "full" });
    expect(result.rowCount).toBe(4);
    expect(result.data.map((row) => row.name)).toEqual(["Ada", "Bo", null, "Dee"]);
  });

  it("orders left rows first, then unmatched right rows", () => {
    const result = createDataset(orders()).join(createDataset(customers()), { on: "customer", how: "full" });
    expect(result.data.map((row) => row.order)).toEqual([1, 2, 3, null]);
  });
});

describe("join: key handling", () => {
  it("supports differently named keys", () => {
    const left = createDataset([{ id: 1, v: "a" }]);
    const right = createDataset([{ key: 1, w: "b" }]);
    const result = left.join(right, { leftOn: "id", rightOn: "key" });
    expect(result.data).toEqual([{ id: 1, v: "a", key: 1, w: "b" }]);
  });

  it("supports a composite key", () => {
    const left = createDataset([
      { a: 1, b: 1, v: "hit" },
      { a: 1, b: 2, v: "miss" },
    ]);
    const right = createDataset([{ a: 1, b: 1, w: "yes" }]);
    const result = left.join(right, { on: ["a", "b"] });
    expect(result.data).toEqual([{ a: 1, b: 1, v: "hit", w: "yes" }]);
  });

  it("does not match values of different types", () => {
    // Uses raw rows: createDataset normalizes a numeric string to a number, so the
    // distinction is only observable below the normalization layer.
    const result = joinTables([{ id: 1 }], ["id"], [{ id: "1", w: "b" }], ["id", "w"], { on: "id" });
    expect(result.rows).toEqual([]);
  });

  it("does not match null keys by default", () => {
    const left = createDataset([{ id: null, v: "a" }]);
    const right = createDataset([{ id: null, w: "b" }]);
    expect(left.join(right, { on: "id" }).rowCount).toBe(0);
  });

  it("matches null keys when nullsMatch is set", () => {
    const left = createDataset([{ id: null, v: "a" }]);
    const right = createDataset([{ id: null, w: "b" }]);
    expect(left.join(right, { on: "id", nullsMatch: true }).rowCount).toBe(1);
  });

  it("counts a null-key left row as unmatched in a left join", () => {
    const left = createDataset([{ id: null, v: "a" }]);
    const right = createDataset([{ id: 1, w: "b" }]);
    const result = left.join(right, { on: "id", how: "left" });
    expect(result.data).toEqual([{ id: null, v: "a", w: null }]);
  });

  it("expands one-to-many relationships", () => {
    const left = createDataset([
      { id: 1, order: "a" },
      { id: 1, order: "b" },
    ]);
    const right = createDataset([{ id: 1, name: "Ada" }]);
    const result = left.join(right, { on: "id" });
    expect(result.rowCount).toBe(2);
    expect(result.data.map((row) => row.name)).toEqual(["Ada", "Ada"]);
  });

  it("expands many-to-many relationships", () => {
    const left = createDataset([
      { id: 1, l: "x" },
      { id: 1, l: "y" },
    ]);
    const right = createDataset([
      { id: 1, r: "p" },
      { id: 1, r: "q" },
    ]);
    const result = left.join(right, { on: "id" });
    expect(result.rowCount).toBe(4);
    expect(result.data.map((row) => `${String(row.l)}${String(row.r)}`)).toEqual(["xp", "xq", "yp", "yq"]);
  });
});

describe("join: overlapping columns", () => {
  it("suffixes both sides on a non-key collision", () => {
    const left = createDataset([{ id: 1, value: "left" }]);
    const right = createDataset([{ id: 1, value: "right" }]);
    const result = left.join(right, { on: "id" });
    expect(result.columns).toEqual(["id", "value_left", "value_right"]);
    expect(result.data[0]).toEqual({ id: 1, value_left: "left", value_right: "right" });
  });

  it("honours custom suffixes", () => {
    const left = createDataset([{ id: 1, value: "l" }]);
    const right = createDataset([{ id: 1, value: "r" }]);
    const result = left.join(right, { on: "id", suffixes: ["_a", "_b"] });
    expect(result.columns).toEqual(["id", "value_a", "value_b"]);
  });

  it("reports collisions", () => {
    const left = createDataset([{ id: 1, value: "l" }]);
    const right = createDataset([{ id: 1, value: "r" }]);
    const { report } = left.joinReport(right, { on: "id" });
    expect(report.collisions).toEqual(["value"]);
  });

  it("rejects identical suffixes", () => {
    const left = createDataset([{ id: 1 }]);
    const right = createDataset([{ id: 1 }]);
    expect(() => left.join(right, { on: "id", suffixes: ["_x", "_x"] })).toThrow(/must differ/);
  });
});

describe("join: validation", () => {
  it("rejects a missing left key", () => {
    expect(() => createDataset([{ a: 1 }]).join(createDataset([{ b: 1 }]), { on: "a" })).toThrow(ColumnNotFoundError);
  });

  it("rejects a missing right key", () => {
    const left = createDataset([{ a: 1 }]);
    const right = createDataset([{ c: 1 }]);
    expect(() => left.join(right, { leftOn: "a", rightOn: "b" })).toThrow(/right key column/);
  });

  it("rejects a missing left key in an explicit mapping", () => {
    const left = createDataset([{ a: 1 }]);
    const right = createDataset([{ c: 1 }]);
    expect(() => left.join(right, { leftOn: "z", rightOn: "c" })).toThrow(/left key column/);
  });

  it("rejects an unknown how", () => {
    expect(() => createDataset([{ a: 1 }]).join(createDataset([{ a: 1 }]), { on: "a", how: "cross" as never })).toThrow(
      /how/,
    );
  });

  it("rejects on together with leftOn", () => {
    expect(() =>
      createDataset([{ a: 1 }]).join(createDataset([{ a: 1 }]), { on: "a", leftOn: "a", rightOn: "a" }),
    ).toThrow(/not both/);
  });

  it("rejects missing keys entirely", () => {
    expect(() => createDataset([{ a: 1 }]).join(createDataset([{ a: 1 }]), {})).toThrow(/leftOn/);
  });

  it("rejects mismatched key lengths", () => {
    const left = createDataset([{ a: 1, b: 2 }]);
    const right = createDataset([{ c: 1 }]);
    expect(() => left.join(right, { leftOn: ["a", "b"], rightOn: ["c"] })).toThrow(/same length/);
  });

  it("rejects a non-Dataset argument", () => {
    expect(() => createDataset([{ a: 1 }]).join({} as never, { on: "a" })).toThrow(/another Dataset/);
  });

  it("rejects a negative maxRows", () => {
    expect(() => createDataset([{ a: 1 }]).join(createDataset([{ a: 1 }]), { on: "a", maxRows: -1 })).toThrow(
      /non-negative integer/,
    );
  });

  it("guards against an accidental Cartesian explosion", () => {
    const left = createDataset(Array.from({ length: 100 }, (_v, i) => ({ id: 1, i })));
    const right = createDataset(Array.from({ length: 100 }, (_v, i) => ({ id: 1, j: i })));
    expect(() => left.join(right, { on: "id", maxRows: 1000 })).toThrow(/exceeded maxRows/);
  });
});

describe("join: report", () => {
  it("counts matched and unmatched rows", () => {
    const { report } = createDataset(orders()).joinReport(createDataset(customers()), {
      on: "customer",
      how: "full",
    });
    expect(report.how).toBe("full");
    expect(report.rowCount).toBe(4);
    expect(report.matched).toBe(2);
    expect(report.leftUnmatched).toBe(1);
    expect(report.rightUnmatched).toBe(1);
    expect(report.leftKeys).toEqual(["customer"]);
  });

  it("returns the same rows as join", () => {
    const left = createDataset(orders());
    const right = createDataset(customers());
    expect(left.joinReport(right, { on: "customer", how: "left" }).dataset.data).toEqual(
      left.join(right, { on: "customer", how: "left" }).data,
    );
  });
});

describe("join: immutability", () => {
  it("leaves both sources untouched", () => {
    const left = createDataset(orders());
    const right = createDataset(customers());
    const beforeLeft = left.data;
    const beforeRight = right.data;
    left.join(right, { on: "customer", how: "full" });
    expect(left.data).toEqual(beforeLeft);
    expect(right.data).toEqual(beforeRight);
    expect(left.columns).toEqual(["order", "customer", "total"]);
  });

  it("clones values so a joined row cannot mutate its source", () => {
    const nested = { deep: { n: 1 } };
    const left = createDataset([{ id: 1, meta: nested }]);
    const right = createDataset([{ id: 1, other: 2 }]);
    const result = left.join(right, { on: "id" });
    (result.data[0]?.meta as { deep: { n: number } }).deep.n = 99;
    expect(nested.deep.n).toBe(1);
  });

  it("handles empty inputs", () => {
    const empty = createDataset([], { columns: ["id", "v"] });
    const right = createDataset([{ id: 1, w: 2 }]);
    expect(empty.join(right, { on: "id" }).rowCount).toBe(0);
    expect(empty.join(right, { on: "id", how: "right" }).rowCount).toBe(1);
    expect(createDataset([{ id: 1 }]).join(createDataset([], { columns: ["id"] }), { on: "id" }).rowCount).toBe(0);
  });

  it("works through the standalone function", () => {
    const result = joinTables([{ customer: 10 }], ["customer"], [{ customer: 10, name: "Ada" }], ["customer", "name"], {
      on: "customer",
    });
    expect(result.rows).toEqual([{ customer: 10, name: "Ada" }]);
    expect(result.columns).toEqual(["customer", "name"]);
  });
});
