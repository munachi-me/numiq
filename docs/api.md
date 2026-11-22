# API reference

All members are available as named exports and on the default export.

```ts
import Numiq, { createDataset, loadCSV } from "numiq";
// Numiq.createDataset === createDataset
```

## Functions

### `createDataset(input, options?)`

Synchronous. Builds a dataset from records, column-oriented data, or an existing dataset.

```ts
createDataset([{ a: 1 }, { a: 2 }]);
createDataset({ a: [1, 2], b: ["x", "y"] });
createDataset(existingDataset);
```

`input` is `readonly Row[] | Record<string, readonly unknown[]> | Dataset`.

`options` (`DatasetOptions`):

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `columns` | `readonly string[]` | inferred | Column order |
| `name` | `string` | `"Dataset"` | Dataset name |
| `metadata` | `Record<string, unknown>` | `{}` | Arbitrary metadata, frozen |
| `normalization` | `Partial<NormalizationPolicy>` | defaults | Cell policy for raw input |

Rows are normalized with the same policy the loaders use, so `createDataset([{ a: "42" }])`
holds the number `42`.

Throws `ValidationError` for non-object rows, duplicate or blank column names, and
parallel arrays of unequal length.

### `parseDelimited(text, options)`

Synchronous. Parses CSV or TSV text. Requires `options.format` (`"csv"` or `"tsv"`).

### `parseJSON(input, options?)`

Synchronous. Accepts JSON text or an already-parsed value.

### `loadCSV(source, options?)` / `loadTSV(...)` / `loadJSON(...)`

Asynchronous. Each resolves a source and parses it with the matching parser. A loader
rejects a source that declares a different format: `loadCSV("users.json")` throws
`FormatError` rather than parsing JSON.

`source` is `string | URL | Blob | ArrayBuffer | Uint8Array`. A string is treated as an
http(s) URL when it starts with `http://` or `https://`, and as a local filename
otherwise. Local filenames require the Node entry point.

A local filename is resolved against `<datasetDir>/dataset`, where `datasetDir` defaults
to `process.cwd()`. Only a bare filename is accepted: absolute paths, `..`, path
separators, and symlinks that resolve outside the folder are rejected.

### `useSampleDataset()`

Asynchronous. Resolves to a bundled 50-row, 7-column sales dataset, so it works without
a `dataset/` folder and is identical on every call. Content is embedded in the package,
which keeps it available in ESM, CommonJS, and browser builds. `shape` is `[50, 7]`.

```ts
const sample = await useSampleDataset();
```

`LoadOptions.datasetDir` overrides the project root used for local filenames.

### `loadURL(url, options?)`

Asynchronous. Fetches an http(s) URL and detects the format from `options.format`, then
the URL extension, then the `content-type` header. Throws `FormatError` when none
identifies a supported format.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `format` | `"csv" \| "tsv" \| "json"` | detected | Overrides detection |
| `headers` | `Record<string, string>` | — | Request headers |
| `timeoutMs` | `number` | `30000` | Abort after this long |
| `signal` | `AbortSignal` | — | External cancellation |

Non-2xx responses throw `ImportError` with `status` set.

### `detectDelimiter(text)` / `tokenize(text, delimiter)`

Low-level text helpers. `tokenize` returns raw string cells; it does not normalize.

### `normalizeCell(value, policy)` / `resolveNormalization(partial?)`

Cell-level normalization, exposed for advanced use. `normalizeCell` returns
`{ value, issue? }`, where `issue` is `"unsafe-integer"` when a value was kept as a string
to preserve precision.

### `renderTable(rows, columns, options?)`

Renders records without constructing a `Dataset`.

## `Dataset`

Constructed with `createDataset`; the constructor is public but `createDataset` is the
supported entry.

### Properties

| Member | Type |
| --- | --- |
| `columns` | `readonly string[]` |
| `data` | `readonly Row[]` |
| `shape` | `readonly [number, number]` |
| `rowCount` | `number` |
| `columnCount` | `number` |
| `length` | `number` |
| `empty` | `boolean` |
| `name` | `string` |
| `metadata` | `Readonly<Record<string, unknown>>` |
| `dtypes` | `Readonly<Record<string, DType>>` |
| `schema` | `Readonly<Record<string, ColumnSchema>>` |
| `importReport` | `ImportReport \| null` |

`data` returns a deep copy on every access. `schema` is computed once and cached.

### Methods

#### `table(options?)` / `toTable(options?)`

Returns a rendered table string. See `TableOptions`.

#### `display(options?)`

Prints `table()` via `console.log` and returns the dataset for chaining.

#### `head(count = 5)` / `tail(count = 5)`

Return a new dataset with the first or last `count` rows. Throws `ValidationError` for a
negative or fractional count. Derived datasets report `importReport === null`.

#### `filter(predicate)`

Returns a new dataset of rows where `predicate(row, index)` is true, in original order.
Rows are frozen, so a predicate that writes to its argument throws a `TypeError`.

#### `sort(column, direction = "asc")`

Returns a new dataset sorted by `column`. `direction` is `"asc"` or `"desc"`; anything
else throws `ValidationError`. Ordering is total and deterministic: missing values sort
last in both directions, numbers and dates compare numerically, other values compare as
text, and equal values keep their original order. Throws `ColumnNotFoundError` for an
unknown column.

#### `select(columns)`

Returns a new dataset with only the named columns, in the requested order. Throws
`ColumnNotFoundError` for an unknown column and `ValidationError` for an empty or
duplicated list.

#### `limit(count)`

Returns a new dataset with at most `count` rows from the start. Throws
`ValidationError` for a negative or fractional count.

All four transformations return a `Dataset`, so they chain, and all report
`importReport === null`.

#### Preparation methods

The preparation methods return a new `Dataset`, chain with the transformations above, and
never modify the source. All of them report `importReport === null`.

#### `drop(columns)`

Removes columns. Accepts a name or an array of names; the remaining columns keep their
original order. Throws `ColumnNotFoundError` for an unknown column and `ValidationError`
when the call would remove every column.

```ts
data.drop(["internal_note", "audit_flag"]);
```

#### `rename(mapping)`

Renames columns in place. Each column keeps its position and values. Throws
`ColumnNotFoundError` for an unknown source column and `ValidationError` when the mapping
produces a duplicate or blank name. Swapping two names is allowed.

```ts
data.rename({ qty: "quantity", unit_price: "price" });
```

#### `dropMissing(options?)`

Drops rows with missing cells. `null` and `undefined` both count as missing.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `columns` | `string[]` | every column | Columns to consider |
| `how` | `"any" \| "all"` | `"any"` | `any` drops a row when one considered cell is missing; `all` only when every considered cell is |

```ts
data.dropMissing({ columns: ["price"], how: "all" });
```

#### `fillMissing(strategyOrMapping)`

Fills missing cells. Pass one strategy for every column, or a mapping to narrow it.

| Strategy | Behaviour |
| --- | --- |
| `"mean"` | Arithmetic mean of present values. Numeric columns only. |
| `"median"` | Median of present values. Numeric columns only. |
| `"mode"` | Most frequent present value; ties resolve to the earliest value. |
| constant | `string`, `number`, `boolean`, `Date`, or `null`. |
| callback | `(row, index) => value`. |

```ts
data.fillMissing({ quantity: 0, price: "mean" });
```

`"mean"` and `"median"` throw `ValidationError` on a non-numeric column rather than
parsing text. A column with no present values is left untouched: there is nothing to
compute from, and inventing a value would be worse than leaving the gap.

#### `replace(rules)`

Replaces values per column. Each column takes a rule or a list of rules applied in order.

| Rule | Matches |
| --- | --- |
| `{ from, to }` | Cells equal to `from`. `from` may be an array. |
| `{ match, to }` | Cells where `match(value, context)` is true. |
| `(value, context) => value` | Every cell; the return value is used. |

```ts
data.replace({
  region: { from: ["N", "S"], to: "Unknown" },
  revenue: { match: (value) => Number(value) < 0, to: 0 },
  note: (value) => (value === null ? "none" : value),
});
```

Comparison is by value and type, so `1` does not match `"1"`; `null` and `undefined` are
treated as the same missing value. A rule with both `from` and `match`, or with neither,
throws `ValidationError`.

#### `map(column, callback)`

Transforms one column with `callback(value, row, index)`. Other columns keep their values,
and `row` is the record as it was before the transformation.

```ts
data.map("price", (value) => Number(value) * 1.2);
```

#### `addColumn(name, callbackOrValues)`

Appends a column last. `spec` is `(row, index) => value` or an array of values, one per
row. Throws `ValidationError` when the name already exists, when the array length does not
match the row count, or when the name is blank.

```ts
data.addColumn("total", (row) => Number(row.quantity) * Number(row.price));
```

#### `addConditionalColumn(name, rules, options?)`

Appends a column filled from ordered rules. The first rule whose `when` returns `true`
supplies the value, so later rules only see rows earlier rules did not claim. This is the
declarative counterpart to `addColumn`: the branching lives in data, so the decision table
can be logged, tested, and reviewed instead of being buried in a nested ternary.

```ts
const result = data.addConditionalColumn(
  "category",
  [
    { when: (row) => Number(row.age) < 18, then: "Child" },
    { when: (row) => Number(row.age) < 65, then: "Adult" },
    { when: (row) => Number(row.age) >= 65, then: "Elder" },
  ],
  { else: "Unknown" },
);
```

`then` and `else` each accept a static value or a callback. `then` callbacks receive
`(row, index, context)`; `else` callbacks receive `(row, index)`. The value is cloned per
row, so a shared object or `Date` is never aliased across rows.

`else` defaults to `null`, the library's representation of a missing cell.

Throws `ValidationError` when the name is blank or already exists, when `rules` is not a
non-empty array, when a rule is missing `when` or `then`, when a `when` returns a
non-boolean, or when a callback throws. A throw names the rule position and row, and keeps
the original error as `cause`.

Rules are validated before any row is evaluated, so a malformed list fails immediately
rather than after partially processing the data.

##### Missing values in predicates

The library evaluates predicates verbatim and does not rewrite them. A `null` cell is
passed through as `null`, and `null < 18` is `true` in JavaScript, so a predicate written
against a nullable column must test for missing first:

```ts
{ when: (row) => row.age !== null && Number(row.age) < 18, then: "Child" }
```

##### `addConditionalColumnReport(name, rules, options?)`

Returns `{ dataset, report }`. `report` carries `column`, `rowCount`, `matched` (one count
per rule, in order), and `unmatched`. The report is the point: a rule that never fires is
usually a predicate mistake, and counting matches makes that visible without inspecting the
output column.

```ts
const { dataset, report } = data.addConditionalColumnReport("band", rules, { else: "Unknown" });
report.matched;   // e.g. [21, 14]
report.unmatched; // e.g. 15
```

##### Standalone `addConditionalColumn(rows, columns, name, rules, options?)`

Works on raw rows and returns `{ rows, columns, report }`, so the same rules can be
applied without building a `Dataset`.

#### `join(other, options)`

Joins another dataset onto this one and returns a new `Dataset`; both sources are
untouched. Keys are matched by value and type, so `1` never matches `"1"`.

```ts
const result = orders.join(customers, { on: "customer_id", how: "left" });
```

| Option | Meaning |
| --- | --- |
| `on` | Key column name, or several for a composite key |
| `leftOn` / `rightOn` | Key names when the two sides differ; must be the same length |
| `how` | `"inner"` (default), `"left"`, `"right"`, or `"full"` |
| `suffixes` | Pair applied to both sides on a non-key collision; default `["_left", "_right"]` |
| `nullsMatch` | Whether two missing keys count as equal; default `false` |
| `maxRows` | Guard against an accidental Cartesian product; default 1,000,000 |

Behaviour worth knowing:

- **A missing key matches nothing by default.** `null` means "unknown", so an unknown key
  cannot be known to match another unknown key. Set `nullsMatch: true` to join null to null.
- **A right key column is dropped when it duplicates its left partner**, because the values
  are equal by definition. When the left side is absent (right and full joins) the key is
  sourced from the right row, so the key column is never null in the output.
- **Only colliding non-key columns are suffixed**, on both sides, so neither side silently
  wins. The collision list is reported.
- **A many-to-many join multiplies rows.** `maxRows` turns a runaway product into an error
  naming the cause rather than a million-row result.
- **Row order is deterministic**: left rows in order, then unmatched right rows for `full`.

Throws `ColumnNotFoundError` for an unknown key, and `ValidationError` for an unknown
`how`, a mismatched key mapping, identical suffixes, or an exceeded `maxRows`.

##### `joinReport(other, options)`

Returns `{ dataset, report }` with `how`, `leftKeys`, `rightKeys`, `rowCount`, `matched`,
`leftUnmatched`, `rightUnmatched`, and `collisions`.

#### `pivot(options)`

Turns long data into one column per distinct value of `options.columns`.

```ts
sales.pivot({ columns: "quarter", values: "revenue" });
```

| Option | Meaning |
| --- | --- |
| `columns` | Column whose distinct values become new column names |
| `values` | Column holding the cell values |
| `aggregate` | `"first"` (default), `"last"`, `"sum"`, `"mean"`, `"min"`, `"max"`, `"count"` |
| `index` | Row-identity columns; defaults to every column not named by `columns` or `values` |

Generated columns appear in first-appearance order, not sorted, so a pivot is reproducible
without assuming anything about the value types. A combination with no row becomes `null`.
Rows whose pivot key is missing are dropped: a missing key has no column name to become,
and collecting them under a `"null"` column would invent a category. When several rows share
a cell, `aggregate` decides how they combine and the collapse count is reported.

Throws `ColumnNotFoundError` for an unknown column, and `ValidationError` when `columns` and
`values` name the same column, when `aggregate` is unknown, or when a generated column name
collides with an index column.

##### `pivotReport(options)`

Returns `{ dataset, pivoted, collapsed }`, where `pivoted` lists the generated column names
and `collapsed` counts input rows that shared a cell.

#### `melt(options?)`

Unpivots wide data into variable/value pairs. Round trips with `pivot()`.

```ts
wide.melt({ idVars: "region" });  // { region, variable, value }
```

| Option | Meaning |
| --- | --- |
| `idVars` | Columns kept as-is |
| `valueVars` | Columns to unpivot; defaults to every column not in `idVars` |
| `variableName` | Name for the former column names; default `"variable"` |
| `valueName` | Name for the former cell values; default `"value"` |
| `dropMissing` | Drop rows whose value is missing instead of emitting `null` |

At least one of `idVars` or `valueVars` is required. Throws `ColumnNotFoundError` for an
unknown column, and `ValidationError` when a column is both an id and a value, when there
is nothing to unpivot, or when the generated names collide.

#### `concat(others, options?)`

Stacks rows, keeping this dataset's rows first. `others` is a `Dataset` or an array.

```ts
data.head(10).concat(data.tail(10));
data.concat([a, b], { columns: "strict" });
```

With the default `"union"` policy the result takes the union of column names in
first-appearance order and fills gaps with `null`. `"strict"` rejects any difference in
column sets, which catches a schema drift a union would hide.

#### `cast(schema)`

Converts columns to explicit types, using the same type names, aliases, and
`{ type, format }` descriptors as the loader `schema` option. A cell that cannot be
converted throws `ValidationError` naming the row and column; nothing is coerced silently.

```ts
data.cast({ quantity: "number", ordered_on: "date" });
```

#### `dropDuplicates(columns?)`

Keeps the first row of each distinct combination, comparing the whole row when no columns
are given. Comparison is by value and type, and `null`/`undefined` count as one missing
value. Throws `ColumnNotFoundError` for an unknown column.

```ts
data.dropDuplicates(["order_id"]);
```

#### `sample(count, options?)`

Draws `count` rows in draw order.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `seed` | `number` | none | Makes the draw reproducible: same seed and count, same rows, every run |
| `replace` | `boolean` | `false` | Sample with replacement, allowing repeats and counts above the row count |

```ts
data.sample(100, { seed: 42 });
```

Without `replace`, a `count` above the row count throws `ValidationError`. Without a
`seed`, the draw uses `Math.random`.

#### Callback errors

When a callback passed to `fillMissing`, `replace`, `map`, or `addColumn` throws, the
error becomes a `ValidationError` naming the operation, row, and column, with the original
error attached as `cause`:

```
map failed at row 1, column "a": bad
```

#### Query methods

#### `query()`

Starts a structured query and returns a `Query<Dataset>`. Nothing runs until `execute()`.

Conditions are typed values passed to methods, never text, so there is no query language
to parse and no way for data or column names to become executable code.

```ts
const result = data
  .query()
  .where("revenue", ">", 100)
  .and("region", "in", ["North", "West"])
  .orderBy("revenue", "desc")
  .select(["product", "region", "revenue"])
  .limit(20)
  .execute();
```

`execute()` returns a new `Dataset` with `importReport === null`. The source dataset is
never modified.

##### Lifecycle

Every builder method returns a **new** `Query`; the receiver is never changed. A partially
built query is therefore safe to reuse as a starting point:

```ts
const base = data.query().where("region", "in", ["North", "West"]);
const big = base.and("revenue", ">", 1000).execute();
const small = base.and("revenue", "<", 100).execute(); // `base` is unchanged
```

`execute()` may be called any number of times; each call returns a fresh dataset.

##### Operators

| Operator | Value | Meaning |
| --- | --- | --- |
| `=`, `!=` | any present value | Equality, compared by value **and** type |
| `>`, `>=`, `<`, `<=` | number, string, boolean, or date | Ordered comparison |
| `in`, `notIn` | non-empty array | Membership |
| `between` | `[low, high]` | Inclusive on both bounds |
| `contains`, `startsWith`, `endsWith` | string | Substring tests on text cells |
| `isNull`, `isNotNull` | none | Missing-value tests |

`where` and `and` are the same operation, so the first condition in a chain may be written
with either. `or` starts a new alternative.

##### Precedence

`and` binds tighter than `or`, so this reads as `a OR (b AND c)`:

```ts
data.query().where("a", "=", 1).or("b", "=", 2).and("c", "=", 3);
```

Use `andGroup` / `orGroup` to parenthesise explicitly:

```ts
// a AND (b OR c)
data.query().where("a", "=", 1).andGroup((g) => g.where("b", "=", 2).or("c", "=", 3));
```

`toString()` renders the compiled conditions with their grouping, which is useful when a
query does not match what you expected:

```ts
data.query().where("a", "=", 1).or("b", "=", 2).and("c", "=", 3).toString();
// "(a = 1 OR (b = 2 AND c = 3))"
```

##### Missing values

`null` and `undefined` both mean missing. A missing cell never satisfies a comparison,
including `!=` and `notIn`, matching SQL's three-valued logic:

```ts
// Rows where region is missing are excluded by the first query and kept by the second.
data.query().where("region", "!=", "North").execute();
data.query().where("region", "!=", "North").or("region", "isNull").execute();
```

##### Type checking

Conditions are checked against the column's type before any row is scanned. Comparing a
numeric column against a string raises `ValidationError` rather than silently returning
no rows, because that is almost always a typo:

```ts
data.query().where("revenue", ">", "100"); // ValidationError: pass a number
```

Columns typed `mixed` or `unknown` are exempt, since their contents genuinely vary. When
two cell types cannot be compared, the row simply does not match; the scan never throws
part-way through.

`between` also rejects inverted bounds, missing bounds, and bounds of different types,
because each of those could only ever match nothing.

##### Ordering

`orderBy(column, direction = "asc")` may be called repeatedly; keys apply in the order
given. Missing values sort last in both directions, ties keep their original order, and
the rules are identical to `Dataset.sort`, so the two never disagree.

##### Selecting and limiting

`select(columns)` projects the named columns in the requested order. `limit(count)` keeps
at most `count` rows **after** filtering and ordering.

#### `execute()`

Runs the query and returns a `Dataset`. Validating conditions happens while the query is
being built, so an invalid query throws at the point of the mistake rather than at
execution.

#### `info()`

Returns `DatasetInfo`: `name`, `rowCount`, `columnCount`, `shape`, `dtypes`,
`missingValues`, and `memoryHint` (a rough byte estimate).

#### `column(name)`

Returns `ColumnView`: `name`, `type`, `values` (a copy), `missing`, `unique`.
Throws `ColumnNotFoundError` when the column does not exist.

#### `distinct(name)` / `unique(name)`

Distinct present values in first-seen order, and their count. `null` is excluded.

#### `toJSON()`

Returns `{ name, columns, shape, rows, metadata }`, so `JSON.stringify(dataset)` works.

#### Grouping methods

#### `groupBy(...columns)`

Returns a `GroupedDataset`: a description of how to split rows. Nothing is computed until
`aggregate()` runs. Accepts one or more column names, or a single array of them.

```ts
data.groupBy("region").aggregate({
  totalRevenue: { column: "revenue", op: "sum" },
  orderCount: { op: "count" },
});
```

Groups appear in **first-appearance order** of their key, so output is deterministic and
independent of hashing. Rows keep their source order inside each group, which is what makes
`first` and `last` meaningful.

Rows whose key is missing form their own group with a `null` key rather than being dropped.
Silently discarding them makes totals that do not add up; drop the group explicitly when it
is not wanted:

```ts
summary.query().where("region", "isNotNull").execute()
```

`groupBy` throws `ValidationError` for no columns, an empty name, or the same column twice,
and `ColumnNotFoundError` for a column that does not exist.

`GroupedDataset` exposes `columns`, `groupCount`, `rowCount`, `sizes`, and `keys` without
computing any aggregation.

#### `aggregate(spec)`

Computes one output column per entry and returns a normal `Dataset`, so the result composes
with queries, sorting, and preparation. Columns are the grouping columns followed by the
spec's keys, in the order given.

| Operation | Numeric only | Needs a column | Result for no present values |
| --- | --- | --- | --- |
| `count` | no | no — counts rows | `0` |
| `sum` | yes | yes | `0` |
| `mean` | yes | yes | `null` |
| `median` | yes | yes | `null` |
| `min` | no | yes | `null` |
| `max` | no | yes | `null` |
| `first` | no | yes | `null` |
| `last` | no | yes | `null` |
| `nunique` | no | yes | `0` |
| `std` | yes | yes | `null` |
| `variance` | yes | yes | `null` |

`count` without a column counts rows in the group; with a column it counts present cells.

`min`, `max`, `first`, `last`, `count`, and `nunique` work on text, booleans, and dates as
well as numbers. `min` and `max` order dates chronologically and booleans `false` before
`true`. The numeric-only operations throw `ValidationError` when the column's type is not
numeric; `mixed` and `unknown` columns are allowed through, since they cannot be judged
ahead of time.

Missing cells inside a group are excluded from every aggregation, so `mean` of
`[1, null, 3]` is `2`, not `1.33`.

`std` and `variance` default to the **sample** formula, dividing by `n - 1`. Pass
`ddof: 0` for the population formula. A group with a single row has no sample spread and
reports `null`; with `ddof: 0` it reports `0`.

`aggregate` validates the whole spec before computing anything, so a mistake in the last
entry does not produce a partial result. Output names must not collide with grouping
columns.

#### Custom aggregators

Two forms. A bare function receives the group's rows; bind `column` to receive only that
column's present values.

```ts
data.groupBy("region").aggregate({
  firstProduct: (rows) => rows[0]?.product,
  spread: { column: "revenue", fn: (values) => Math.max(...values) - Math.min(...values) },
});
```

Both receive frozen copies, so a callback cannot corrupt the source dataset. The second
argument is an `AggregationContext` with `column` (the bound column, or `null`) and `rows`.

#### `toDataset()` / `mapGroups(fn)`

`toDataset()` returns the grouped rows with the grouping columns first, ordered by group.
`mapGroups(fn)` applies a function to each group and concatenates the results; the returned
rows may have any shape, and the result's columns are the union of their keys in
first-appearance order.

## Window functions

Window methods compute a value per row from its neighbours. Each returns a new `Dataset`
with the computed column appended; the input row order and every input column are kept.
Naming a column that already exists throws `ValidationError`.

Every window method requires `orderBy`. Without an explicit order a window value would
depend on whatever order the dataset happened to be in, so the order is always stated:

```ts
data.cumSum("running", "units", { partitionBy: "store", orderBy: "at" });
data.rank("r", { orderBy: { column: "units", direction: "desc" } });
```

`orderBy` is a column name, a `{ column, direction }` object, or an array of either.
Composite keys are compared left to right. Missing values sort last in both directions,
matching `sort()`, and ties keep their input order.

`partitionBy` is a column name or an array of names. A window never reads across a
partition boundary, and partitions are compared with `stableKey`, so `1` and `"1"` are
different partitions.

### Ranking

#### `rowNumber(name, options)`

1-based position within the partition. Every row gets a distinct number, so ties in the
ordering are broken by input order.

#### `rank(name, options)` / `denseRank(name, options)`

Tied rows share a rank. `rank` leaves a gap after a tie (`1, 2, 2, 4`); `denseRank` does
not (`1, 2, 2, 3`). Ties are judged on every ordering key.

#### `rankRows(options)`

Returns `RankedRow[]` — `{ index, rank }` for each row in ranked order — for callers who
want the ordering itself rather than a column. `index` is the row's original zero-based
position.

### Offsets

#### `lag(name, column, options)` / `lead(name, column, options)`

Value of `column` from the row `offset` positions earlier (`lag`) or later (`lead`). Rows
with no counterpart take `fill`, which defaults to `null`.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `offset` | `number` | `1` | Rows to step; must be a non-negative integer |
| `fill` | `unknown` | `null` | Value where no such row exists |
| `partitionBy` | `string \| string[]` | none | Partition columns |
| `orderBy` | key or keys | required | Ordering |

### Running values

#### `cumSum(name, column, options)` / `cumMean(name, column, options)`

Running total or running mean of `column` in partition order. A cell that is not a finite
number counts as missing.

With the default `ignoreMissing: false`, the first missing value makes that row and every
later row in the partition `null`: a running total that skipped a value would misstate the
sum. Set `ignoreMissing: true` to skip missing cells and continue the accumulation.

### Moving values

#### `rollingSum(name, column, options)` and the other `rolling*` methods

`rollingSum`, `rollingMean`, `rollingMin`, `rollingMax`, and `rollingStd` compute over a
trailing window that ends at the current row: with `window: 3`, the third row summarises
rows 1–3.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `window` | `number` | required | Rows in the window, at least 1 |
| `minPeriods` | `number` | `window` | Fewest present values needed to emit a number |
| `partitionBy` | `string \| string[]` | none | Partition columns |
| `orderBy` | key or keys | required | Ordering |

A row with fewer than `minPeriods` present values emits `null`. The default
`minPeriods: window` means a short leading window is reported as `null` rather than as an
average of fewer rows than requested. `minPeriods` may not exceed `window`.

`rollingStd` uses the sample divisor `n - 1`, consistent with `std`, so a window holding a
single observation emits `null` rather than `0`.

### `window(name, options)`

The escape hatch for a window the named helpers do not cover.

```ts
data.window("gap", {
  partitionBy: "store",
  orderBy: "at",
  fn: ({ row, rows, rowNumber }) => (rowNumber === 1 ? 0 : Number(row.units) - Number(rows[0]?.units)),
});
```

The callback receives `row`, `rowNumber` (1-based within the partition), `index` (position
in the whole input), `partition` (partition index in first-appearance order), and `rows`
(that partition's rows in order).

### Standalone helpers

`windowColumn(rows, columns, name, options)` and the individual functions
(`rowNumber`, `rank`, `denseRank`, `lag`, `lead`, `cumSum`, `cumMean`, `rollingSum`,
`rollingMean`, `rollingMin`, `rollingMax`, `rollingStd`, `rankRows`) take
`(rows, columns, ...)` first and return a `PreparedTable` of `{ rows, columns }`.

## Time series

All calendar arithmetic is UTC. A `Date` is an instant rather than a calendar date, so
bucketing in local time would move rows between buckets depending on where the code runs.
Zone offsets in an input string are honoured and nothing is silently converted to local
time.

Accepted time values are `Date` instances and ISO strings in the forms
`YYYY-MM-DD` and `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm]`. A value that is present but not
recognised throws `ValidationError`; it never becomes `null`.

### `sortByTime(timeColumn, options?)`

Sorts by a time column, oldest first by default. `direction` may be `"asc"` or `"desc"`.
Missing times sort last in both directions, and equal times keep their input order.

### `extractPeriod(name, timeColumn, interval)`

Appends a column holding each row's calendar bucket label. A missing time yields `null`,
because the row belongs to no bucket and inventing one would place it somewhere the data
does not support.

### `resample(options)`

Groups rows into fixed calendar buckets and aggregates each bucket.

```ts
data.resample({
  every: "day",
  timeColumn: "at",
  aggregate: { units: "sum", orders: "count" },
  label: "period",        // default
  onMissingTime: "drop",  // default; "error" to reject instead
});
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `every` | `TimeInterval` | required | Bucket width |
| `timeColumn` | `string` | required | Column to bucket by |
| `aggregate` | `Record<string, ResampleAggregation>` | required | Output column per source column |
| `label` | `string` | `"period"` | Bucket column name |
| `onMissingTime` | `"drop" \| "error"` | `"drop"` | How to treat a missing time |

The output holds one row per non-empty bucket in ascending time order, with columns
`[label, ...aggregateKeys]`. Empty buckets produce no row: a resample summarises
observations, and a zero row would assert something the input never said.

A present but unparseable time always throws, even when `onMissingTime` is `"drop"`, since
that is a data error rather than an absence.

### `resampleReport(options)`

`resample()` plus `{ bucketed, dropped }` counts.

### `periodBuckets(timeColumn, interval)`

Distinct bucket labels for a column, ascending. Useful for inspecting the shape of a series
before resampling.

### Intervals and labels

| Interval | Bucket starts | Label |
| --- | --- | --- |
| `hour` | start of the UTC hour | `2026-11-16T14:00` |
| `day` | UTC midnight | `2026-11-16` |
| `week` | Monday, UTC midnight | `2026-11-16` |
| `month` | first of the month | `2026-11` |
| `quarter` | first of months 1, 4, 7, 10 | `2026-Q4` |
| `year` | 1 January | `2026` |

Weeks follow ISO-8601 and start on Monday. Day and week labels share a shape because a week
label is the date its bucket begins.

### Standalone helpers

`toTime(value, context)` converts a cell to a `Date` or `null`. `periodStart(date,
interval)` returns the UTC start of the bucket containing a date. `periodLabel(start,
interval)` formats a bucket start as its label. `sortByTime`, `extractPeriod`, `resample`,
and `periodBuckets` also exist as standalone functions taking `(rows, columns, ...)` first.

### Types

```ts
type TimeInterval = "hour" | "day" | "week" | "month" | "quarter" | "year";
type ResampleAggregation = "sum" | "mean" | "median" | "min" | "max" | "count" | "first" | "last";
type WindowDirection = "asc" | "desc";
type WindowOrderKey = string | { column: string; direction?: WindowDirection };
```

### `describe()` / `describe(column, options?)`

Profiles columns. Two overloads with two result shapes:

```ts
data.describe();                              // DatasetDescription
data.describe({ ddof: 0 });                   // DatasetDescription, every column
data.describe("revenue");                     // ColumnProfile
data.describe("revenue", { ddof: 0 });        // ColumnProfile
data.describe("revenue", { percentiles: [90] }); // ColumnProfile
```

`describe()` and `describe(options)` return a `DatasetDescription` with `rowCount`, `columnCount`, `profiles`,
`columns`, `get(column)`, `table(options?)`, `toDataset()`, and `toJSON()`.
`describe(column)` returns the `ColumnProfile` for that column directly.

The description is an analytical result, not a `Dataset`. `toDataset()` is the way to get
tabular output with every statistic; it keeps the source dataset's name and metadata.

`describe(column)` throws `ColumnNotFoundError` for an unknown column and `ValidationError`
for an empty name. Options are validated eagerly: a negative `ddof` or a percentile outside
`[0, 100]` throws `RangeError` rather than silently producing a wrong number.

#### `ColumnProfile`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | column name |
| `type` | `DType` | inferred from present values |
| `kind` | `ColumnKind` | `numeric`, `boolean`, `temporal`, `categorical`, `mixed`, `empty` |
| `count` | `number` | present values |
| `missing` | `number` | `null`/`undefined` values |
| `total` | `number` | `count + missing` |
| `unique` | `number` | distinct present values |
| `sum` | `number \| null` | numeric only |
| `mean` | `number \| null` | numeric only |
| `median` | `number \| null` | numeric only |
| `mode` | `unknown` | any type; ties break by first appearance |
| `min` / `max` | `unknown` | any type, ordered by `Dataset.sort`'s comparator |
| `range` | `number \| null` | numeric only (`max - min`) |
| `variance` | `number \| null` | numeric only; honours `ddof` |
| `std` | `number \| null` | numeric only; square root of `variance` |
| `q1` / `q3` | `number \| null` | numeric only |
| `iqr` | `number \| null` | numeric only (`q3 - q1`) |
| `percentiles` | `Readonly<Record<string, number \| null>>` | keys are `p<value>` |
| `ddof` | `number` | the degrees of freedom actually used |

Statistics that do not apply to a column's type are `null`, never `0`. A sum of categories
has no meaning, and reporting `0` would look like a real measurement. Numeric columns are the
only kind where arithmetic produces a number with a unit.

`variance` and `std` default to the sample formula (`ddof: 1`). Pass `ddof: 0` for the
population formula. Every profile records the `ddof` used, so a result is never ambiguous.
A single value has no sample spread: `variance` and `std` are `null`, while `q1`, `q3`, and
`range` are the value itself and `iqr` is `0`.

#### `DatasetDescription`

`table(options?)` renders a readable subset — `column`, `type`, `count`, `missing`,
`unique`, `sum`, `mean`, `median`, `min`, `max`, `std` — with numbers rounded for display
only. Full precision stays on `profiles`. `toDataset()` carries every statistic.

```ts
data.describe().table();
data.describe().get("revenue").iqr;
data.describe().toDataset().select(["name", "kind", "mean", "q1", "q3"]);
```

### Descriptive statistics helpers

Quantiles, percentiles, and distribution statistics are exported for use outside a dataset.
They operate on arrays of already-present values and return `null` when there is nothing to
measure:

```ts
quantile([1, 2, 3, 4], 0.5);      // 2.5
percentile([2, 4, 4, 4, 5, 5, 7, 9], 90); // 7.6
quartiles([2, 4, 4, 4, 5, 5, 7, 9]); // { q1: 4, q2: 4.5, q3: 5.5 }
iqr([2, 4, 4, 4, 5, 5, 7, 9]);    // 1.5
mode([1, 2, 2, 3]);               // 2
range([1, 5, 3]);                 // 4
extremes([3, 1, 4]);              // { min: 1, max: 4 }
```

Quantiles use linear interpolation between order statistics — the Hyndman–Fan type 7
definition, the same default as `numpy.percentile` and R's `quantile(type = 7)`. The
interpolation is computed as `(n - 1) * p / 100` in one expression, so `percentile(xs, 10)`
reads `3.4` rather than `3.4000000000000004`. `quantile` rejects `q` outside `[0, 1]` and
`percentile` rejects `p` outside `[0, 100]`, both with `RangeError`.

`mode` and `extremes` work on any comparable value: text, booleans, and dates included.
`range` is numeric only, because a spread of dates or text has no single unit.

## Advanced statistics

### Dataset methods

| Method | Returns |
| --- | --- |
| `covariance(left, right, options?)` | `number \| null` |
| `correlation(left, right)` | `CorrelationResult` |
| `rankCorrelation(left, right)` | `CorrelationResult` |
| `correlationMatrix(columns?, method?)` | `CorrelationMatrix` |
| `zScores(column, options?)` | `ZScoreResult` |
| `percentileRank(column, value)` | `number \| null` |
| `skewness(column)` | `number \| null` |
| `kurtosis(column)` | `number \| null` |
| `fiveNumberSummary(column)` | `FiveNumberSummary` |
| `outliers(column, options?)` | `OutlierResult` |
| `withZScores(column, name?, options?)` | `Dataset` |

```ts
data.covariance("x", "y");                  // sample covariance
data.covariance("x", "y", { ddof: 0 });     // population covariance
data.correlation("x", "y");                 // { r, n, reason }
data.correlationMatrix();                   // every numeric column
data.correlationMatrix(["x", "y"], "spearman");
data.zScores("x");                          // { values, mean, std, reason }
data.withZScores("x");                      // adds "x_z"
```

Every method throws `ColumnNotFoundError` for an unknown column and `ValidationError` when
a named column is not numeric. Numeric means the `number` **or** `integer` dtype; both are
treated alike through `columnKind()`.

`withZScores` adds a column and returns a new `Dataset`. It throws `ValidationError` if the
target name already exists, matching `addColumn`. The source dataset is unchanged.

#### `CorrelationResult`

| Field | Type | Notes |
| --- | --- | --- |
| `r` | `number \| null` | coefficient in `[-1, 1]`, clamped against float overshoot |
| `n` | `number` | complete pairs used |
| `reason` | `"insufficient-data" \| "zero-variance" \| null` | why `r` is `null` |

There is no `pValue` and no significance flag. A test would need distributional
assumptions that a bare coefficient does not carry, so the result reports the number and
the evidence behind it and stops there.

#### `CorrelationMatrix`

| Field | Type | Notes |
| --- | --- | --- |
| `columns` | `readonly string[]` | in the order supplied |
| `matrix` | `readonly (readonly (number \| null)[])[]` | square and symmetric |
| `cells` | `readonly CorrelationCell[]` | each off-diagonal cell once, with `n` and `reason` |
| `method` | `"pearson" \| "spearman"` | which coefficient was computed |
| `get(x, y)` | `(x, y) => CorrelationCell` | lookup in either direction |

The diagonal is `1` for every column, including a constant one, because that is the
identity a correlation matrix is defined to have. Off-diagonal cells involving a constant
column are `null` with `reason: "zero-variance"`.

Duplicate column names throw `ValidationError`. `get()` throws `ColumnNotFoundError` for an
unknown name.

#### `ZScoreResult`

| Field | Type | Notes |
| --- | --- | --- |
| `values` | `(number \| null)[]` | aligned to the input rows; `null` where missing |
| `mean` | `number \| null` | centring value |
| `std` | `number \| null` | scaling value |
| `reason` | `"insufficient-data" \| "zero-variance" \| null` | why every score is `null` |

Output stays aligned with the input rather than dropping missing rows, so it can be added
back as a column with `addColumn`. A constant column yields all `null` scores with
`reason: "zero-variance"` — dividing by zero would produce `Infinity`, which is not a
z-score.

#### `FiveNumberSummary`

| Field | Type | Notes |
| --- | --- | --- |
| `min` / `max` | `number \| null` | observed bounds |
| `q1` / `median` / `q3` | `number \| null` | type 7 interpolation, same as `quartiles()` |
| `mean` | `number \| null` | included so skew is visible next to the median |
| `count` | `number` | present numeric values |

#### `OutlierResult`

| Field | Type | Notes |
| --- | --- | --- |
| `method` | `"iqr" \| "zscore"` | test applied |
| `threshold` | `number` | fence multiplier, or z threshold |
| `outliers` | `Outlier[]` | each with `index`, `value`, `zScore`, `side` |
| `fences` | `{ lower, upper } \| null` | present for `iqr` |
| `considered` | `number` | values the test could be applied to |
| `reason` | `"insufficient-data" \| "zero-variance" \| null` | why nothing could be computed |

`index` refers to the position in the column, including missing cells, so it maps back to
the source row. A zero IQR yields `reason: "zero-variance"` instead of flagging every
non-modal value.

### Standalone functions

```ts
covariance(x, y);                                  // sample covariance
covariance(x, y, { ddof: 0 });                     // population covariance
pearsonCorrelation(x, y);                          // { r, n, reason }
spearmanCorrelation(x, y);                         // { r, n, reason }
correlationMatrix({ columns: [{ name: "a", values: [1, 2] }] });
zScores(xs);                                       // { values, mean, std, reason }
standardize(xs);                                   // (number | null)[]
normalize(xs);                                     // (number | null)[], [0, 1]
normalize(xs, { min: -1, max: 1 });
normalize(xs, { method: "maxabs" });               // divides by max |x|
percentileRank(xs, 2);                             // 75 for [1, 2, 2, 3]
skewness(xs);                                      // adjusted Fisher-Pearson
kurtosis(xs);                                      // excess, bias-corrected
fiveNumberSummary(xs);
detectOutliers(xs, { method: "zscore", threshold: 3 });
```

All of these take arrays of possibly-missing values and ignore `null`/`undefined`/non-finite
entries, so no caller has to pre-filter.

#### Formulas

| Statistic | Formula |
| --- | --- |
| covariance | `Σ(x - x̄)(y - ȳ) / (n - ddof)` |
| Pearson | `Σ(x - x̄)(y - ȳ) / √(Σ(x - x̄)² · Σ(y - ȳ)²)` |
| Spearman | Pearson applied to average ranks |
| z-score | `(x - x̄) / s` |
| percentile rank | `100 · count(≤ x) / n` |
| skewness (G1) | `n/((n-1)(n-2)) · Σ((x - x̄)/s)³` |
| kurtosis (G2) | `n(n+1)/((n-1)(n-2)(n-3)) · Σ((x - x̄)/s)⁴ − 3(n-1)²/((n-2)(n-3))` |

These are the bias-corrected forms `scipy.stats` reports with `bias=False` and `pandas`
reports by default. Kurtosis is excess: a normal distribution is `0`.

#### Minimum sample sizes

| Statistic | Minimum | Below it |
| --- | --- | --- |
| covariance, Pearson | 2 pairs | `null`, `insufficient-data` |
| Spearman | 2 pairs | `null`, `insufficient-data` |
| z-score | 2 values (ddof 1) | all `null` |
| skewness | 3 values | `null` |
| kurtosis | 4 values | `null` |

Each floor is the point at which the formula's denominator stops being zero, not an
arbitrary round number.

#### Missing-value policy

Pairwise. `covariance`, `pearsonCorrelation`, and `spearmanCorrelation` use only rows where
both values are present and report that `n`. Nothing is imputed. In a correlation matrix
over data with scattered gaps, different cells can therefore rest on different row sets;
`cells` exposes each `n` so this is auditable.

#### Assumptions and limitations

- Pearson measures *linear* association. `r = 0` means no linear trend, not independence.
- Spearman measures *monotonic* association and is robust to outliers, but not to ties that
  destroy ordering; average ranks mitigate this without eliminating it.
- `normalize` and `standardize` are both sensitive to a single extreme value.
- Outlier tests identify unusual values, not errors. Removing them without inspection can
  bias every subsequent statistic.
- No p-values, no confidence intervals, no hypothesis tests in this release.

## Aggregation

### Standalone helpers

The same primitives are exported for use outside a grouping, operating on arrays of
already-present values:

```ts
sum([1, 2, 3]);                      // 6
mean([1, 2, 3]);                     // 2, or null when empty
median([1, 2, 3]);                   // 2, or null when empty
variance([1, 2, 3]);                 // sample variance, or null
variance([1, 2, 3], { ddof: 0 });    // population variance
std([1, 2, 3]);                      // sample standard deviation
min([1, 2, 3]);                      // 1
max([1, 2, 3]);                      // 3
first([1, 2, 3]);                    // 1
last([1, 2, 3]);                     // 3
nunique([1, 1, 2]);                  // 2
```

`sum` uses Neumaier compensation, so `sum([1e16, 1, -1e16])` is `1` where naive addition
gives `0`. `variance` is two-pass, computing deviations from the known mean; the one-pass
`E[x²] - E[x]²` shortcut returns `0` for `[1000000001, 1000000002, 1000000003]` where the
correct answer is `1`.

### Types

| Type | Shape |
| --- | --- |
| `AggregationOp` | the eleven operation names above |
| `AggregationSpec` | `{ column?: string; op: AggregationOp; ddof?: number }` |
| `CustomAggregation` | `{ column: string; fn: AggregationFn }` |
| `AggregationFn` | `(values: readonly unknown[], context: AggregationContext) => unknown` |
| `GroupAggregationFn` | `(rows: readonly Readonly<Row>[], context: AggregationContext) => unknown` |
| `AggregationEntry` | `AggregationSpec \| CustomAggregation \| GroupAggregationFn` |
| `AggregateSpec` | `Readonly<Record<string, AggregationEntry>>` |
| `AggregationContext` | `{ column: string \| null; rows: readonly Readonly<Row>[] }` |
| `DispersionOptions` | `{ ddof?: number }` |
| `ColumnProfile` | the per-column statistics object returned by `describe(column)` |
| `ColumnKind` | `numeric` \| `boolean` \| `temporal` \| `categorical` \| `mixed` \| `empty` |
| `DescribeOptions` | `{ ddof?: number; percentiles?: readonly number[] }` |
| `Quartiles` | `{ q1: number; q2: number; q3: number }` |
| `Extremes` | `{ min: unknown; max: unknown }` |

## Schema validation

Validation answers "does this data match what I said it would be", per cell, with a report
that names the column and row. It reads the dataset and never modifies or copies it.

### `Dataset.validate(schema, options?)`

Returns a `ValidationReport`. Nothing throws for bad data: a caller usually wants every
problem at once, and the report carries them all.

```ts
const report = sales.validate({
  order_id: { type: "string", nullable: false, pattern: "[A-Z]-\\d+" },
  revenue: { type: "number", min: 0 },
  region: { type: "string", allowed: ["north", "south"] },
});

if (!report.valid) {
  for (const issue of report.issues) {
    console.log(issue.code, issue.column, issue.row, issue.message);
  }
}
```

### `Dataset.validateOrThrow(schema, options?)`

Returns the dataset when it passes and throws a `ValidationError` naming the first issue
and the total count when it does not. Use it when a failure should stop the caller.

### `validateRows(rows, columns, schema, options?)`

The standalone form, for callers holding rows rather than a `Dataset`.

### `inferSchema(rows, columns)`

Returns a schema derived from the data: the inferred type per column plus whether that
column has a missing value. A column whose values disagree is left untyped rather than
given a type that would reject half of it. Use the result as a starting point and tighten
it by hand.

### Rules

| Rule | Applies to | Meaning |
| --- | --- | --- |
| `type` | any | Expected per-value type. One of `string`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`. |
| `nullable` | any | `false` rejects missing values. Defaults to allowing them. |
| `min` / `max` | numbers, dates | Inclusive bounds. A date bound may be a `Date` or an ISO string. |
| `allowed` | any | Closed set of permitted values. |
| `pattern` | strings | Regular expression the **whole** value must match. |
| `minLength` / `maxLength` | strings | Inclusive length bounds, counted in UTF-16 code units. |
| `validate` | any | `(value, row, index) => boolean \| string`. `false` rejects; a string rejects with that message. |

A column listed with no rules is still checked for presence.

### Issue codes

| Code | Meaning |
| --- | --- |
| `MISSING_COLUMN` | The schema names a column the dataset does not have. Reported once, not per row. |
| `NULL_NOT_ALLOWED` | A missing value in a column with `nullable: false`. |
| `TYPE_MISMATCH` | The value is not the declared type. Remaining rules for that cell are skipped. |
| `NOT_ORDERABLE` | The value passed its type but cannot be compared to a bound. |
| `BELOW_MINIMUM` / `ABOVE_MAXIMUM` | The value is outside `min` / `max`. |
| `NOT_ALLOWED` | The value is not in `allowed`. |
| `PATTERN_MISMATCH` | The string does not match `pattern`. |
| `PATTERN_NOT_APPLICABLE` / `LENGTH_NOT_APPLICABLE` | A string rule was applied to a non-string value. |
| `TOO_SHORT` / `TOO_LONG` | The string is outside `minLength` / `maxLength`. |
| `CUSTOM_VALIDATOR_FAILED` | `validate` returned `false` or a message. |
| `CUSTOM_VALIDATOR_THREW` | `validate` threw; the error is reported rather than escaping. |

### `ValidationReport`

| Field | Meaning |
| --- | --- |
| `valid` | True when there were no issues. |
| `rowCount` / `columnCount` | Rows examined and columns named by the schema. |
| `checked` | Cells examined, including missing ones. |
| `issues` | The issues, capped by `maxIssues`. |
| `issueCount` | Total issues, which may exceed `issues.length`. |
| `truncated` | True when `issues` was capped. |
| `invalidRows` | Rows with at least one issue. |
| `byCode` | Issue counts keyed by code. |

`maxIssues` defaults to 100, so a badly broken dataset cannot build an unbounded list.
`columnsOnly: true` skips every check except column presence.

### Behaviour worth knowing

- A `date` or `datetime` column may hold a `Date` or an ISO string depending on how the
  value arrived. Both are accepted, so validation does not depend on the import path.
- `allowed` compares by value **and** type: `1` does not satisfy `allowed: ["1"]`.
- `pattern` is anchored, so `"[a-z]+"` rejects `"abc1"`. Wrap it in `.*` for a substring match.
- A malformed schema throws: an unknown type, an invalid regular expression, or `min`
  greater than `max` is a programming error, not a data problem.
- Normalization runs when a dataset is created, so `"36"` may already be `36` by the time
  validation sees it. Use `normalization: { inferTypes: false }` to keep raw strings.

## Pipelines and lineage

A pipeline is a definition, not an execution. Building one runs nothing; `run()` executes
it. That split makes a workflow reusable, inspectable before it runs, and describable
without side effects.

### `pipeline(options?)` / `new Pipeline(options?)`

```ts
const workflow = pipeline({ name: "sales" })
  .load(async () => loadCSV("sales.csv"), { name: "load-sales" })
  .transform((data) => data.filter((row) => row.revenue > 0), { name: "positive" })
  .validate(schema, { name: "schema" })
  .tap((data) => console.log(data.rowCount), { name: "log" })
  .build();

const result = await workflow.run();
```

### Steps

| Method | Receives | Returns |
| --- | --- | --- |
| `load(fn, options?)` | `{ index, name, total }` | A `Dataset`, an array of rows, or a column-oriented object. Must be first and only one may exist. |
| `transform(fn, options?)` | `(data, context)` | A `Dataset` or an array of rows. |
| `validate(schemaOrFn, options?)` | `(data, context)` when a function | A schema. The step fails the run when the data does not pass. |
| `tap(fn, options?)` | `(data, context)` | Ignored. The dataset passes through unchanged. |

Every step takes an optional `{ name }`. Names must be non-empty and unique, and both are
checked when the step is added rather than when the pipeline runs.

A `validate` step given a schema object is pure data, so `describe()` can report it. Given
a function, it is a callback like any other. A stored schema is cloned, so mutating the
original afterwards cannot change the pipeline.

### `build()`

Finalizes the definition and returns the same pipeline. A built pipeline is sealed: adding
another step throws, because the object you run should be the object you reviewed. Calling
`build()` twice is allowed and changes nothing, and building an empty pipeline throws.

`run()` does not require `build()`. Both styles work, and they produce the same result; use
`build()` when you want the definition frozen at a known point, such as module load.

```ts
const workflow = pipeline()
  .load(() => loadCSV("sales.csv"))
  .transform((data) => data.filter((row) => row.revenue > 0))
  .validate(schema)
  .build();

const result = await workflow.run();
```

`built` reports whether `build()` has been called, and `describe().built` reports the same
thing without running the pipeline.

### `run(options?)`

Always asynchronous, even when every step is synchronous, so adding an async step later
does not change the calling code. Synchronous and asynchronous steps may be mixed freely.

By default a failure is recorded and returned with `ok: false`, because a caller often
wants the report. With `{ throwOnError: true }` it throws a `PipelineError` instead.

### `PipelineResult`

| Field | Meaning |
| --- | --- |
| `dataset` | The result, or `null` when a step failed. |
| `ok` | True when every step completed. |
| `steps` | Per-step reports, including the failing step. |
| `lineage` | One entry per completed step. |
| `failedStep` / `failedIndex` | Which step failed, when one did. |
| `durationMs` | Total wall-clock duration. |
| `executed` / `total` | Steps attempted and steps defined. |

### `StepReport`

`index`, `name`, `kind`, `timing` (`"sync"` or `"async"`, observed rather than assumed),
`durationMs`, `rows`, `columns`, `custom`, and either `validation` for a validate step or
`error: { name, message, code? }` for the step that failed.

### Lineage

Each `LineageEntry` records the step's `name`, `kind`, the `columns` and `rows` after it,
and the columns it `addedColumns` / `removedColumns` relative to the step before. Lineage
is available on the result and on `pipeline.lineage` after a successful run. It lives in
the report, never in the row values, so it cannot change the shape of the data.

### `describe()`

Renders the definition as data without running it, and states which steps hold callbacks:

```ts
const description = workflow.describe();
description.reproducible;      // false when any step holds a function
description.nonDeterministic;  // names of those steps
```

A function has no portable text form. Rather than inventing one — which would mean `eval`,
and this package will not do that — callback steps are reported honestly as
non-reproducible. A pipeline made only of data steps reports `reproducible: true`.

### `PipelineError`

Extends `NumiqError` with `code: "PIPELINE_ERROR"` and adds `step`, `stepIndex`,
`stepKind`, and `original` (the underlying error, also set as `cause`).

## Types

### `DType`

`"string" | "number" | "integer" | "boolean" | "date" | "datetime" | "time" | "unknown" | "mixed"`

`unknown` means every value is null. `mixed` means no single type fits.

### `ColumnType`

`"string" | "number" | "integer" | "boolean" | "date" | "datetime" | "time"`

Used in `schema`. Aliases `int`, `float`, `decimal`, `text`, `bool` are accepted.

### `NormalizationPolicy`

| Field | Type | Default |
| --- | --- | --- |
| `trimStrings` | `boolean` | `false` |
| `emptyStringAsNull` | `boolean` | `true` |
| `inferTypes` | `boolean` | `true` |
| `nullValues` | `readonly string[]` | `[""]` |

`nullValues` is matched case-insensitively against the cell, after trimming when
`trimStrings` is on.

### `ImportReport`

| Field | Type |
| --- | --- |
| `format` | `"csv" \| "tsv" \| "json"` |
| `source` | `string` |
| `rowsRead` | `number` |
| `rowsImported` | `number` |
| `columns` | `readonly string[]` |
| `missingByColumn` | `Readonly<Record<string, number>>` |
| `warnings` | `readonly ImportWarning[]` |
| `normalization` | `Readonly<NormalizationPolicy>` |
| `delimiter?` | `string` |
| `contentType?` | `string` |

Warning codes: `ragged-row`, `invalid-value`, `unsafe-integer`.

### `TableOptions`

| Field | Type | Default |
| --- | --- | --- |
| `maxRows` | `number` | `1000` |
| `maxColumns` | `number` | `20` |
| `maxCellWidth` | `number` | `28` |
| `showIndex` | `boolean` | `true` |
| `showShape` | `boolean` | `true` |

## Metrics

### `Dataset.createMetric(spec)` / `createMetric(spec, rows, columns)`

Returns a `Metric`. A spec supplies exactly one calculation: `aggregation` or `fn`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Required. Non-empty; becomes the output column name |
| `column` | `string` | Required for every aggregation except `count` |
| `aggregation` | `AggregationOp` | One of `count`, `sum`, `mean`, `min`, `max`, `median`, `first`, `last`, `nunique`, `std`, `variance` |
| `fn` | `(values, context) => unknown` | Custom calculation, with `column` |
| `fn` | `(rows, context) => unknown` | Custom calculation, without `column` |
| `ddof` | `number` | Applies to `std` and `variance` only |
| `format` | `MetricFormat` | Carried, never applied |
| `metadata` | `Readonly<Record<string, unknown>>` | Carried, never interpreted |
| `groupBy` | `readonly string[]` | Grouping columns |

### `Metric`

| Member | Type |
| --- | --- |
| `name` | `string` |
| `value` | `unknown` |
| `definition` | `string` |
| `aggregation` | `AggregationOp \| null` |
| `column` | `string \| null` |
| `metric` | `MetricResult` |
| `format` | `MetricFormat` |
| `metadata` | `MetricMetadata` |
| `groupBy` | `readonly string[]` |
| `rowCount` | `number` |
| `rows` | `readonly Readonly<Row>[]` |
| `columns` | `readonly string[]` |
| `byGroup()` | `GroupedMetricResult` |
| `toDataset()` | `{ columns, rows }` |
| `recalculate(rows, columns?)` | `Metric` |
| `compare(options)` | `MetricComparison` |
| `toJSON()` | Plain object, for logging |

`MetricResult` is `{ value, rows, values, reason }`, where `reason` is `"empty"`,
`"no-values"`, `"not-numeric"`, or `null`.

`MetricComparison` is `{ other, value, otherValue, difference, ratio, percentChange, reason }`.
`reason` is `"not-numeric"`, `"zero-baseline"`, or `null`.

### `isAggregationOp(value)`

Type guard for the built-in aggregation names.

## Insights

### `Dataset.insights(options?)` / `analyze(input, options?)`

Returns an `InsightReport`: `{ insights, skipped, truncated, thresholds }`.

`Insight` carries `kind`, `severity`, `title`, `detail`, `evidence`, and `columns`.
`SkippedInsight` carries `kind`, `reason`, and `columns`.

### `resolveInsightOptions(options?)`

Returns the resolved thresholds, rejecting out-of-range values with `RangeError`.

| Option | Default | Valid range |
| --- | --- | --- |
| `strongCorrelation` | `0.7` | `0 <= x <= 1` |
| `dominanceShare` | `0.5` | `0 < x <= 1` |
| `outlierThreshold` | `1.5` | `> 0` |
| `trendStrength` | `0.7` | `0 <= x <= 1` |
| `minGroupSize` | `3` | `>= 1` |
| `maxCategoryRatio` | `0.5` | `0 < x <= 1` |
| `minRelativeGap` | `0.25` | `0 <= x <= 1` |
| `maxInsights` | `50` | `>= 1` |
| `minTrendPoints` | `4` | `>= 3` |

## Building blocks

These functions are exported and stable. Each one does the work behind a corresponding
`Dataset` method; use the method unless you are working with raw rows.

### `validateDescribeOptions(options?)`

Resolves `describe()` options to `{ ddof, percentiles }`, throwing `RangeError` for a
negative or non-integer `ddof`, a non-array `percentiles`, or a percentile outside `0..100`.

### `profileColumn(name, values, total, options?)`

Profiles one column's values into a `ColumnProfile`. `total` is the row count and is passed
rather than derived, so an all-null column reports `total` missing values instead of `0`.

### `joinTables(leftRows, leftColumns, rightRows, rightColumns, options)`

Joins raw tables into a `JoinResult`. `options` matches `Dataset.join` (`on`, `how`,
`suffixes`, `nullsMatch`, `maxRows`) with the key columns given as names. Throws
`ValidationError` when the join would produce duplicate column names.

### `pivotRows(rows, columns, options)`

Pivots long data into one column per distinct value of `options.columns`, aggregating
`options.values`. Returns a `PivotResult` carrying the pivoted rows and `collapsed`.

### `meltRows(rows, columns, options?)`

Unpivots wide data into variable/value pairs. Returns a `PreparedTable`. `idVars` and
`valueVars` select which columns are kept and which are melted.

### `concatRows(tables, options?)`

Stacks rows from several tables. `options.columns` is `"union"` (default) to keep every
column or `"strict"` to require identical columns. Throws `ValidationError` on empty input.

### `DEFAULT_NORMALIZATION`

The frozen default `NormalizationPolicy`. Spread it to build a custom policy:
`{ ...DEFAULT_NORMALIZATION, nulls: ["NA"] }`.

## Errors

| Class | `code` | Extra fields |
| --- | --- | --- |
| `NumiqError` | — | base class |
| `ValidationError` | `VALIDATION_ERROR` | — |
| `ImportError` | `IMPORT_ERROR` | `status?`, `source?` |
| `FormatError` | `FORMAT_ERROR` | — |
| `EnvironmentError` | `ENVIRONMENT_ERROR` | — |
| `ColumnNotFoundError` | `COLUMN_NOT_FOUND` | `column`, `available` |
| `PipelineError` | `PIPELINE_ERROR` | `step`, `stepIndex`, `stepKind`, `original` |
