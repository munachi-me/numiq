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

## Errors

| Class | `code` | Extra fields |
| --- | --- | --- |
| `NumiqError` | — | base class |
| `ValidationError` | `VALIDATION_ERROR` | — |
| `ImportError` | `IMPORT_ERROR` | `status?`, `source?` |
| `FormatError` | `FORMAT_ERROR` | — |
| `EnvironmentError` | `ENVIRONMENT_ERROR` | — |
| `ColumnNotFoundError` | `COLUMN_NOT_FOUND` | `column`, `available` |
