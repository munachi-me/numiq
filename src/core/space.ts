/**
 * Data spaces: a named collection of datasets plus the relationships between them.
 *
 * A `Dataset` answers questions about one table. Real analysis usually spans several —
 * orders reference customers, line items reference products — and the joins that link them
 * are written out by hand at every call site. A `DataSpace` records those links once and
 * reuses them, so `space.join("orders", "customers")` needs no key names repeated.
 *
 * Relationships are declared, not inferred. Guessing that `customer_id` points at
 * `customers.id` would be right often enough to feel magical and wrong often enough to be
 * dangerous, so every link is explicit and validated when it is created.
 */
import { ColumnNotFoundError, ValidationError } from "../errors/index.js";
import { Dataset, createDataset } from "./dataset.js";
import type { AggregateSpec } from "./aggregate.js";
import type { JoinHow, JoinOptions } from "./join.js";
import type { Row } from "./types.js";

/**
 * Cardinality of a relationship, written from the `from` side to the `to` side.
 *
 * `"many-to-one"` means many rows in `from` share one row in `to` — the ordinary
 * foreign-key shape, orders to customers. `"one-to-many"` is its mirror. `"one-to-one"`
 * requires both sides to be unique; `"many-to-many"` requires neither.
 */
export type RelationshipType = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

/** A declared link between two datasets in a space. */
export interface Relationship {
  /** Short name, unique within the space. */
  readonly name: string;
  /** Dataset holding the referencing column. */
  readonly from: string;
  /** Column in `from` used as the key. */
  readonly fromColumn: string;
  /** Dataset being referenced. */
  readonly to: string;
  /** Column in `to` used as the key. */
  readonly toColumn: string;
  /** Cardinality from `from` to `to`. */
  readonly type: RelationshipType;
}

/** Options for `DataSpace.createRelationship()`. */
export interface RelationshipOptions {
  /** Name for the relationship. Defaults to `${from}.${fromColumn}->${to}.${toColumn}`. */
  readonly name?: string;
  readonly from: string;
  readonly fromColumn: string;
  readonly to: string;
  readonly toColumn: string;
  readonly type: RelationshipType;
}

/** A row in `from` whose key has no match in `to`. */
export interface OrphanReference {
  readonly from: string;
  readonly fromColumn: string;
  readonly to: string;
  readonly toColumn: string;
  /** Key value that could not be resolved. */
  readonly value: unknown;
  /** Zero-based row index in `from`. */
  readonly rowIndex: number;
}

/** A duplicate key found where the relationship requires uniqueness. */
export interface DuplicateKey {
  readonly dataset: string;
  readonly column: string;
  readonly value: unknown;
  /** How many rows carry the value. */
  readonly count: number;
}

/** Result of checking one relationship against the current data. */
export interface RelationshipCheck {
  readonly relationship: Relationship;
  /** Rows in `from` whose key matched nothing in `to`. */
  readonly orphans: readonly OrphanReference[];
  /** Duplicate keys that violate the declared cardinality. */
  readonly duplicates: readonly DuplicateKey[];
  /** Rows in `from` skipped because their key was missing. */
  readonly nullKeys: number;
  /** True when there are no orphans and no duplicates. */
  readonly valid: boolean;
}

/** Summary of one dataset held in a space. */
export interface DatasetSummary {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly columns: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Relationships where this dataset is the `from` side. */
  readonly outgoing: readonly string[];
  /** Relationships where this dataset is the `to` side. */
  readonly incoming: readonly string[];
}

/** Options for `DataSpace.join()`. */
export interface SpaceJoinOptions {
  /** How to join. Defaults to `"inner"`. */
  readonly how?: JoinHow;
  /** Relationship name to use when several link the pair. */
  readonly relationship?: string;
  /** Collision suffixes. Defaults to the underlying `join()` defaults. */
  readonly suffixes?: readonly [string, string];
}

/** Options for `DataSpace.aggregate()`. */
export interface SpaceAggregateOptions {
  /**
   * Grouping columns, taken from the joined result.
   *
   * Required rather than defaulted. Any default — every column of the target, or every
   * column but its key — silently changes the shape of the answer, and "revenue by
   * customer region" is only one of many groupings a caller might want.
   */
  readonly groupBy: string | readonly string[];
  /** Relationship name to use when several link the pair. */
  readonly relationship?: string;
}

const RELATIONSHIP_TYPES: readonly RelationshipType[] = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];

/**
 * A named collection of datasets and the relationships between them.
 *
 * Datasets are held by reference, not copied, so a `Dataset` added to a space and the same
 * dataset used directly behave identically. Replacing a dataset re-checks every
 * relationship that touches it: a stale link that silently stopped matching would produce
 * wrong joins rather than an error.
 */
export class DataSpace {
  readonly #name: string;
  readonly #datasets = new Map<string, Dataset>();
  readonly #relationships = new Map<string, Relationship>();

  constructor(name: string) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("DataSpace needs a non-empty name.");
    }
    this.#name = name;
  }

  /** The space's name. */
  get name(): string {
    return this.#name;
  }

  /** Number of datasets held. */
  get size(): number {
    return this.#datasets.size;
  }

  /** Number of declared relationships. */
  get relationshipCount(): number {
    return this.#relationships.size;
  }

  // ---------------------------------------------------------------- datasets

  /**
   * Add a dataset under `name`.
   *
   * Throws when the name is already taken rather than overwriting: a silent replacement
   * would change every relationship and every later query that used the old data.
   */
  addDataset(name: string, dataset: Dataset): this {
    this.#assertName(name);
    if (!(dataset instanceof Dataset)) {
      throw new ValidationError(`addDataset("${name}") needs a Dataset.`);
    }
    if (this.#datasets.has(name)) {
      throw new ValidationError(`A dataset named "${name}" already exists. Use replaceDataset() to swap it.`);
    }
    this.#datasets.set(name, dataset);
    return this;
  }

  /**
   * Swap the dataset stored under an existing name.
   *
   * Every relationship touching the name is re-validated against the new data, because the
   * columns it relied on may no longer exist.
   */
  replaceDataset(name: string, dataset: Dataset): this {
    this.#assertName(name);
    if (!(dataset instanceof Dataset)) {
      throw new ValidationError(`replaceDataset("${name}") needs a Dataset.`);
    }
    if (!this.#datasets.has(name)) {
      throw new ValidationError(`No dataset named "${name}". Use addDataset() to create it.`);
    }
    this.#datasets.set(name, dataset);
    for (const relationship of this.#relationships.values()) {
      if (relationship.from === name || relationship.to === name) this.#assertColumns(relationship);
    }
    return this;
  }

  /**
   * Remove a dataset and every relationship that referenced it.
   *
   * Removing the links too is the only consistent choice: a relationship to a dataset that
   * no longer exists cannot be validated or used, and leaving it would fail at join time
   * instead of here.
   */
  removeDataset(name: string): this {
    this.#require(name);
    this.#datasets.delete(name);
    for (const [key, relationship] of this.#relationships) {
      if (relationship.from === name || relationship.to === name) this.#relationships.delete(key);
    }
    return this;
  }

  /** Whether a dataset is present. */
  has(name: string): boolean {
    return this.#datasets.has(name);
  }

  /** Fetch a dataset, or throw when absent. */
  dataset(name: string): Dataset {
    return this.#require(name);
  }

  /** Names in insertion order. */
  datasetNames(): readonly string[] {
    return [...this.#datasets.keys()];
  }

  /** Datasets in insertion order. */
  datasets(): readonly Dataset[] {
    return [...this.#datasets.values()];
  }

  /** Rename a dataset, carrying its relationships with it. */
  renameDataset(from: string, to: string): this {
    this.#require(from);
    this.#assertName(to);
    if (this.#datasets.has(to)) {
      throw new ValidationError(`A dataset named "${to}" already exists.`);
    }
    const dataset = this.#datasets.get(from) as Dataset;
    this.#datasets.delete(from);
    this.#datasets.set(to, dataset);

    for (const [key, relationship] of this.#relationships) {
      if (relationship.from !== from && relationship.to !== from) continue;
      this.#relationships.set(key, {
        ...relationship,
        from: relationship.from === from ? to : relationship.from,
        to: relationship.to === from ? to : relationship.to,
      });
    }
    return this;
  }

  /** Attach or replace a metadata value on a dataset. */
  setMetadata(name: string, key: string, value: unknown): this {
    const dataset = this.#require(name);
    if (typeof key !== "string" || key.length === 0) {
      throw new ValidationError("setMetadata() needs a non-empty key.");
    }
    const metadata = { ...dataset.metadata, [key]: value };
    this.#datasets.set(name, createDataset(dataset, { metadata }));
    return this;
  }

  // ----------------------------------------------------------- relationships

  /**
   * Declare a relationship and validate it against the current data.
   *
   * Validation is immediate. A relationship pointing at a missing column, or at data that
   * cannot satisfy its cardinality, is rejected here rather than producing a wrong join
   * later. Referential integrity is *reported* by `check()`, not enforced on creation:
   * real data often has orphans, and refusing to model a relationship because of them
   * would stop the analysis before it began.
   */
  createRelationship(options: RelationshipOptions): Relationship {
    const { from, fromColumn, to, toColumn, type } = options;
    for (const value of [from, to, fromColumn, toColumn]) {
      if (typeof value !== "string" || value.length === 0) {
        throw new ValidationError("createRelationship() needs non-empty dataset and column names.");
      }
    }
    if (!RELATIONSHIP_TYPES.includes(type)) {
      throw new ValidationError(
        `createRelationship() type must be one of ${RELATIONSHIP_TYPES.join(", ")}, received "${String(type)}".`,
      );
    }
    const fromDataset = this.#require(from);
    const toDataset = this.#require(to);
    if (!fromDataset.columns.includes(fromColumn)) {
      throw new ColumnNotFoundError(fromColumn, fromDataset.columns);
    }
    if (!toDataset.columns.includes(toColumn)) {
      throw new ColumnNotFoundError(toColumn, toDataset.columns);
    }
    const name = options.name ?? `${from}.${fromColumn}->${to}.${toColumn}`;
    if (this.#relationships.has(name)) {
      throw new ValidationError(`A relationship named "${name}" already exists.`);
    }

    const relationship: Relationship = { name, from, fromColumn, to, toColumn, type };
    this.#assertCardinality(relationship);
    this.#relationships.set(name, relationship);
    return relationship;
  }

  /** Remove a relationship by name. */
  removeRelationship(name: string): this {
    if (!this.#relationships.delete(name)) {
      throw new ValidationError(`No relationship named "${name}".`);
    }
    return this;
  }

  /** Relationships, in creation order. */
  relationships(): readonly Relationship[] {
    return [...this.#relationships.values()];
  }

  /** One relationship by name, or `undefined`. */
  relationship(name: string): Relationship | undefined {
    return this.#relationships.get(name);
  }

  /**
   * Find the relationship linking two datasets, in either direction.
   *
   * `direction` says whether the pair was matched as written (`"forward"`, `from` is the
   * first argument) or reversed (`"reverse"`), so a caller joining `customers` to `orders`
   * knows the key columns are swapped.
   */
  findRelationship(
    left: string,
    right: string,
    name?: string,
  ): { relationship: Relationship; direction: "forward" | "reverse" } | undefined {
    const candidates = this.relationships().filter((relationship) => {
      if (name !== undefined) return relationship.name === name;
      return (
        (relationship.from === left && relationship.to === right) ||
        (relationship.from === right && relationship.to === left)
      );
    });
    if (candidates.length === 0) return undefined;
    if (candidates.length > 1) {
      throw new ValidationError(
        `${candidates.length} relationships link "${left}" and "${right}"; pass { relationship } to choose one.`,
      );
    }
    const relationship = candidates[0] as Relationship;
    return {
      relationship,
      direction: relationship.from === left && relationship.to === right ? "forward" : "reverse",
    };
  }

  /**
   * Check one or every relationship against the current data.
   *
   * Reports orphans (keys in `from` with no match in `to`), duplicates that violate the
   * declared cardinality, and missing keys. Missing keys are counted but never treated as
   * orphans: a null foreign key means "no reference", not "broken reference".
   */
  check(name?: string): readonly RelationshipCheck[] {
    const targets = name === undefined ? this.relationships() : [this.#getRelationship(name)];
    return targets.map((relationship) => this.#checkOne(relationship));
  }

  // ------------------------------------------------------- cross-dataset ops

  /**
   * Join this space's `left` dataset to `right` using a declared relationship.
   *
   * The key columns come from the relationship, so no key names are repeated at the call
   * site. Pass `{ relationship }` when more than one link connects the pair.
   */
  join(left: string, right: string, options: SpaceJoinOptions = {}): Dataset {
    const leftDataset = this.#require(left);
    const rightDataset = this.#require(right);
    const found = this.findRelationship(left, right, options.relationship);
    if (found === undefined) {
      throw new ValidationError(
        `No relationship links "${left}" and "${right}". Create one with createRelationship() or join the datasets directly.`,
      );
    }
    const { relationship, direction } = found;
    const joinOptions: JoinOptions = {
      leftOn: direction === "forward" ? relationship.fromColumn : relationship.toColumn,
      rightOn: direction === "forward" ? relationship.toColumn : relationship.fromColumn,
      how: options.how ?? "inner",
      ...(options.suffixes === undefined ? {} : { suffixes: options.suffixes }),
    };
    return leftDataset.join(rightDataset, joinOptions);
  }

  /**
   * Aggregate `dataset` after attaching columns from `target` through a relationship.
   *
   * This is the "revenue by customer region" shape: group orders by a column that lives on
   * customers. The join happens first, then the ordinary grouping and aggregation run on
   * the joined result, so every operation behaves exactly as it does on a single dataset.
   */
  aggregate(dataset: string, target: string, spec: AggregateSpec, options: SpaceAggregateOptions): Dataset {
    const joined = this.join(dataset, target, {
      how: "left",
      ...(options.relationship === undefined ? {} : { relationship: options.relationship }),
    });
    const columns = typeof options.groupBy === "string" ? [options.groupBy] : [...options.groupBy];
    return joined.groupBy(columns).aggregate(spec);
  }

  /**
   * Filter `dataset` by a predicate over its related row in `target`.
   *
   * Rows whose reference does not resolve are dropped: the predicate cannot be evaluated
   * against a row that does not exist, and treating a missing reference as "keep" would
   * silently include unrelated data.
   */
  filterRelated(
    dataset: string,
    target: string,
    predicate: (related: Row) => boolean,
    options: SpaceJoinOptions = {},
  ): Dataset {
    const joined = this.join(dataset, target, {
      how: "inner",
      ...(options.relationship === undefined ? {} : { relationship: options.relationship }),
    });
    return joined.filter((row) => predicate(row));
  }

  // ------------------------------------------------------------ introspection

  /** Structure of one dataset, including the relationships it participates in. */
  describeDataset(name: string): DatasetSummary {
    const dataset = this.#require(name);
    const outgoing: string[] = [];
    const incoming: string[] = [];
    for (const relationship of this.relationships()) {
      if (relationship.from === name) outgoing.push(relationship.name);
      if (relationship.to === name) incoming.push(relationship.name);
    }
    return {
      name,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      columns: [...dataset.columns],
      metadata: dataset.metadata,
      outgoing,
      incoming,
    };
  }

  /** Structure of every dataset, in insertion order. */
  describe(): readonly DatasetSummary[] {
    return this.datasetNames().map((name) => this.describeDataset(name));
  }

  // ---------------------------------------------------------------- internals

  #assertName(name: string): void {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("Dataset names must be non-empty strings.");
    }
  }

  #require(name: string): Dataset {
    const dataset = this.#datasets.get(name);
    if (dataset === undefined) {
      const known = this.datasetNames();
      throw new ValidationError(
        `No dataset named "${name}" in data space "${this.#name}". Known datasets: ${
          known.length === 0 ? "(none)" : known.join(", ")
        }.`,
      );
    }
    return dataset;
  }

  #getRelationship(name: string): Relationship {
    const relationship = this.#relationships.get(name);
    if (relationship === undefined) throw new ValidationError(`No relationship named "${name}".`);
    return relationship;
  }

  #assertColumns(relationship: Relationship): void {
    const fromDataset = this.#datasets.get(relationship.from);
    const toDataset = this.#datasets.get(relationship.to);
    if (fromDataset === undefined || toDataset === undefined) return;
    if (!fromDataset.columns.includes(relationship.fromColumn)) {
      throw new ColumnNotFoundError(relationship.fromColumn, fromDataset.columns);
    }
    if (!toDataset.columns.includes(relationship.toColumn)) {
      throw new ColumnNotFoundError(relationship.toColumn, toDataset.columns);
    }
  }

  /**
   * Reject a relationship whose declared cardinality the data cannot satisfy.
   *
   * Only the uniqueness side is checkable up front. Whether every foreign key resolves is
   * a data-quality question that `check()` reports, because orphans are common and are a
   * finding rather than a modelling error.
   */
  #assertCardinality(relationship: Relationship): void {
    const requiresUniqueTarget = relationship.type === "one-to-one" || relationship.type === "many-to-one";
    const requiresUniqueSource = relationship.type === "one-to-one" || relationship.type === "one-to-many";
    if (requiresUniqueTarget) this.#assertUnique(relationship.to, relationship.toColumn, relationship.name);
    if (requiresUniqueSource) this.#assertUnique(relationship.from, relationship.fromColumn, relationship.name);
  }

  #assertUnique(datasetName: string, column: string, relationshipName: string): void {
    const duplicates = this.#duplicates(datasetName, column);
    if (duplicates.length === 0) return;
    const first = duplicates[0] as DuplicateKey;
    throw new ValidationError(
      `Relationship "${relationshipName}" needs "${datasetName}"."${column}" to be unique, ` +
        `but ${String(first.value)} appears ${first.count} times (${duplicates.length} duplicated value(s)).`,
    );
  }

  #duplicates(datasetName: string, column: string): DuplicateKey[] {
    const dataset = this.#datasets.get(datasetName);
    if (dataset === undefined) return [];
    const counts = new Map<unknown, number>();
    for (const row of dataset.data) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const duplicates: DuplicateKey[] = [];
    for (const [value, count] of counts) {
      if (count > 1) duplicates.push({ dataset: datasetName, column, value, count });
    }
    return duplicates;
  }

  #checkOne(relationship: Relationship): RelationshipCheck {
    const fromDataset = this.#require(relationship.from);
    const toDataset = this.#require(relationship.to);
    const keys = new Set<unknown>();
    for (const row of toDataset.data) {
      const value = row[relationship.toColumn];
      if (value !== null && value !== undefined) keys.add(value);
    }

    const orphans: OrphanReference[] = [];
    let nullKeys = 0;
    const rows = fromDataset.data;
    for (let index = 0; index < rows.length; index += 1) {
      const value = (rows[index] as Row)[relationship.fromColumn];
      if (value === null || value === undefined) {
        nullKeys += 1;
        continue;
      }
      if (!keys.has(value)) {
        orphans.push({
          from: relationship.from,
          fromColumn: relationship.fromColumn,
          to: relationship.to,
          toColumn: relationship.toColumn,
          value,
          rowIndex: index,
        });
      }
    }

    const duplicates: DuplicateKey[] = [];
    const requiresUniqueTarget = relationship.type === "one-to-one" || relationship.type === "many-to-one";
    const requiresUniqueSource = relationship.type === "one-to-one" || relationship.type === "one-to-many";
    if (requiresUniqueTarget) duplicates.push(...this.#duplicates(relationship.to, relationship.toColumn));
    if (requiresUniqueSource) duplicates.push(...this.#duplicates(relationship.from, relationship.fromColumn));

    return {
      relationship,
      orphans,
      duplicates,
      nullKeys,
      valid: orphans.length === 0 && duplicates.length === 0,
    };
  }
}

/** Create a data space. Shorthand for `new DataSpace(name)`. */
export function createDataSpace(name: string): DataSpace {
  return new DataSpace(name);
}
