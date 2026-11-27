import { describe, expect, it } from "vitest";
import { DataSpace, createDataSpace } from "../../src/core/space.js";
import { createDataset } from "../../src/core/dataset.js";
import { ColumnNotFoundError, ValidationError } from "../../src/errors/index.js";

const customers = () =>
  createDataset(
    [
      { id: 1, name: "Ada", region: "north" },
      { id: 2, name: "Grace", region: "south" },
      { id: 3, name: "Alan", region: "north" },
    ],
    { name: "customers" },
  );

const orders = () =>
  createDataset(
    [
      { order_id: 10, customer_id: 1, total: 100 },
      { order_id: 11, customer_id: 1, total: 50 },
      { order_id: 12, customer_id: 2, total: 200 },
      { order_id: 13, customer_id: 3, total: 25 },
    ],
    { name: "orders" },
  );

const products = () =>
  createDataset(
    [
      { sku: "a", category: "book" },
      { sku: "b", category: "toy" },
    ],
    { name: "products" },
  );

function shopSpace(): DataSpace {
  return createDataSpace("Shop")
    .addDataset("customers", customers())
    .addDataset("orders", orders())
    .addDataset("products", products());
}

/** A shop space with the orders -> customers relationship already declared. */
function linkedShopSpace(): DataSpace {
  const space = shopSpace();
  space.createRelationship({
    from: "orders",
    fromColumn: "customer_id",
    to: "customers",
    toColumn: "id",
    type: "many-to-one",
  });
  return space;
}

describe("DataSpace construction", () => {
  it("requires a non-empty name", () => {
    expect(() => createDataSpace("")).toThrow(ValidationError);
    expect(() => createDataSpace("   ")).toThrow(ValidationError);
  });

  it("exposes its name", () => {
    expect(createDataSpace("Analytics").name).toBe("Analytics");
  });

  it("constructs directly", () => {
    expect(new DataSpace("Direct").name).toBe("Direct");
  });
});

describe("dataset management", () => {
  it("adds datasets and tracks size", () => {
    const space = shopSpace();
    expect(space.size).toBe(3);
    expect(space.datasetNames()).toEqual(["customers", "orders", "products"]);
  });

  it("addDataset returns the space for chaining", () => {
    const space = createDataSpace("s");
    expect(space.addDataset("a", customers())).toBe(space);
  });

  it("rejects a duplicate name instead of overwriting", () => {
    const space = shopSpace();
    expect(() => space.addDataset("orders", orders())).toThrow(/already exists/);
  });

  it("rejects a non-Dataset value", () => {
    const space = createDataSpace("s");
    expect(() => space.addDataset("a", {} as never)).toThrow(ValidationError);
  });

  it("rejects an empty name", () => {
    const space = createDataSpace("s");
    expect(() => space.addDataset("", customers())).toThrow(ValidationError);
  });

  it("retrieves a dataset by name", () => {
    const space = shopSpace();
    expect(space.dataset("customers").rowCount).toBe(3);
    expect(space.has("orders")).toBe(true);
    expect(space.has("nope")).toBe(false);
  });

  it("names the known datasets when one is missing", () => {
    const space = shopSpace();
    expect(() => space.dataset("nope")).toThrow(/Known datasets: customers, orders, products/);
  });

  it("reports no datasets when the space is empty", () => {
    expect(() => createDataSpace("empty").dataset("x")).toThrow(/\(none\)/);
  });

  it("removes a dataset", () => {
    const space = shopSpace().removeDataset("products");
    expect(space.datasetNames()).toEqual(["customers", "orders"]);
    expect(space.size).toBe(2);
  });

  it("removing an absent dataset throws", () => {
    expect(() => shopSpace().removeDataset("nope")).toThrow(ValidationError);
  });

  it("replaces a dataset in place", () => {
    const space = shopSpace();
    const smaller = createDataset([{ id: 1, name: "Ada", region: "north" }]);
    space.replaceDataset("customers", smaller);
    expect(space.dataset("customers").rowCount).toBe(1);
  });

  it("replaceDataset rejects an unknown name", () => {
    expect(() => shopSpace().replaceDataset("nope", customers())).toThrow(/No dataset named/);
  });

  it("renames a dataset", () => {
    const space = shopSpace().renameDataset("products", "items");
    expect(space.datasetNames()).toContain("items");
    expect(space.has("products")).toBe(false);
  });

  it("rename carries relationships with the dataset", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    space.renameDataset("customers", "clients");
    const [relationship] = space.relationships();
    expect(relationship?.to).toBe("clients");
    expect(() => space.join("orders", "clients")).not.toThrow();
  });

  it("rename onto an existing name throws", () => {
    expect(() => shopSpace().renameDataset("orders", "customers")).toThrow(/already exists/);
  });

  it("stores metadata on a dataset", () => {
    const space = shopSpace().setMetadata("orders", "owner", "sales");
    expect(space.dataset("orders").metadata.owner).toBe("sales");
  });

  it("merges metadata rather than replacing it", () => {
    const space = createDataSpace("s")
      .addDataset("a", createDataset([{ x: 1 }], { metadata: { keep: true } }))
      .setMetadata("a", "added", 2);
    expect(space.dataset("a").metadata).toEqual({ keep: true, added: 2 });
  });

  it("leaves the source dataset unchanged when metadata is set", () => {
    const original = customers();
    createDataSpace("s").addDataset("c", original).setMetadata("c", "k", "v");
    expect(original.metadata).toEqual({});
  });
});

describe("relationships", () => {
  it("declares a relationship and returns it", () => {
    const space = shopSpace();
    const relationship = space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    expect(relationship.name).toBe("orders.customer_id->customers.id");
    expect(space.relationshipCount).toBe(1);
  });

  it("accepts a custom name", () => {
    const space = shopSpace();
    space.createRelationship({
      name: "order-customer",
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    expect(space.relationship("order-customer")).toEqual(space.relationships()[0]);
    expect(space.relationship("missing")).toBeUndefined();
  });

  it("rejects an unknown dataset", () => {
    expect(() =>
      shopSpace().createRelationship({
        from: "nope",
        fromColumn: "x",
        to: "customers",
        toColumn: "id",
        type: "many-to-one",
      }),
    ).toThrow(/No dataset named "nope"/);
  });

  it("rejects an unknown column", () => {
    expect(() =>
      shopSpace().createRelationship({
        from: "orders",
        fromColumn: "nope",
        to: "customers",
        toColumn: "id",
        type: "many-to-one",
      }),
    ).toThrow(ColumnNotFoundError);
  });

  it("rejects an unknown type", () => {
    expect(() =>
      shopSpace().createRelationship({
        from: "orders",
        fromColumn: "customer_id",
        to: "customers",
        toColumn: "id",
        type: "sideways" as never,
      }),
    ).toThrow(/type must be one of/);
  });

  it("rejects a duplicate relationship name", () => {
    const space = shopSpace();
    const options = {
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    } as const;
    space.createRelationship(options);
    expect(() => space.createRelationship(options)).toThrow(/already exists/);
  });

  it("rejects many-to-one when the target key is not unique", () => {
    const space = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }, { id: 1 }]))
      .addDataset("child", createDataset([{ pid: 1 }]));
    expect(() =>
      space.createRelationship({
        from: "child",
        fromColumn: "pid",
        to: "parent",
        toColumn: "id",
        type: "many-to-one",
      }),
    ).toThrow(/needs "parent"\."id" to be unique/);
  });

  it("rejects one-to-one when the source key is not unique", () => {
    const space = createDataSpace("s")
      .addDataset(
        "a",
        createDataset([
          { id: 1, b_id: 9 },
          { id: 2, b_id: 9 },
        ]),
      )
      .addDataset("b", createDataset([{ id: 9 }]));
    expect(() =>
      space.createRelationship({
        from: "a",
        fromColumn: "b_id",
        to: "b",
        toColumn: "id",
        type: "one-to-one",
      }),
    ).toThrow(/needs "a"\."b_id" to be unique/);
  });

  it("allows many-to-many without either side unique", () => {
    const space = createDataSpace("s")
      .addDataset("a", createDataset([{ k: 1 }, { k: 1 }]))
      .addDataset("b", createDataset([{ k: 1 }, { k: 1 }]));
    expect(() =>
      space.createRelationship({ from: "a", fromColumn: "k", to: "b", toColumn: "k", type: "many-to-many" }),
    ).not.toThrow();
  });

  it("removes a relationship", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    space.removeRelationship("orders.customer_id->customers.id");
    expect(space.relationshipCount).toBe(0);
  });

  it("removing an absent relationship throws", () => {
    expect(() => shopSpace().removeRelationship("nope")).toThrow(ValidationError);
  });

  it("drops relationships when a dataset is removed", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    space.removeDataset("customers");
    expect(space.relationshipCount).toBe(0);
  });

  it("re-validates relationships when a dataset is replaced", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const missingColumn = createDataset([{ key: 1 }]);
    expect(() => space.replaceDataset("customers", missingColumn)).toThrow(ColumnNotFoundError);
  });
});

describe("relationship lookup", () => {
  const space = () => linkedShopSpace();

  it("finds a forward relationship", () => {
    const found = space().findRelationship("orders", "customers");
    expect(found?.direction).toBe("forward");
    expect(found?.relationship.fromColumn).toBe("customer_id");
  });

  it("finds a reverse relationship", () => {
    const found = space().findRelationship("customers", "orders");
    expect(found?.direction).toBe("reverse");
  });

  it("returns undefined when nothing links the pair", () => {
    expect(space().findRelationship("orders", "products")).toBeUndefined();
  });

  it("throws when several relationships link the pair", () => {
    const ambiguous = space();
    ambiguous.createRelationship({
      name: "second",
      from: "orders",
      fromColumn: "order_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    expect(ambiguous.relationship("second")?.name).toBe("second");
    expect(() => ambiguous.findRelationship("orders", "customers")).toThrow(/pass \{ relationship \}/);
  });

  it("rejects a named relationship that does not link the requested pair", () => {
    const s = space();
    // `regions` carries `customer_id`, and so does `orders`, so reusing this relationship
    // for orders -> customers would resolve both key columns and join on them happily.
    s.addDataset("regions", createDataset([{ customer_id: 1, label: "north" }]));
    s.createRelationship({
      name: "customers-regions",
      from: "customers",
      fromColumn: "id",
      to: "regions",
      toColumn: "customer_id",
      type: "one-to-many",
    });
    expect(() => s.findRelationship("orders", "customers", "customers-regions")).toThrow(
      /links "customers" and "regions", not "orders" and "customers"/,
    );
    expect(() => s.join("orders", "customers", { relationship: "customers-regions" })).toThrow(
      /not "orders" and "customers"/,
    );
  });

  it("still selects a named relationship that does link the pair", () => {
    const s = space();
    s.createRelationship({
      name: "second",
      from: "orders",
      fromColumn: "order_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    expect(s.findRelationship("orders", "customers", "second")?.relationship.name).toBe("second");
  });
});

describe("check()", () => {
  it("reports a clean relationship as valid", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const [check] = space.check();
    expect(check?.valid).toBe(true);
    expect(check?.orphans).toEqual([]);
    expect(check?.duplicates).toEqual([]);
    expect(check?.nullKeys).toBe(0);
  });

  it("reports orphan references with their row index", () => {
    const space = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }]))
      .addDataset("child", createDataset([{ pid: 1 }, { pid: 99 }]));
    space.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    const [check] = space.check();
    expect(check?.valid).toBe(false);
    expect(check?.orphans).toHaveLength(1);
    expect(check?.orphans[0]).toMatchObject({ value: 99, rowIndex: 1, from: "child", to: "parent" });
  });

  it("counts missing keys separately from orphans", () => {
    const space = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }]))
      .addDataset("child", createDataset([{ pid: 1 }, { pid: null }, { pid: null }]));
    space.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    const [check] = space.check();
    expect(check?.nullKeys).toBe(2);
    expect(check?.orphans).toEqual([]);
    expect(check?.valid).toBe(true);
  });

  it("checks a single relationship by name", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    expect(space.check("orders.customer_id->customers.id")).toHaveLength(1);
  });

  it("check on an unknown name throws", () => {
    expect(() => shopSpace().check("nope")).toThrow(/No relationship named/);
  });
});

describe("cross-dataset joins", () => {
  const space = () => linkedShopSpace();

  it("joins using the relationship keys", () => {
    const joined = space().join("orders", "customers");
    expect(joined.rowCount).toBe(4);
    expect(joined.columns).toContain("region");
    expect(joined.columns).toContain("total");
  });

  it("defaults to an inner join", () => {
    const space2 = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }]))
      .addDataset("child", createDataset([{ pid: 1 }, { pid: 99 }]));
    space2.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    expect(space2.join("child", "parent").rowCount).toBe(1);
  });

  it("honours the join type", () => {
    const space2 = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }, { id: 2 }]))
      .addDataset("child", createDataset([{ pid: 1 }]));
    space2.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    expect(space2.join("child", "parent", { how: "left" }).rowCount).toBe(1);
    expect(space2.join("child", "parent", { how: "right" }).rowCount).toBe(2);
    expect(space2.join("child", "parent", { how: "full" }).rowCount).toBe(2);
  });

  it("joins in reverse direction with the keys swapped", () => {
    const joined = space().join("customers", "orders", { how: "left" });
    expect(joined.rowCount).toBe(4);
    expect(joined.columns).toContain("total");
  });

  it("throws when no relationship links the pair", () => {
    expect(() => space().join("orders", "products")).toThrow(/No relationship links/);
  });

  it("passes suffixes through", () => {
    const space2 = createDataSpace("s")
      .addDataset("a", createDataset([{ id: 1, label: "x" }]))
      .addDataset("b", createDataset([{ id: 1, label: "y" }]));
    space2.createRelationship({ from: "a", fromColumn: "id", to: "b", toColumn: "id", type: "one-to-one" });
    const joined = space2.join("a", "b", { suffixes: ["_l", "_r"] });
    expect(joined.columns).toContain("label_l");
    expect(joined.columns).toContain("label_r");
  });
});

describe("cross-dataset aggregation", () => {
  it("aggregates orders by a column on customers", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const result = space.aggregate(
      "orders",
      "customers",
      { revenue: { column: "total", op: "sum" } },
      { groupBy: "region" },
    );
    const byRegion = new Map(result.data.map((row) => [row.region, row.revenue]));
    expect(byRegion.get("north")).toBe(175);
    expect(byRegion.get("south")).toBe(200);
  });

  it("accepts explicit grouping columns", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const result = space.aggregate("orders", "customers", { n: { op: "count" } }, { groupBy: "region" });
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(["region", "n"]);
  });

  it("uses a left join so unmatched rows survive with null keys", () => {
    const space = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }]))
      .addDataset(
        "child",
        createDataset([
          { pid: 1, v: 10 },
          { pid: 99, v: 5 },
        ]),
      );
    space.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    const result = space.aggregate("child", "parent", { total: { column: "v", op: "sum" } }, { groupBy: "id" });
    const total = result.data.reduce((sum, row) => sum + Number(row.total), 0);
    expect(total).toBe(15);
  });
});

describe("cross-dataset filtering", () => {
  it("keeps rows whose related record matches", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const north = space.filterRelated("orders", "customers", (row) => row.region === "north");
    expect(north.rowCount).toBe(3);
  });

  it("drops rows whose reference does not resolve", () => {
    const space = createDataSpace("s")
      .addDataset("parent", createDataset([{ id: 1 }]))
      .addDataset(
        "child",
        createDataset([
          { pid: 1, v: 1 },
          { pid: 99, v: 2 },
        ]),
      );
    space.createRelationship({ from: "child", fromColumn: "pid", to: "parent", toColumn: "id", type: "many-to-many" });
    expect(space.filterRelated("child", "parent", () => true).rowCount).toBe(1);
  });
});

describe("introspection", () => {
  it("describes one dataset including its relationships", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    const ordersSummary = space.describeDataset("orders");
    expect(ordersSummary.rowCount).toBe(4);
    expect(ordersSummary.columnCount).toBe(3);
    expect(ordersSummary.columns).toEqual(["order_id", "customer_id", "total"]);
    expect(ordersSummary.outgoing).toEqual(["orders.customer_id->customers.id"]);
    expect(ordersSummary.incoming).toEqual([]);

    const customersSummary = space.describeDataset("customers");
    expect(customersSummary.incoming).toEqual(["orders.customer_id->customers.id"]);
    expect(customersSummary.outgoing).toEqual([]);
  });

  it("describes every dataset in insertion order", () => {
    const described = shopSpace().describe();
    expect(described.map((entry) => entry.name)).toEqual(["customers", "orders", "products"]);
  });

  it("describing an absent dataset throws", () => {
    expect(() => shopSpace().describeDataset("nope")).toThrow(/No dataset named/);
  });
});

describe("space invariants", () => {
  it("holds datasets by reference, not by copy", () => {
    const source = customers();
    const space = createDataSpace("s").addDataset("c", source);
    expect(space.dataset("c")).toBe(source);
  });

  it("keeps independent datasets usable on their own", () => {
    const space = shopSpace();
    const ordersDataset = space.dataset("orders");
    expect(ordersDataset.filter((row) => Number(row.total) > 60).rowCount).toBe(2);
  });

  it("leaves datasets untouched after a cross-dataset join", () => {
    const space = shopSpace();
    space.createRelationship({
      from: "orders",
      fromColumn: "customer_id",
      to: "customers",
      toColumn: "id",
      type: "many-to-one",
    });
    space.join("orders", "customers");
    expect(space.dataset("orders").rowCount).toBe(4);
    expect(space.dataset("customers").rowCount).toBe(3);
  });
});
