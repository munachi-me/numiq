# Numiq

A modular TypeScript engine for loading, normalizing, and inspecting structured data.

Numiq v0.1.0 is the import and dataset foundation: it reads CSV, TSV, and JSON from
files, URLs, and in-memory buffers, normalizes the values, and gives you an immutable
`Dataset` you can inspect and render as a table.

```ts
import { loadCSV } from "numiq";

const data = await loadCSV("sales.csv");

data.shape;        // [2, 2]
data.columns;      // ["product", "amount"]
data.data;         // [{ product: "Mouse", amount: 25 }, ...]
data.table();      // a box-drawing table
```

- Zero runtime dependencies.
- ESM and CommonJS builds with complete type declarations.
- Browser-safe core, with filesystem loading isolated to the Node entry point.
- Every import produces a frozen report describing what was read and what was questionable.

## Installation

```bash
npm install numiq
```

Node.js 18 or later. Works in browsers and bundlers; see [Environments](#environments).

## Quick start

### Load from a file

```ts
import { loadCSV } from "numiq";

const data = await loadCSV("./data/sales.csv");
```

### Load from a URL

```ts
import { loadURL } from "numiq";

const data = await loadURL("https://example.com/sales.csv");
```

### Load from a browser `File` or `Blob`

```ts
import { loadCSV } from "numiq";

const data = await loadCSV(fileInput.files[0]);
```

### Parse text you already have

```ts
import { parseDelimited, parseJSON } from "numiq";

const a = parseDelimited("a,b\n1,2\n", { format: "csv" });
const b = parseJSON('[{"a":1}]');
```

`parseDelimited` and `parseJSON` are synchronous. The `load*` functions are asynchronous
because they perform I/O.

### Build a dataset directly

```ts
import { createDataset } from "numiq";

// From records
createDataset([{ name: "Ada", age: 36 }, { name: "Lin", age: 41 }]);

// From parallel arrays
createDataset({ name: ["Ada", "Lin"], age: [36, 41] });

// With an explicit column order
createDataset([{ a: 1, b: 2 }], { columns: ["b", "a"] });
```

## The Dataset

A `Dataset` is immutable. Every read returns a defensive copy, so mutating what you
receive can never corrupt the dataset.

| Member | Type | Description |
| --- | --- | --- |
| `columns` | `readonly string[]` | Column names, in order |
| `shape` | `readonly [number, number]` | `[rows, columns]` |
| `data` | `readonly Row[]` | Rows as records (a copy) |
| `rowCount` | `number` | Number of rows |
| `columnCount` | `number` | Number of columns |
| `length` | `number` | Alias of `rowCount` |
| `empty` | `boolean` | No rows or no columns |
| `dtypes` | `Record<string, DType>` | Inferred type per column |
| `schema` | `Record<string, ColumnSchema>` | Type and nullability per column |
| `importReport` | `ImportReport \| null` | Loader metadata, `null` for hand-built data |

Inspection methods:

| Method | Description |
| --- | --- |
| `table(options?)` | Render a table |
| `toTable(options?)` | Alias of `table` |
| `display(options?)` | Print the table and return the dataset |
| `head(n?)` | First `n` rows (default 5) |
| `tail(n?)` | Last `n` rows (default 5) |
| `info()` | Shape, types, and missing-value summary |
| `column(name)` | Type, values, missing count, and cardinality |
| `distinct(name)` | Distinct present values, in first-seen order |
| `unique(name)` | Number of distinct present values |

## Table output

`table()` renders a box-drawing table:

```ts
console.log(data.table());
```

```
┌─────┬──────────┬────────┐
│ idx │ product  │ amount │
├─────┼──────────┼────────┤
│ 0   │ Mouse    │ 25     │
│ 1   │ Keyboard │ 75     │
└─────┴──────────┴────────┘
Showing 2 of 2 rows.
2 rows × 2 columns
```

Rendering is bounded by default so a large dataset cannot flood your terminal:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxRows` | `1000` | Rows rendered; `Infinity` renders all |
| `maxColumns` | `20` | Columns rendered before truncation |
| `maxCellWidth` | `28` | Characters per cell before truncation |
| `showIndex` | `true` | Render the `idx` row-label column |
| `showShape` | `true` | Render the trailing shape line |

Only the visible rows are formatted, so `table()` on a million-row dataset costs the
same as on a thousand-row one.

## Import options

### Delimited files (`loadCSV`, `loadTSV`, `parseDelimited`)

| Option | Default | Meaning |
| --- | --- | --- |
| `delimiter` | detected | Single-character field separator |
| `header` | `true` | Treat the first row as column names |
| `columns` | — | Names to use when `header` is `false` |
| `skipRows` | `0` | Rows to discard before the header |
| `schema` | — | Explicit per-column types |
| `onInvalid` | `"error"` | `"error"` or `"null"` for failed casts |
| `onRaggedRow` | `"error"` | `"error"` or `"pad"` for wrong-width rows |
| `normalization` | — | Cell policy overrides |

Delimiters are detected from several sampled lines, not just the first, so a preamble
line cannot mislead detection. Quoted fields follow RFC 4180: doubled quotes escape a
quote, and delimiters and newlines inside quotes are literal.

### JSON (`loadJSON`, `parseJSON`)

Accepts an array of records, an array of arrays with `columns`, or a column-oriented
object of parallel arrays. Options: `columns`, `skipRows`, `schema`, `onInvalid`,
`normalization`.

### URLs (`loadURL`)

Format resolution order: an explicit `format`, then the URL extension, then the
`content-type` header. If none identifies a supported format, the call fails with a
`FormatError` rather than guessing. Also accepts `headers`, `timeoutMs` (default 30 s),
and `signal`.

## Type casting

Declare types explicitly with `schema`:

```ts
const data = await loadCSV("sales.csv", {
  schema: {
    amount: "number",
    quantity: "integer",
    active: "boolean",
    ordered_on: "date",
    updated_at: "datetime",
    opens_at: "time",
  },
});
```

Supported types: `string`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`.
Aliases such as `int`, `float`, `text`, and `bool` are accepted. A descriptor form
`{ type: "date", format: "YYYY-MM-DD" }` is accepted; `format` is reserved for a future
release and currently has no effect.

Casting is strict. `date` and `datetime` require ISO input (`YYYY-MM-DD`,
`YYYY-MM-DDTHH:MM:SS`) and produce real `Date` objects at UTC midnight. `time` stays a
canonical `HH:MM:SS` string, because a wall-clock time has no date to anchor a `Date` to.
A failed cast throws a `FormatError` naming the row and column unless `onInvalid: "null"`
is set.

Without a schema, Numiq infers types for reporting (`dtypes`) but never silently converts
date-like strings into `Date` objects. What you see in `data` is what the file contained.

## Normalization

Cell normalization is conservative by default, because aggressive coercion destroys data.

| Behaviour | Default |
| --- | --- |
| Trim surrounding whitespace | Off |
| Empty string becomes `null` | On |
| Infer numbers and booleans | On |
| `NA`, `N/A`, `null`, `NULL` become `null` | **Off** |

The last row matters. `NA` is Namibia's country code and `null` is a surname. Treating
those tokens as missing by default silently corrupts real datasets, so they are opt-in:

```ts
await loadCSV("data.csv", { normalization: { nullValues: ["", "NA", "N/A", "null"] } });
```

Other guarantees:

- Integers beyond `Number.MAX_SAFE_INTEGER` stay strings and raise an `unsafe-integer`
  warning instead of being rounded.
- Leading-zero values such as `007` stay strings, preserving identifiers.
- Values beginning with `+` stay strings, preserving phone numbers.
- `inferTypes: false` leaves every cell as the text that was read.

## Import reports

Every loader returns a frozen report describing the import:

```ts
const report = data.importReport;

report.format;          // "csv"
report.rowsRead;        // 2
report.rowsImported;    // 2
report.missingByColumn; // { product: 0, amount: 0 }
report.warnings;        // [{ code: "unsafe-integer", message: "...", row: 4, column: "id" }]
report.normalization;   // the policy that was applied
```

Warnings are recorded, never thrown, for recoverable problems: ragged rows that were
padded, invalid casts that became `null`, and unsafe integers. Structural problems throw.

Derived datasets (`head`, `tail`) report `null`, because their counts and warnings would
describe the source import rather than the rows they hold.

## Errors

All errors extend `NumiqError` and carry a stable `code`.

| Class | Code | Raised when |
| --- | --- | --- |
| `ValidationError` | `VALIDATION_ERROR` | Bad arguments, unsupported input, malformed rows |
| `ImportError` | `IMPORT_ERROR` | A source could not be read; carries `status` and `source` |
| `FormatError` | `FORMAT_ERROR` | Format is undetectable, unsupported, or malformed |
| `EnvironmentError` | `ENVIRONMENT_ERROR` | An API is unavailable here, e.g. filesystem in a browser |
| `ColumnNotFoundError` | `COLUMN_NOT_FOUND` | A column does not exist; carries `column` and `available` |

```ts
import { NumiqError, ColumnNotFoundError } from "numiq";

try {
  data.column("revenue");
} catch (error) {
  if (error instanceof ColumnNotFoundError) {
    console.log(error.available);
  }
}
```

## Environments

Numiq ships two entry points from one source tree.

| Condition | Entry | Local files | URLs | Blobs |
| --- | --- | --- | --- | --- |
| `node` | `dist/esm/node.js` | Yes | Yes | Yes |
| `browser` / default | `dist/esm/index.js` | No | Yes | Yes |

The default entry contains no Node.js built-ins, so it bundles for the browser without
polyfills. Calling `loadCSV("./data.csv")` there fails with an `EnvironmentError` that
explains what to do instead, rather than a bundler error or a silent failure.

Local file paths are resolved against the current working directory and are not otherwise
restricted. Numiq is a library and does not impose a sandbox on its consumer.

CommonJS consumers can `require("numiq")`; the `require` condition resolves to a
CommonJS build.

## Scope of v0.1.0

Implemented: import (CSV, TSV, JSON, URL), normalization, type casting, the `Dataset`
abstraction, inspection, table rendering, the error taxonomy, and the environment split.

Deliberately not in v0.1.0: filtering, sorting, grouping, aggregation, descriptive
statistics, joins, metrics, and Excel import. The architecture reserves space for them
(see `docs/architecture.md`), but no partial versions ship. `Dataset` is immutable, so
every future transformation will return a new `Dataset` without changing existing
behaviour.

## Development

```bash
npm install
npm run verify
```

`verify` runs the typecheck, the test suite, the build, the type-contract tests, and the
package checks.

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile ESM and CJS builds with declarations |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check the source |
| `npm run test:types` | Check the published type contract |
| `npm run test:package` | Pack and verify the artifact in a real consumer |
| `npm run verify` | Everything above, in order |

See `docs/` for the architecture and API reference, and `examples/` for runnable
programs.

## License

MIT
