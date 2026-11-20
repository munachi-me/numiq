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
