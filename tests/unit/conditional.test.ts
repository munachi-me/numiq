import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { addConditionalColumn } from "../../src/core/conditional.js";
import { ValidationError } from "../../src/errors/index.js";

const people = () => [
  { name: "Ada", age: 12 },
  { name: "Bo", age: 30 },
  { name: "Cy", age: 65 },
  { name: "Dee", age: 80 },
  { name: "Eve", age: null },
];

const ageRules = () => [
  { when: (row: Record<string, unknown>) => row.age !== null && (row.age as number) < 18, then: "Child" },
  { when: (row: Record<string, unknown>) => row.age !== null && (row.age as number) < 65, then: "Adult" },
  { when: (row: Record<string, unknown>) => row.age !== null, then: "Elder" },
];

describe("addConditionalColumn", () => {
  it("reproduces the documented example", () => {
    const data = createDataset(people().filter((row) => row.age !== null));
    const result = data.addConditionalColumn("category", ageRules(), { else: "Unknown" });

    expect(result.columns).toEqual(["name", "age", "category"]);
    expect(result.data.map((row) => row.category)).toEqual(["Child", "Adult", "Elder", "Elder"]);
  });

  it("appends the column last and leaves the source untouched", () => {
    const data = createDataset(people());
    const result = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });

    expect(result.columns).toEqual(["name", "age", "band"]);
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.data[0]).toEqual({ name: "Ada", age: 12 });
    expect(result).not.toBe(data);
  });

  it("uses the first matching rule, not the last", () => {
    const data = createDataset([{ age: 10 }]);
    const result = data.addConditionalColumn("band", [
      { when: () => true, then: "first" },
      { when: () => true, then: "second" },
    ]);
    expect(result.data[0]?.band).toBe("first");
  });

  it("does not evaluate later rules once one matches", () => {
    const seen: string[] = [];
    const data = createDataset([{ age: 10 }]);
    data.addConditionalColumn("band", [
      { when: () => true, then: "hit" },
      {
        when: () => {
          seen.push("second");
          return true;
        },
        then: "miss",
      },
    ]);
    expect(seen).toEqual([]);
  });

  it("falls back to null when no else is given", () => {
    const data = createDataset([{ age: 30 }]);
    const result = data.addConditionalColumn("band", [{ when: () => false, then: "x" }]);
    expect(result.data[0]?.band).toBeNull();
  });

  it("supports a static else value", () => {
    const data = createDataset([{ age: 30 }]);
    expect(data.addConditionalColumn("band", [{ when: () => false, then: "x" }], { else: "other" }).data[0]?.band).toBe(
      "other",
    );
  });

  it("supports an else callback", () => {
    const data = createDataset([{ age: 30 }, { age: 40 }]);
    const result = data.addConditionalColumn("band", [{ when: () => false, then: "x" }], {
      else: (row) => `unknown-${String(row.age)}`,
    });
    expect(result.data.map((row) => row.band)).toEqual(["unknown-30", "unknown-40"]);
  });

  it("supports a then callback", () => {
    const data = createDataset([{ age: 10 }, { age: 30 }]);
    const result = data.addConditionalColumn("band", [
      { when: (row) => (row.age as number) < 18, then: (row) => `minor-${String(row.age)}` },
    ]);
    expect(result.data.map((row) => row.band)).toEqual(["minor-10", null]);
  });

  it("passes the row index to both when and then", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const result = data.addConditionalColumn("position", [
      { when: (_row, index) => index > 0, then: (_row, index) => index },
    ]);
    expect(result.data.map((row) => row.position)).toEqual([null, 1, 2]);
  });

  it("passes the column name in the rule context", () => {
    const data = createDataset([{ a: 1 }]);
    let seen: string | null = null;
    data.addConditionalColumn("label", [
      {
        when: (_row, _index, context) => {
          seen = context.column;
          return true;
        },
        then: "x",
      },
    ]);
    expect(seen).toBe("label");
  });

  it("accepts null as a deliberate then value", () => {
    const data = createDataset([{ a: 1 }]);
    expect(data.addConditionalColumn("label", [{ when: () => true, then: null }]).data[0]?.label).toBeNull();
  });

  it("accepts false and 0 as then values", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    const result = data.addConditionalColumn("flag", [
      { when: (row) => row.a === 1, then: false },
      { when: (row) => row.a === 2, then: 0 },
    ]);
    expect(result.data.map((row) => row.flag)).toEqual([false, 0]);
  });

  it("normalizes an absent cell to null, so a predicate only has one missing case to guard", () => {
    const data = createDataset([{ a: 1, b: 2 }, { a: 3 }]);
    expect(data.data[1]?.b).toBeNull();
    const result = data.addConditionalColumn("kind", [
      { when: (row) => row.b === null, then: "missing" },
      { when: () => true, then: "present" },
    ]);
    expect(result.data.map((row) => row.kind)).toEqual(["present", "missing"]);
  });

  it("does not special-case null in predicates: a null comparison is the caller's to guard", () => {
    // `null < 18` is true in JavaScript, so a predicate written against a nullable column
    // must test for missing first. The library evaluates predicates verbatim rather than
    // rewriting them, so this documents the behaviour instead of hiding it.
    const unguarded = [
      { when: (row: Record<string, unknown>) => (row.age as number) < 18, then: "Child" },
      { when: (row: Record<string, unknown>) => (row.age as number) < 65, then: "Adult" },
      { when: () => true, then: "Elder" },
    ];
    const data = createDataset(people());
    const result = data.addConditionalColumn("band", unguarded, { else: "Unknown" });
    expect(result.data[4]?.band).toBe("Child");
  });

  it("routes a null cell to else when the predicate guards for it", () => {
    const data = createDataset(people());
    const result = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });
    expect(result.data.map((row) => row.band)).toEqual(["Child", "Adult", "Elder", "Elder", "Unknown"]);
  });

  it("handles an all-null column without throwing", () => {
    const data = createDataset([{ a: null }, { a: null }]);
    const result = data.addConditionalColumn("kind", [{ when: (row) => row.a !== null, then: "has" }], {
      else: "none",
    });
    expect(result.data.map((row) => row.kind)).toEqual(["none", "none"]);
  });

  it("works on an empty dataset", () => {
    const data = createDataset([], { columns: ["age"] });
    const result = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });
    expect(result.rowCount).toBe(0);
    expect(result.columns).toEqual(["age", "band"]);
  });

  it("clones object values per row so rows never alias", () => {
    const shared = { tier: 1 };
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    const result = data.addConditionalColumn("meta", [{ when: () => true, then: shared }]);
    const first = result.data[0]?.meta as Record<string, unknown>;
    const second = result.data[1]?.meta as Record<string, unknown>;
    expect(first).toEqual({ tier: 1 });
    expect(first).not.toBe(second);
    expect(first).not.toBe(shared);
  });

  it("clones Date values per row", () => {
    const shared = new Date("2020-01-01T00:00:00Z");
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    const result = data.addConditionalColumn("at", [{ when: () => true, then: shared }]);
    const first = result.data[0]?.at as Date;
    expect(first.getTime()).toBe(shared.getTime());
    expect(first).not.toBe(shared);
  });

  it("keeps existing columns byte for byte", () => {
    const data = createDataset(people());
    const result = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });
    expect(result.data.map((row) => ({ name: row.name, age: row.age }))).toEqual(
      data.data.map((row) => ({ name: row.name, age: row.age })),
    );
  });

  it("allows a numeric generated column to be analysed", () => {
    const data = createDataset([{ age: 10 }, { age: 70 }]);
    const result = data.addConditionalColumn("score", [{ when: () => true, then: (row) => row.age as number }]);
    expect(result.dtypes.score).toBe("integer");
    expect(result.describe("score").mean).toBe(40);
  });

  it("allows a text generated column to be grouped", () => {
    const data = createDataset(people());
    const result = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });
    const grouped = result.groupBy("band").aggregate({ n: { op: "count" } });
    expect(grouped.data.map((row) => row.band).sort()).toEqual(["Adult", "Child", "Elder", "Unknown"]);
  });

  it("works with the standalone function", () => {
    const rows = [{ age: 10 }];
    const result = addConditionalColumn(rows, ["age"], "band", [{ when: () => true, then: "Child" }]);
    expect(result.columns).toEqual(["age", "band"]);
    expect(result.rows[0]?.band).toBe("Child");
  });
});

describe("addConditionalColumn validation", () => {
  it("rejects an empty name", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("", [{ when: () => true, then: 1 }])).toThrow(ValidationError);
  });

  it("rejects a whitespace-only name", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("   ", [{ when: () => true, then: 1 }])).toThrow(/non-empty column name/);
  });

  it("rejects a duplicate column name", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("a", [{ when: () => true, then: 1 }])).toThrow(/cannot overwrite/);
  });

  it("rejects a non-array rules argument", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", {} as never)).toThrow(/expects an array of rules/);
  });

  it("rejects an empty rules array", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [])).toThrow(/at least one rule/);
  });

  it("rejects a rule that is not an object", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [null as never])).toThrow(/rule 0 must be an object/);
  });

  it("rejects a rule without when", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [{ then: 1 } as never])).toThrow(/"when" to be a function/);
  });

  it("rejects a rule without then", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [{ when: () => true } as never])).toThrow(/missing "then"/);
  });

  it("names the offending rule position", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      data.addConditionalColumn("b", [
        { when: () => true, then: 1 },
        { when: "no" as never, then: 2 },
      ]),
    ).toThrow(/rule 1/);
  });

  it("validates rules before evaluating any row", () => {
    let evaluated = false;
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      data.addConditionalColumn("b", [
        {
          when: () => {
            evaluated = true;
            return true;
          },
          then: 1,
        },
        { when: () => true } as never,
      ]),
    ).toThrow(/missing "then"/);
    expect(evaluated).toBe(false);
  });

  it("rejects a non-boolean when result", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [{ when: (() => "yes") as never, then: 1 }])).toThrow(
      /must return a boolean/,
    );
  });

  it("rejects an undefined when result", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [{ when: (() => undefined) as never, then: 1 }])).toThrow(
      /must return a boolean/,
    );
  });

  it("wraps a throwing when with row context and keeps the cause", () => {
    const data = createDataset([{ a: 1 }, { a: 2 }]);
    const boom = new Error("boom");
    try {
      data.addConditionalColumn("b", [
        {
          when: (row) => {
            if (row.a === 2) throw boom;
            return false;
          },
          then: 1,
        },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toMatch(/rule 0 .* threw at row 1: boom/);
      expect((error as ValidationError).cause).toBe(boom);
    }
  });

  it("wraps a throwing then with row context", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      data.addConditionalColumn("b", [
        {
          when: () => true,
          then: () => {
            throw new Error("nope");
          },
        },
      ]),
    ).toThrow(/rule 0 .* threw at row 0: nope/);
  });

  it("wraps a throwing else callback", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      data.addConditionalColumn("b", [{ when: () => false, then: 1 }], {
        else: () => {
          throw new Error("fallback broke");
        },
      }),
    ).toThrow(/failed in "else" for "b" at row 0: fallback broke/);
  });

  it("rejects a non-object options argument", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() => data.addConditionalColumn("b", [{ when: () => true, then: 1 }], [] as never)).toThrow(
      /expects an options object/,
    );
  });

  it("reports a predicate throw before the value is computed", () => {
    const data = createDataset([{ a: 1 }]);
    expect(() =>
      data.addConditionalColumn("b", [
        {
          when: () => {
            throw new Error("predicate");
          },
          then: "x",
        },
      ]),
    ).toThrow(/predicate/);
  });
});

describe("addConditionalColumnReport", () => {
  it("counts matches per rule and unmatched rows", () => {
    const data = createDataset(people());
    const { dataset, report } = data.addConditionalColumnReport("band", ageRules(), { else: "Unknown" });

    expect(report.column).toBe("band");
    expect(report.rowCount).toBe(5);
    expect(report.matched).toEqual([1, 1, 2]);
    expect(report.unmatched).toBe(1);
    expect(dataset.columns).toEqual(["name", "age", "band"]);
  });

  it("shows a rule that never fires", () => {
    const data = createDataset([{ age: 30 }]);
    const { report } = data.addConditionalColumnReport("band", [
      { when: (row) => (row.age as number) < 18, then: "Child" },
      { when: () => true, then: "Adult" },
    ]);
    expect(report.matched).toEqual([0, 1]);
  });

  it("reports zeroes for an empty dataset", () => {
    const data = createDataset([], { columns: ["age"] });
    const { report } = data.addConditionalColumnReport("band", ageRules());
    expect(report.matched).toEqual([0, 0, 0]);
    expect(report.unmatched).toBe(0);
    expect(report.rowCount).toBe(0);
  });

  it("returns the same rows as addConditionalColumn", () => {
    const data = createDataset(people());
    const direct = data.addConditionalColumn("band", ageRules(), { else: "Unknown" });
    const { dataset } = data.addConditionalColumnReport("band", ageRules(), { else: "Unknown" });
    expect(dataset.data).toEqual(direct.data);
  });

  it("freezes the report so a caller cannot corrupt it", () => {
    const data = createDataset([{ a: 1 }]);
    const { report } = data.addConditionalColumnReport("b", [{ when: () => true, then: 1 }]);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.matched)).toBe(true);
  });
});
