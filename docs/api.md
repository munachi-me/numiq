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
http(s) URL when it starts with `http://` or `https://`, and as a file path otherwise.
File paths require the Node entry point.

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
