import { describe, expect, it } from "vitest";
import { Dataset, createDataset } from "../../src/core/dataset.js";
import { ValidationError, ColumnNotFoundError } from "../../src/errors/index.js";

const rows = [
  { id: 1, region: "North", revenue: 500, name: "Widget", active: true, ordered_on: "2024-01-05" },
  { id: 2, region: "West", revenue: 150, name: "Gadget", active: false, ordered_on: "2024-02-10" },
  { id: 3, region: "North", revenue: 50, name: "widget pro", active: true, ordered_on: "2024-03-01" },
  { id: 4, region: null, revenue: 900, name: "Thing", active: null, ordered_on: null },
  { id: 5, region: "East", revenue: null, name: null, active: true, ordered_on: "2024-04-15" },
];

const data = () => createDataset(rows);
const ids = (dataset: Dataset): unknown[] => dataset.data.map((row) => row.id);

describe("query: lifecycle", () => {
  it("returns every row when no condition is given", () => {
    expect(ids(data().query().execute())).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a Dataset instance", () => {
    expect(data().query().execute()).toBeInstanceOf(Dataset);
  });

  it("does not modify the source dataset", () => {
    const source = data();
    const before = source.data;
    source.query().where("revenue", ">", 100).execute();
    expect(source.data).toEqual(before);
    expect(source.rowCount).toBe(5);
  });

  it("does not modify the query when a branch is built from it", () => {
    const base = data().query().where("region", "in", ["North", "West"]);
    expect(ids(base.execute())).toEqual([1, 2, 3]);

    const narrowed = base.and("revenue", ">", 100);
    expect(ids(narrowed.execute())).toEqual([1, 2]);

    // The receiver is untouched, so it can be reused as a starting point.
    expect(ids(base.execute())).toEqual([1, 2, 3]);
  });

  it("can be executed repeatedly with identical results", () => {
    const query = data().query().where("revenue", ">", 100).orderBy("revenue", "desc");
    expect(ids(query.execute())).toEqual(ids(query.execute()));
  });

  it("supports independent branches from one base", () => {
    const base = data().query().where("region", "=", "North");
    const big = base.and("revenue", ">", 100);
    const small = base.and("revenue", "<", 100);
    expect(ids(big.execute())).toEqual([1]);
    expect(ids(small.execute())).toEqual([3]);
    expect(ids(base.execute())).toEqual([1, 3]);
  });

  it("derives a dataset with no import report", () => {
    expect(data().query().where("revenue", ">", 100).execute().importReport).toBeNull();
  });
});

describe("query: comparison operators", () => {
  it("supports =", () => {
    expect(ids(data().query().where("region", "=", "North").execute())).toEqual([1, 3]);
  });

  it("supports != and excludes missing cells, as SQL does", () => {
    // id 4 has a missing region: `!= "North"` is unknown for it, not true.
    expect(ids(data().query().where("region", "!=", "North").execute())).toEqual([2, 5]);
  });

  it("supports >", () => {
    expect(ids(data().query().where("revenue", ">", 100).execute())).toEqual([1, 2, 4]);
  });

  it("supports >=", () => {
    expect(ids(data().query().where("revenue", ">=", 150).execute())).toEqual([1, 2, 4]);
  });

  it("supports <", () => {
    expect(ids(data().query().where("revenue", "<", 150).execute())).toEqual([3]);
  });

  it("supports <=", () => {
    expect(ids(data().query().where("revenue", "<=", 150).execute())).toEqual([2, 3]);
  });

  it("includes boundaries for >= and <=", () => {
    expect(ids(data().query().where("revenue", ">=", 500).execute())).toEqual([1, 4]);
    expect(ids(data().query().where("revenue", "<=", 500).execute())).toEqual([1, 2, 3]);
  });

  it("excludes boundaries for > and <", () => {
    expect(ids(data().query().where("revenue", ">", 500).execute())).toEqual([4]);
    expect(ids(data().query().where("revenue", "<", 500).execute())).toEqual([2, 3]);
  });

  it("compares booleans", () => {
    expect(ids(data().query().where("active", "=", true).execute())).toEqual([1, 3, 5]);
    expect(ids(data().query().where("active", "=", false).execute())).toEqual([2]);
  });

  it("never matches a missing cell against any comparison", () => {
    for (const operator of ["=", "!=", ">", ">=", "<", "<="] as const) {
      const result = data().query().where("revenue", operator, 500).execute();
      expect(ids(result)).not.toContain(5);
    }
  });
});

describe("query: set operators", () => {
  it("supports in", () => {
    expect(ids(data().query().where("region", "in", ["North", "West"]).execute())).toEqual([1, 2, 3]);
  });

  it("supports notIn and excludes missing cells", () => {
    expect(ids(data().query().where("region", "notIn", ["North"]).execute())).toEqual([2, 5]);
  });

  it("notIn with an empty-ish complement still excludes missing cells", () => {
    expect(ids(data().query().where("region", "notIn", ["North", "West", "East"]).execute())).toEqual([]);
  });

  it("rejects a non-array for in", () => {
    expect(() =>
      data()
        .query()
        .where("region", "in", "North" as never),
    ).toThrow(ValidationError);
  });

  it("rejects an empty array for in", () => {
    expect(() =>
      data()
        .query()
        .where("region", "in", [] as never),
    ).toThrow(/empty array/);
  });

  it("rejects an empty array for notIn", () => {
    expect(() =>
      data()
        .query()
        .where("region", "notIn", [] as never),
    ).toThrow(/empty array/);
  });

  it("rejects a missing value in a set, which could never match", () => {
    expect(() =>
      data()
        .query()
        .where("region", "in", [null] as never),
    ).toThrow(/can never match/);
    expect(() =>
      data()
        .query()
        .where("region", "notIn", ["North", null] as never),
    ).toThrow(/can never match/);
  });

  it("accepts a readonly array", () => {
    const regions = ["North", "West"] as const;
    expect(ids(data().query().where("region", "in", regions).execute())).toEqual([1, 2, 3]);
  });
});

describe("query: between", () => {
  it("is inclusive at both bounds", () => {
    expect(ids(data().query().where("revenue", "between", [50, 500]).execute())).toEqual([1, 2, 3]);
  });

  it("matches a single value when both bounds are equal", () => {
    expect(ids(data().query().where("revenue", "between", [150, 150]).execute())).toEqual([2]);
  });

  it("excludes missing cells", () => {
    expect(ids(data().query().where("revenue", "between", [0, 1000]).execute())).toEqual([1, 2, 3, 4]);
  });

  it("rejects a pair of the wrong length", () => {
    expect(() =>
      data()
        .query()
        .where("revenue", "between", [1] as never),
    ).toThrow(/low, high/);
    expect(() =>
      data()
        .query()
        .where("revenue", "between", [1, 2, 3] as never),
    ).toThrow(/low, high/);
  });

  it("rejects inverted bounds instead of silently returning nothing", () => {
    expect(() => data().query().where("revenue", "between", [500, 100])).toThrow(/low bound above its high bound/);
  });

  it("rejects a missing bound", () => {
    expect(() =>
      data()
        .query()
        .where("revenue", "between", [null, 100] as never),
    ).toThrow(/missing bound/);
  });

  it("rejects bounds of different types", () => {
    expect(() =>
      data()
        .query()
        .where("revenue", "between", [1, "100"] as never),
    ).toThrow(/same type/);
  });
});

describe("query: string operators", () => {
  it("supports contains", () => {
    expect(ids(data().query().where("name", "contains", "idget").execute())).toEqual([1, 3]);
  });

  it("is case-sensitive by default", () => {
    expect(ids(data().query().where("name", "contains", "widget").execute())).toEqual([3]);
  });

  it("honours ignoreCase", () => {
    expect(ids(data().query().where("name", "contains", "widget", { ignoreCase: true }).execute())).toEqual([1, 3]);
  });

  it("supports startsWith", () => {
    expect(ids(data().query().where("name", "startsWith", "W").execute())).toEqual([1]);
  });

  it("supports startsWith with ignoreCase", () => {
    expect(ids(data().query().where("name", "startsWith", "w", { ignoreCase: true }).execute())).toEqual([1, 3]);
  });

  it("supports endsWith", () => {
    expect(ids(data().query().where("name", "endsWith", "et").execute())).toEqual([1, 2]);
  });

  it("supports endsWith with ignoreCase", () => {
    expect(ids(data().query().where("name", "endsWith", "ET", { ignoreCase: true }).execute())).toEqual([1, 2]);
  });

  it("never matches a non-string cell", () => {
    expect(ids(data().query().where("name", "contains", "").execute())).toEqual([1, 2, 3, 4]);
  });

  it("rejects a non-string operand", () => {
    expect(() =>
      data()
        .query()
        .where("name", "contains", 5 as never),
    ).toThrow(/expects a string/);
  });
});

describe("query: null operators", () => {
  it("supports isNull", () => {
    expect(ids(data().query().where("region", "isNull").execute())).toEqual([4]);
  });

  it("supports isNotNull", () => {
    expect(ids(data().query().where("region", "isNotNull").execute())).toEqual([1, 2, 3, 5]);
  });

  it("treats undefined as missing, like null", () => {
    const sparse = createDataset([
      { a: 1, b: null },
      { a: 2, b: undefined },
      { a: 3, b: 0 },
    ]);
    expect(
      sparse
        .query()
        .where("b", "isNull")
        .execute()
        .data.map((row) => row.a),
    ).toEqual([1, 2]);
  });

  it("rejects a value passed to isNull", () => {
    expect(() =>
      data()
        .query()
        .where("region", "isNull", 1 as never),
    ).toThrow(/takes no value/);
  });

  it("combines isNull with a negation to include missing rows", () => {
    expect(ids(data().query().where("region", "!=", "North").or("region", "isNull").execute())).toEqual([2, 4, 5]);
  });
});

describe("query: precedence and grouping", () => {
  it("binds AND tighter than OR", () => {
    // region = North OR (revenue > 800 AND id = 2) -> only North rows survive the second run.
    const query = data().query().where("region", "=", "North").or("revenue", ">", 800).and("id", "=", 2);
    expect(ids(query.execute())).toEqual([1, 3]);
  });

  it("renders precedence so it can be reviewed", () => {
    const query = data().query().where("region", "=", "North").or("revenue", ">", 800).and("id", "=", 2);
    expect(query.toString()).toBe("(region = North OR (revenue > 800 AND id = 2))");
  });

  it("supports andGroup for an explicit AND over OR", () => {
    const query = data()
      .query()
      .where("region", "=", "North")
      .andGroup((group) => group.where("revenue", ">", 100).or("id", "=", 3));
    expect(ids(query.execute())).toEqual([1, 3]);
    expect(query.toString()).toBe("(region = North AND (revenue > 100 OR id = 3))");
  });

  it("supports orGroup for an explicit OR over AND", () => {
    const query = data()
      .query()
      .where("id", "=", 2)
      .orGroup((group) => group.where("region", "=", "North").and("revenue", ">", 100));
    expect(ids(query.execute())).toEqual([1, 2]);
  });

  it("nests groups", () => {
    const query = data()
      .query()
      .where("active", "=", true)
      .andGroup((outer) => outer.where("region", "=", "North").orGroup((inner) => inner.where("revenue", "<", 100)));
    expect(ids(query.execute())).toEqual([1, 3]);
  });

  it("supports several or branches", () => {
    const query = data().query().where("id", "=", 1).or("id", "=", 3).or("id", "=", 5);
    expect(ids(query.execute())).toEqual([1, 3, 5]);
  });

  it("rejects an empty group", () => {
    expect(() =>
      data()
        .query()
        .andGroup((group) => group),
    ).toThrow(/at least one condition/);
  });

  it("rejects a group builder that is not a function", () => {
    expect(() =>
      data()
        .query()
        .andGroup(5 as never),
    ).toThrow(/builder function/);
  });

  it("rejects a group builder returning a non-Query", () => {
    expect(() =>
      data()
        .query()
        .andGroup(() => data() as never),
    ).toThrow(/must return a Query/);
  });

  it("validates columns inside a group", () => {
    expect(() =>
      data()
        .query()
        .andGroup((group) => group.where("nope", "=", 1)),
    ).toThrow(ColumnNotFoundError);
  });

  it("reports no conditions when the query is empty", () => {
    expect(data().query().toString()).toBe("(no conditions)");
  });
});

describe("query: ordering", () => {
  it("orders ascending by default", () => {
    expect(ids(data().query().orderBy("revenue").execute())).toEqual([3, 2, 1, 4, 5]);
  });

  it("orders descending", () => {
    expect(ids(data().query().orderBy("revenue", "desc").execute())).toEqual([4, 1, 2, 3, 5]);
  });

  it("sorts missing values last in both directions", () => {
    expect(ids(data().query().orderBy("revenue", "asc").execute()).at(-1)).toBe(5);
    expect(ids(data().query().orderBy("revenue", "desc").execute()).at(-1)).toBe(5);
  });

  it("keeps ties in their original order", () => {
    const tied = createDataset([
      { id: 1, score: 10 },
      { id: 2, score: 10 },
      { id: 3, score: 5 },
    ]);
    expect(
      tied
        .query()
        .orderBy("score", "desc")
        .execute()
        .data.map((row) => row.id),
    ).toEqual([1, 2, 3]);
  });

  it("supports multiple sort keys", () => {
    const result = data().query().orderBy("region", "asc").orderBy("revenue", "desc").execute();
    // East, North (500 then 50), West, then the missing region last.
    expect(result.data.map((row) => row.id)).toEqual([5, 1, 3, 2, 4]);
  });

  it("agrees with Dataset.sort on the same column", () => {
    const viaQuery = data()
      .query()
      .orderBy("revenue", "asc")
      .execute()
      .data.map((row) => row.id);
    const viaSort = data()
      .sort("revenue", "asc")
      .data.map((row) => row.id);
    expect(viaQuery).toEqual(viaSort);
  });

  it("rejects an invalid direction", () => {
    expect(() =>
      data()
        .query()
        .orderBy("revenue", "up" as never),
    ).toThrow(/direction/);
  });

  it("rejects an unknown column", () => {
    expect(() => data().query().orderBy("nope")).toThrow(ColumnNotFoundError);
  });
});

describe("query: select and limit", () => {
  it("projects the requested columns in order", () => {
    const result = data().query().select(["name", "id"]).execute();
    expect(result.columns).toEqual(["name", "id"]);
    expect(Object.keys(result.data[0] ?? {})).toEqual(["name", "id"]);
  });

  it("limits rows", () => {
    expect(ids(data().query().limit(2).execute())).toEqual([1, 2]);
  });

  it("applies the limit after ordering", () => {
    expect(ids(data().query().orderBy("revenue", "desc").limit(2).execute())).toEqual([4, 1]);
  });

  it("applies the limit after filtering", () => {
    expect(ids(data().query().where("region", "=", "North").limit(1).execute())).toEqual([1]);
  });

  it("accepts a zero limit", () => {
    expect(data().query().limit(0).execute().rowCount).toBe(0);
  });

  it("rejects a negative or fractional limit", () => {
    expect(() => data().query().limit(-1)).toThrow(ValidationError);
    expect(() => data().query().limit(1.5)).toThrow(ValidationError);
  });

  it("rejects an empty selection", () => {
    expect(() => data().query().select([])).toThrow(/non-empty/);
  });

  it("rejects duplicate columns in a selection", () => {
    expect(() => data().query().select(["id", "id"])).toThrow(/duplicate/);
  });

  it("rejects an unknown column in a selection", () => {
    expect(() => data().query().select(["nope"])).toThrow(ColumnNotFoundError);
  });
});

describe("query: errors", () => {
  it("rejects an unknown column in where", () => {
    expect(() => data().query().where("nope", "=", 1)).toThrow(ColumnNotFoundError);
  });

  it("names the available columns in the error", () => {
    expect(() => data().query().where("nope", "=", 1)).toThrow(/region/);
  });

  it("rejects an unknown operator", () => {
    expect(() =>
      data()
        .query()
        .where("id", "~" as never, 1),
    ).toThrow(/Unknown query operator/);
  });

  it("rejects a missing value with a relational operator", () => {
    expect(() =>
      data()
        .query()
        .where("revenue", ">", null as never),
    ).toThrow(/isNull/);
  });

  it("rejects a non-boolean ignoreCase", () => {
    expect(() =>
      data()
        .query()
        .where("name", "=", "x", { ignoreCase: "yes" as never }),
    ).toThrow(/boolean/);
  });

  it("rejects a numeric column compared against a string", () => {
    expect(() =>
      data()
        .query()
        .where("revenue", ">", "100" as never),
    ).toThrow(/Pass a number/);
  });

  it("rejects a string column compared against a number", () => {
    expect(() =>
      data()
        .query()
        .where("region", "=", 1 as never),
    ).toThrow(/Pass a string/);
  });

  it("rejects a boolean column compared against a number", () => {
    expect(() =>
      data()
        .query()
        .where("active", "=", 1 as never),
    ).toThrow(/Pass true or false/);
  });

  it("rejects an empty column name", () => {
    expect(() => data().query().where("", "=", 1)).toThrow(/non-empty column name/);
  });
});

describe("query: mixed and untyped columns", () => {
  it("compares a mixed column against values of any type", () => {
    const mixed = createDataset([{ a: 1 }, { a: "x" }, { a: true }]);
    expect(mixed.dtypes.a).toBe("mixed");
    expect(mixed.query().where("a", "=", "x").execute().rowCount).toBe(1);
    expect(mixed.query().where("a", "=", 1).execute().rowCount).toBe(1);
  });

  it("skips incomparable pairs instead of throwing mid-scan", () => {
    const mixed = createDataset([{ a: 1 }, { a: "x" }, { a: 5 }]);
    // Only the numeric cells can satisfy `> 2`.
    expect(mixed.query().where("a", ">", 2).execute().rowCount).toBe(1);
  });

  it('does not equate 1 with "1"', () => {
    // `createDataset` normalizes the numeric string "1" to the number 1, so build the
    // mixed column from text that stays text.
    const mixed = createDataset([{ a: 1 }, { a: "one" }]);
    expect(mixed.dtypes.a).toBe("mixed");
    expect(mixed.query().where("a", "=", 1).execute().rowCount).toBe(1);
    expect(mixed.query().where("a", "=", "one").execute().rowCount).toBe(1);
    expect(mixed.query().where("a", "=", "1").execute().rowCount).toBe(0);
  });
});

describe("query: date columns", () => {
  const iso = () => createDataset([{ d: "2024-01-05" }, { d: "2024-03-01" }, { d: null }]);
  const cast = () => iso().cast({ d: "date" });

  it("compares ISO-string date columns against ISO strings", () => {
    expect(iso().query().where("d", ">", "2024-02-01").execute().rowCount).toBe(1);
  });

  it("compares Date-backed columns against ISO strings", () => {
    expect(cast().query().where("d", ">", "2024-02-01").execute().rowCount).toBe(1);
  });

  it("compares Date-backed columns against Date objects", () => {
    expect(cast().query().where("d", ">", new Date("2024-02-01")).execute().rowCount).toBe(1);
  });

  it("supports between on Date-backed columns with ISO bounds", () => {
    expect(cast().query().where("d", "between", ["2024-01-01", "2024-02-01"]).execute().rowCount).toBe(1);
  });

  it("supports between on ISO columns", () => {
    expect(iso().query().where("d", "between", ["2024-01-01", "2024-02-01"]).execute().rowCount).toBe(1);
  });

  it("rejects a non-ISO string against a Date-backed column instead of matching nothing", () => {
    expect(() => cast().query().where("d", ">", "next tuesday")).toThrow(/not an ISO date/);
  });

  it("keeps missing dates out of comparisons", () => {
    expect(cast().query().where("d", "isNull").execute().rowCount).toBe(1);
  });
});

describe("query: empty datasets", () => {
  it("executes against an empty dataset", () => {
    const empty = createDataset([], { columns: ["a", "b"] });
    expect(empty.query().where("a", "=", 1).execute().rowCount).toBe(0);
    expect(empty.query().execute().columns).toEqual(["a", "b"]);
  });

  it("returns an empty result when nothing matches", () => {
    const result = data().query().where("revenue", ">", 1_000_000).execute();
    expect(result.rowCount).toBe(0);
    expect(result.columns).toEqual(data().columns);
  });

  it("preserves columns when every row is filtered out", () => {
    const result = data().query().where("region", "=", "Nowhere").execute();
    expect(result.columns).toEqual(["id", "region", "revenue", "name", "active", "ordered_on"]);
  });
});

describe("query: composition with the rest of the API", () => {
  it("chains into Dataset methods", () => {
    const result = data()
      .query()
      .where("revenue", ">", 100)
      .execute()
      .sort("revenue", "desc")
      .select(["id", "revenue"]);
    expect(result.data.map((row) => row.id)).toEqual([4, 1, 2]);
  });

  it("runs against a prepared dataset", () => {
    const result = data().fillMissing({ revenue: 0 }).query().where("revenue", "=", 0).execute();
    expect(result.data.map((row) => row.id)).toEqual([5]);
  });
});
