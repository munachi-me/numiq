# Numiq

[![npm](https://img.shields.io/npm/v/@munachi-me/numiq.svg)](https://www.npmjs.com/package/@munachi-me/numiq)
[![CI](https://github.com/munachi-me/numiq/actions/workflows/ci.yml/badge.svg)](https://github.com/munachi-me/numiq/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@munachi-me/numiq.svg)](LICENSE)

A modular TypeScript engine for loading, normalizing, preparing, querying, and
analyzing structured data.

Numiq reads CSV, TSV, and JSON from files, URLs, and in-memory buffers,
normalizes the values, and gives you an immutable `Dataset` you can inspect, filter, sort,
prepare, query, group, summarize, and render as a table. It also profiles the dataset for
quality — missing values, duplicates, mixed types, untrimmed text, outliers — and reports
findings you can act on, with the methods to clean them. It describes each column and
measures how columns relate to each other: correlation, rank correlation, correlation
matrices, z-scores, percentile rank, skewness, kurtosis, five-number summaries, and
outlier detection. Beyond describing what is there, it defines reusable metrics that keep
their own definition, and reports observations that carry their evidence. Columns can be
derived from ordered conditional rules, related datasets can be joined, and tables can be
pivoted, melted, and stacked. Values that depend on a row's neighbours are available as
window functions, series can be grouped into calendar buckets, and a whole workflow can be
declared as a reusable pipeline with schema validation and lineage.

```ts
import { loadCSV } from "@munachi-me/numiq";

const data = await loadCSV("sales.csv"); // reads ./dataset/sales.csv

data.shape; // [2, 2]
data.columns; // ["product", "amount"]
data.table(); // a box-drawing table

data
  .fillMissing({ amount: 0 })
  .addColumn("tax", (row) => Number(row.amount) * 0.2)
  .query()
  .where("amount", ">", 30)
  .and("product", "contains", "a", { ignoreCase: true })
  .orderBy("amount", "desc")
  .select(["product", "amount", "tax"])
  .limit(10)
  .execute();
```

- Zero runtime dependencies.
- ESM and CommonJS builds with complete type declarations.
- Browser-safe core, with filesystem loading isolated to the Node entry point.
- Every import produces a frozen report describing what was read and what was questionable.

## Installation

```bash
npm install @munachi-me/numiq
```

Node.js 18 or later. Works in browsers and bundlers; see [Environments](#environments).

## Quick start

### Load from a file

Numiq reads local files from a `dataset/` folder in your project root. Create that
folder, drop your data in it, and pass the filename:

```text
my-project/
├── dataset/
│   ├── sales.csv
│   └── customers.json
├── node_modules/
├── package.json
└── src/
    └── index.ts
```

```ts
import { loadCSV, loadJSON, loadTSV } from "@munachi-me/numiq";

const sales = await loadCSV("sales.csv");
const customers = await loadJSON("customers.json");
```

Do not include `dataset/` in the argument. `loadCSV("./dataset/sales.csv")`,
`loadCSV("/abs/path/sales.csv")`, and `loadCSV("../sales.csv")` are all rejected.

The folder is resolved from `process.cwd()`. If your script runs from a different
directory, such as a monorepo tool, pass the project root explicitly:

```ts
const sales = await loadCSV("sales.csv", { datasetDir: "/path/to/project" });
```

`loadCSV` reads only `<datasetDir>/dataset/<filename>`. The path is resolved with
`realpath` before use, so a symlink inside `dataset/` that points outside it is refused.

### Load the bundled sample

```ts
import { useSampleDataset } from "@munachi-me/numiq";

const sample = await useSampleDataset();

sample.shape; // [50, 7]
sample.table();
```

The sample is a fixed 50-row sales table that ships inside the package, so it works
without creating a `dataset/` folder and is identical on every call.

### Load from a URL

```ts
import { loadURL } from "@munachi-me/numiq";

const data = await loadURL("https://example.com/sales.csv");
```

### Load from a browser `File` or `Blob`

```ts
import { loadCSV } from "@munachi-me/numiq";

const data = await loadCSV(fileInput.files[0]);
```

### Parse text you already have

```ts
import { parseDelimited, parseJSON } from "@munachi-me/numiq";

const a = parseDelimited("a,b\n1,2\n", { format: "csv" });
const b = parseJSON('[{"a":1}]');
```

`parseDelimited` and `parseJSON` are synchronous. The `load*` functions are asynchronous
because they perform I/O.

### Build a dataset directly

```ts
import { createDataset } from "@munachi-me/numiq";

// From records
createDataset([
  { name: "Ada", age: 36 },
  { name: "Lin", age: 41 },
]);

// From parallel arrays
createDataset({ name: ["Ada", "Lin"], age: [36, 41] });

// With an explicit column order
createDataset([{ a: 1, b: 2 }], { columns: ["b", "a"] });
```

Hand-built rows go through the same cell normalization as a parsed file, so
`createDataset([{ a: "1" }])` stores the number `1`, not the string `"1"`. This surprises
people who expect their values to pass through untouched. Pass
`{ normalization: { inferTypes: false } }` to keep every value exactly as given:

```ts
createDataset([{ a: "1" }]); // [{ a: 1 }]
createDataset([{ a: "1" }], { normalization: { inferTypes: false } }); // [{ a: "1" }]
```

## The Dataset

A `Dataset` is immutable. Every read returns a defensive copy, so mutating what you
receive can never corrupt the dataset.

| Member         | Type                           | Description                                 |
| -------------- | ------------------------------ | ------------------------------------------- |
| `columns`      | `readonly string[]`            | Column names, in order                      |
| `shape`        | `readonly [number, number]`    | `[rows, columns]`                           |
| `data`         | `readonly Row[]`               | Rows as records (a copy)                    |
| `rowCount`     | `number`                       | Number of rows                              |
| `columnCount`  | `number`                       | Number of columns                           |
| `length`       | `number`                       | Alias of `rowCount`                         |
| `empty`        | `boolean`                      | No rows or no columns                       |
| `dtypes`       | `Record<string, DType>`        | Inferred type per column                    |
| `schema`       | `Record<string, ColumnSchema>` | Type and nullability per column             |
| `importReport` | `ImportReport \| null`         | Loader metadata, `null` for hand-built data |

Inspection methods:

| Method              | Description                                  |
| ------------------- | -------------------------------------------- |
| `table(options?)`   | Render a table                               |
| `toTable(options?)` | Alias of `table`                             |
| `display(options?)` | Print the table and return the dataset       |
| `head(n?)`          | First `n` rows (default 5)                   |
| `tail(n?)`          | Last `n` rows (default 5)                    |
| `info()`            | Shape, types, and missing-value summary      |
| `column(name)`      | Type, values, missing count, and cardinality |
| `distinct(name)`    | Distinct present values, in first-seen order |
| `unique(name)`      | Number of distinct present values            |

Transformation methods return a new `Dataset`, so they chain:

| Method                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `filter(predicate)`        | Rows where `predicate(row, index)` is true                |
| `sort(column, direction?)` | Sorted copy; `direction` is `"asc"` (default) or `"desc"` |
| `select(columns)`          | Only the named columns, in the requested order            |
| `limit(count)`             | At most `count` rows from the start                       |

```ts
const top = data
  .filter((row) => Number(row.revenue) > 100)
  .sort("revenue", "desc")
  .select(["order_id", "product", "revenue"])
  .limit(10);
```

Sorting is total and deterministic: missing values (`null`/`undefined`) sort last in
both directions, numbers and dates compare numerically, everything else compares as
text, and equal values keep their original order. Derived datasets report
`importReport` as `null`, because the source counts would no longer describe them.

Preparation methods clean and reshape data. They return a new `Dataset`, chain with the
transformations above, and never modify the source:

| Method                                        | Description                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `drop(columns)`                               | Remove columns, keeping the rest in order                                |
| `rename(mapping)`                             | Rename columns in place, preserving position and values                  |
| `dropMissing(options?)`                       | Drop rows with missing cells (`how: "any"` by default)                   |
| `fillMissing(strategyOrMapping)`              | Fill gaps with `"mean"`, `"median"`, `"mode"`, a constant, or a callback |
| `replace(rules)`                              | Replace values per column, by value, predicate, or callback              |
| `map(column, callback)`                       | Transform one column from `(value, row, index)`                          |
| `addColumn(name, callbackOrValues)`           | Append a computed column or a value list                                 |
| `addConditionalColumn(name, rules, options?)` | Append a column from ordered rules, first match wins                     |
| `join(other, options)`                        | Join another dataset (`inner`, `left`, `right`, `full`)                  |
| `pivot(options)` / `melt(options?)`           | Reshape between wide and long                                            |
| `concat(others, options?)`                    | Stack rows, with `"union"` or `"strict"` columns                         |
| `cast(schema)`                                | Convert columns to explicit types                                        |
| `dropDuplicates(columns?)`                    | Keep the first row of each distinct combination                          |
| `sample(count, options?)`                     | Draw rows; deterministic when `seed` is given                            |

```ts
const prepared = data
  .drop(["internal_note"])
  .rename({ qty: "quantity" })
  .fillMissing({ quantity: 0 })
  .dropDuplicates(["order_id"])
  .addColumn("total", (row) => Number(row.quantity) * Number(row.unit_price));
```

Missing-value strategies never coerce: `"mean"` and `"median"` require a numeric column
and throw `ValidationError` on text rather than parsing it. A column with no present
values is left untouched. `replace` and `dropDuplicates` compare by value and type, so
`1` never matches `"1"`, and `null` and `undefined` count as one missing value. When a
callback throws, the error names the operation, row, and column, with the original error
as `cause`.

Query methods filter, order, and project in one chain. Conditions are typed values passed
to methods rather than text, so there is no query string to parse and no way for data to
become executable code:

```ts
const result = data
  .query()
  .where("revenue", ">", 100)
  .and("region", "in", ["North", "West"])
  .or("priority", "isNull")
  .orderBy("revenue", "desc")
  .select(["product", "region", "revenue"])
  .limit(20)
  .execute();
```

| Operator                             | Meaning                                 |
| ------------------------------------ | --------------------------------------- |
| `=`, `!=`, `>`, `>=`, `<`, `<=`      | Comparison, by value and type           |
| `in`, `notIn`                        | Membership in a non-empty array         |
| `between`                            | Inclusive range, given as `[low, high]` |
| `contains`, `startsWith`, `endsWith` | Substring tests on text                 |
| `isNull`, `isNotNull`                | Missing-value tests                     |

`and` binds tighter than `or`, so `.where("a", "=", 1).or("b", "=", 2).and("c", "=", 3)`
means `a OR (b AND c)`. Use `andGroup` / `orGroup` to parenthesise, and `toString()` to see
how the conditions were grouped.

A missing cell never satisfies a comparison, including `!=` and `notIn`, matching SQL.
Add `.or("column", "isNull")` when missing rows should be included.

Queries are immutable: every builder step returns a new `Query`, so a partially built query
is safe to reuse as a starting point for several branches. Nothing runs until `execute()`,
which returns a new `Dataset` and never modifies the source.

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

| Option         | Default | Meaning                               |
| -------------- | ------- | ------------------------------------- |
| `maxRows`      | `1000`  | Rows rendered; `Infinity` renders all |
| `maxColumns`   | `20`    | Columns rendered before truncation    |
| `maxCellWidth` | `28`    | Characters per cell before truncation |
| `showIndex`    | `true`  | Render the `idx` row-label column     |
| `showShape`    | `true`  | Render the trailing shape line        |

Only the visible rows are formatted, so `table()` on a million-row dataset costs the
same as on a thousand-row one.

## Import options

### Delimited files (`loadCSV`, `loadTSV`, `parseDelimited`)

| Option          | Default   | Meaning                                   |
| --------------- | --------- | ----------------------------------------- |
| `delimiter`     | detected  | Single-character field separator          |
| `header`        | `true`    | Treat the first row as column names       |
| `columns`       | —         | Names to use when `header` is `false`     |
| `skipRows`      | `0`       | Rows to discard before the header         |
| `schema`        | —         | Explicit per-column types                 |
| `onInvalid`     | `"error"` | `"error"` or `"null"` for failed casts    |
| `onRaggedRow`   | `"error"` | `"error"` or `"pad"` for wrong-width rows |
| `normalization` | —         | Cell policy overrides                     |

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
A failed cast during a load throws a `FormatError` naming the row and column unless
`onInvalid: "null"` is set.

`Dataset.cast()` uses the same type names and is equally strict, but throws
`ValidationError` instead, because it runs after the import and has no format context to
blame. Catch `NumiqError` if you want to handle both without distinguishing.

Without a schema, Numiq infers types for reporting (`dtypes`) but never silently converts
date-like strings into `Date` objects. What you see in `data` is what the file contained.

## Normalization

Cell normalization is conservative by default, because aggressive coercion destroys data.

| Behaviour                                 | Default |
| ----------------------------------------- | ------- |
| Trim surrounding whitespace               | Off     |
| Empty string becomes `null`               | On      |
| Infer numbers and booleans                | On      |
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

report.format; // "csv"
report.rowsRead; // 2
report.rowsImported; // 2
report.missingByColumn; // { product: 0, amount: 0 }
report.warnings; // [{ code: "unsafe-integer", message: "...", row: 4, column: "id" }]
report.normalization; // the policy that was applied
```

Warnings are recorded, never thrown, for recoverable problems: ragged rows that were
padded, invalid casts that became `null`, and unsafe integers. Structural problems throw.

Derived datasets (`head`, `tail`) report `null`, because their counts and warnings would
describe the source import rather than the rows they hold.

## Errors

All errors extend `NumiqError` and carry a stable `code`.

| Class                 | Code                | Raised when                                               |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `ValidationError`     | `VALIDATION_ERROR`  | Bad arguments, unsupported input, malformed rows          |
| `ImportError`         | `IMPORT_ERROR`      | A source could not be read; carries `status` and `source` |
| `FormatError`         | `FORMAT_ERROR`      | Format is undetectable, unsupported, or malformed         |
| `EnvironmentError`    | `ENVIRONMENT_ERROR` | An API is unavailable here, e.g. filesystem in a browser  |
| `ColumnNotFoundError` | `COLUMN_NOT_FOUND`  | A column does not exist; carries `column` and `available` |

```ts
import { NumiqError, ColumnNotFoundError } from "@munachi-me/numiq";

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

| Condition           | Entry               | Local files | URLs | Blobs |
| ------------------- | ------------------- | ----------- | ---- | ----- |
| `node`              | `dist/esm/node.js`  | Yes         | Yes  | Yes   |
| `browser` / default | `dist/esm/index.js` | No          | Yes  | Yes   |

The default entry contains no Node.js built-ins, so it bundles for the browser without
polyfills. Calling `loadCSV("./data.csv")` there fails with an `EnvironmentError` that
explains what to do instead, rather than a bundler error or a silent failure.

Local filenames are resolved against the `dataset/` folder in the current working
directory and are confined to it: absolute paths, `..`, path separators, and symlinks
that resolve outside the folder are all refused.

CommonJS consumers can `require("@munachi-me/numiq")`; the `require` condition resolves to a
CommonJS build.

The `@munachi-me/numiq/core` subpath resolves to the browser-safe entry
(`dist/esm/index.js`, or `dist/cjs/index.js` under `require`) regardless of the `node`
condition. It exports the same API, but has no local file reader installed, so passing a
local filename to `loadCSV`, `loadJSON`, or `loadTSV` raises an `EnvironmentError`
explaining that the Node.js build is required. Use it when a bundler must not see
`node:fs` at all.

Supported Node versions (18, 20, 22), the browser and bundler matrix, and the
semantic-versioning policy are documented in [`docs/compatibility.md`](docs/compatibility.md).
Upgrading from a pre-1.0 release: [`docs/migration.md`](docs/migration.md). Every export is
documented in [`docs/api.md`](docs/api.md).

## Performance

`npm run bench` times the hot paths on 1,000, 25,000 and 100,000 rows. The suite, the
recorded results, and the reasoning behind each change are in
[`benchmarks/README.md`](benchmarks/README.md).

Rough numbers at 100,000 rows on Node 24: `filter` 16ms, `groupBy().aggregate()` 40ms,
`sort` 125ms, `describe()` 326ms, a 100,000 × 200 join 120ms. Reading `data` costs a deep
copy — 32ms at that size — so read it once rather than inside a loop.

Two properties are worth knowing before you reach for a large dataset:

- **Every transform copies.** `filter`, `sort`, and `select` each build a new dataset, so
  a chain of _k_ steps touches the data _k_ times. That is what makes datasets immutable
  and safe to share.
- **`describe()` costs roughly 3.3ms per 100,000 rows per column.** Use
  `describe("column")` when you only need one.

## Grouping and aggregation

`groupBy()` describes a split and computes nothing; `aggregate()` runs it and returns an
ordinary `Dataset`, so a summary composes with queries, sorting, and preparation.

```ts
const summary = data.groupBy("region").aggregate({
  totalRevenue: { column: "revenue", op: "sum" },
  averageOrder: { column: "revenue", op: "mean" },
  orderCount: { op: "count" },
});

summary.query().where("totalRevenue", ">", 1000).orderBy("totalRevenue", "desc").execute();
```

Groups keep first-appearance order, so output is deterministic. Rows with a missing key form
their own group with a `null` key rather than being dropped, and missing cells inside a group
are excluded from every aggregation. `std` and `variance` default to the sample formula;
pass `ddof: 0` for the population formula.

## Descriptive statistics

`describe()` profiles columns. With no argument it profiles every column and returns a
description you can print as a table; with a column name it returns that column's profile
directly, so there is no one-row wrapper to unwrap.

```ts
sales.describe().table(); // one row per column
sales.describe({ ddof: 0 }); // every column, population formula
sales.describe("revenue").mean; // a single profile
sales.describe().get("revenue"); // the same profile, by name
```

```
┌─────┬──────────┬─────────┬───────┬─────────┬────────┬──────────┬──────────┬────────┬──────────────────┬──────────────────┬────────────┐
│ idx │ column   │ type    │ count │ missing │ unique │ sum      │ mean     │ median │ min              │ max              │ std        │
├─────┼──────────┼─────────┼───────┼─────────┼────────┼──────────┼──────────┼────────┼──────────────────┼──────────────────┼────────────┤
│ 0   │ order_id │ string  │ 50    │ 0       │ 50     │ NULL     │ NULL     │ NULL   │ ORD-1001         │ ORD-1050         │ NULL       │
│ …   │ …        │ …       │ …     │ …       │ …      │ …        │ …        │ …      │ …                │ …                │ …          │
│ 5   │ quantity │ integer │ 50    │ 0       │ 7      │ 197      │ 3.94     │ 4      │ 1                │ 7                │ 2.044505   │
│ 6   │ revenue  │ number  │ 50    │ 0       │ 50     │ 31122.69 │ 622.4538 │ 346.07 │ 29.5             │ 2720.94          │ 664.003407 │
└─────┴──────────┴─────────┴───────┴─────────┴────────┴──────────┴──────────┴────────┴──────────────────┴──────────────────┴────────────┘
```

Each profile carries `count`, `missing`, `total`, `unique`, `sum`, `mean`, `median`, `mode`,
`min`, `max`, `range`, `variance`, `std`, `q1`, `q3`, `iqr`, and any requested `percentiles`.

Statistics that do not apply to a column's type are `null`, never `0`. Only numeric columns
get arithmetic, because a sum of categories has no meaning:

| Statistic                                               | numeric | boolean | temporal | text   | mixed  |
| ------------------------------------------------------- | ------- | ------- | -------- | ------ | ------ |
| count, missing, unique, mode, min, max                  | yes     | yes     | yes      | yes    | yes    |
| sum, mean, median, quartiles, iqr, variance, std, range | yes     | `null`  | `null`   | `null` | `null` |

`variance` and `std` default to the sample formula (`ddof: 1`); pass `ddof: 0` for the
population formula. Every profile records the `ddof` it used, so a result is never
ambiguous about which formula produced it. Percentiles are interpolated with the same
method as `numpy.percentile` and R's `quantile(type = 7)`.

```ts
const profile = sales.describe("revenue", { ddof: 0, percentiles: [10, 90] });
profile.std; // 657.3298, the population standard deviation
profile.percentiles.p90; // 1631.1600000000003
```

The description is an analytical result, not a `Dataset`. Call `toDataset()` when you need
tabular output with every statistic — including any requested percentiles, which become
columns named after their keys — for example to feed a chart:

```ts
sales
  .describe({ percentiles: [90] })
  .toDataset()
  .select(["name", "kind", "mean", "p90"]);
```

Percentiles are interpolated in floating point, so a value like `1631.1600000000003` is
expected rather than a sign of a bug. `table()` rounds for display; the numbers above are
the full-precision values on `profiles`.

The standalone statistics are exported too, for use outside a dataset:
`quantile`, `percentile`, `quartiles`, `iqr`, `mode`, `range`, and `extremes`.

## Data quality

`describe()` tells you what is in a column. `profile()` tells you whether the dataset is
ready to analyse: it keeps every `describe()` statistic and adds what is true of the
dataset as a whole.

```ts
import { Dataset } from "@munachi-me/numiq";

const sales = new Dataset([
  { region: "north", revenue: 100 },
  { region: "south", revenue: 120 },
  { region: "north", revenue: 110 },
  { region: " north ", revenue: 130 },
  { region: null, revenue: 27500 },
  { region: "east", revenue: 140 },
]);

const profile = sales.profile();

profile.summary.missingPercent; // 8.3
profile.summary.duplicateRows; // 0
profile.summary.constantColumns; // []
profile.healthy; // true — no error-severity findings
profile.findingsTable();
```

```
┌─────┬──────────┬───────────────────┬─────────┬───────┬──────────────────────────────┐
│ idx │ severity │ code              │ column  │ count │ message                      │
├─────┼──────────┼───────────────────┼─────────┼───────┼──────────────────────────────┤
│ 0   │ warning  │ UNTRIMMED_STRINGS │ region  │ 1     │ Column "region" has 1 value… │
│ 1   │ info     │ MISSING_VALUES    │ region  │ 1     │ Column "region" is missing … │
│ 2   │ info     │ OUTLIERS          │ revenue │ 1     │ Column "revenue" has 1 valu… │
└─────┴──────────┴───────────────────┴─────────┴───────┴──────────────────────────────┘
```

`duplicateRows` is `0` here because no two rows are identical in *every* column — row 2
shares a region with row 0 but has a different revenue. A duplicate is only whole-row by
default, which is why the dataset-level `DUPLICATE_ROWS` finding never appears when you
profile a subset of columns.

Findings carry a stable `code`, a `severity` (`error`, `warning`, `info`), and the column
and count affected. They are sorted worst first, and capped at `maxFindings` (100 by
default) so a broken dataset cannot produce an unreadable report; `findingCount` still
holds the true total.

When a finding tells you where the problem is, the companion methods tell you exactly
which rows and then fix them:

```ts
sales.missingValues({ columns: ["region"] }).columns[0].rows; // [4]
sales.findDuplicates({ columns: ["region"] }).groups[0].rows; // [0, 2]
sales.detectOutliers({ columns: ["revenue"] }).columns[0].outliers; // [{ row: 4, value: 27500 }]

const { dataset, changedRows } = sales.normalizeText({ case: "lower" });
changedRows; // 1 — only the padded " north " moved
const cleaned = dataset.dropDuplicates(["region"]); // 4 rows
```

`getQualityReport()` returns the same findings as a flat list with `bySeverity`,
`forColumn()`, `forCode()`, and `table()`. Both surfaces share one finding generator, so a
column cannot be a `warning` in one and an `info` in the other.

`normalizeText()` leaves non-string cells untouched rather than coercing them, so a numeric
column stays numeric, and it reports what it changed — a count per column plus up to five
before/after examples — rather than asking you to trust it.

Validation gained a matching `unique` rule, for the case where the duplicate is a problem
rather than a curiosity:

```ts
sales.validate({ order_id: { unique: true } }); // DUPLICATE_VALUE on row 3
sales.validate({ line: { unique: ["order_id", "line_no"] } }); // composite key
```

`1` and `"1"` are different values, and missing values are exempt: repeating "no value" is
not a duplicate.

## Advanced statistics

Correlation, distribution shape, position, and outliers. Every function returns a typed
result rather than a bare number where the answer needs context.

```ts
sales.correlation("quantity", "revenue"); // { r: 0.43724861958188593, n: 50, reason: null }
sales.rankCorrelation("quantity", "revenue"); // { r: 0.5244511749947358, n: 50, reason: null }
sales.correlationMatrix(); // every numeric column, symmetric
sales.zScores("revenue"); // { values, mean, std, reason }
sales.outliers("revenue"); // Tukey's fences by default
sales.fiveNumberSummary("revenue");
sales.skewness("revenue"); // 1.7133020612357541
sales.kurtosis("revenue"); // 2.3952120604810103 (excess)
```

### Undefined is `null`, never `NaN` or `0`

A coefficient that does not exist for the data returns `null` with a `reason`, so a caller
can branch on it:

| Situation                     | Result                                        |
| ----------------------------- | --------------------------------------------- |
| fewer than two complete pairs | `{ r: null, n, reason: "insufficient-data" }` |
| one column is constant        | `{ r: null, n, reason: "zero-variance" }`     |
| both columns vary             | `{ r: number, n, reason: null }`              |

`NaN` would silently poison downstream arithmetic; `0` would claim "no relationship" when
the honest answer is "cannot be computed".

### Missing values are handled pairwise

`covariance` and the correlations use only the rows where _both_ columns are present.
A row missing either coordinate cannot contribute to a relationship, and imputing one would
invent data. Consequently `n` can differ between pairs, and every result reports the `n` it
used so this stays visible.

### No significance claims

The correlation results carry `r`, `n`, and `reason` — and nothing else. There is no
p-value and no "significant" flag. Deciding whether a relationship is real needs a test
with its own distributional assumptions, and a bare `r` from nine points looks identical
to one from nine thousand. Ship the number, not a verdict.

### Correlation method choice

| Method                       | Measures                  | Use when                                             |
| ---------------------------- | ------------------------- | ---------------------------------------------------- |
| Pearson (`correlation`)      | linear association        | both columns are roughly continuous and outlier-free |
| Spearman (`rankCorrelation`) | any monotonic association | data is skewed, has outliers, or is ordinal          |

Pearson on `[1..5]` against `[1, 8, 27, 64, 125]` (a perfect cubic) is well under 1;
Spearman is exactly 1. A single wild outlier drops Pearson sharply and leaves Spearman
untouched. Both are correct answers to different questions.

### Outliers

```ts
sales.outliers("revenue"); // IQR fences, k = 1.5
sales.outliers("revenue", { threshold: 3 }); // Tukey's "extreme" fence
sales.outliers("revenue", { method: "zscore" }); // |z| > 3
```

IQR is the default because it assumes nothing about the distribution. A z-score threshold
assumes roughly normal data and, on a skewed column, flags the long tail — which is often
a real feature. On the bundled sample, revenue has 4 IQR outliers with an upper fence of
`1903.9875`.

One trap worth knowing: a single extreme value inflates the standard deviation enough to
hide itself. For `[1, 2, 3, 4, 5, 6, 7, 8, 9, 100]` the z-score of `100` is `2.836` —
under a threshold of 3 — so the z-score method finds nothing while IQR finds it. This is
arithmetic, not a bug, and it is why IQR is the default.

An outlier is not an error. It is a value that is unusual relative to its neighbours, and
the usual right response is to look at it.

### Shape

`skewness` and `kurtosis` use the bias-corrected sample formulas (the ones `pandas` and
`scipy.stats` report with `bias=False`), not the raw moment ratios. Kurtosis is reported as
**excess**: a normal distribution is `0`, not `3`, so the number reads as "heavier or
lighter than normal" without a mental subtraction.

Both return `null` below their minimum sample size — three values for skewness, four for
kurtosis — and for a constant column.

### Scaling helpers

```ts
standardize([1, 2, 3]); // z-scores: [-1, 0, 1]
normalize([1, 2, 3]); // [0, 0.5, 1]
normalize([1, 2, 3], { min: -1, max: 1 }); // [-1, 0, 1]
normalize([-2, 1, 2], { method: "maxabs" }); // [-1, 0.5, 1]
```

`standardize` is `zScores` under its other name. `normalize` maps the observed range onto a
target range, or divides by the largest absolute value. Both return `null` for every value
when the scale is undefined — an empty column, a constant column, or an all-zero column
under `maxabs` — rather than dividing by zero.

Both are sensitive to a single extreme value, which compresses everything else toward one
end. That is a property of the transformation, not a defect, and it is why `standardize` is
often the better choice.

### Adding scores as a column

```ts
sales.withZScores("revenue"); // adds revenue_z, aligned to rows
sales.withZScores("revenue", "rev_z"); // custom name
```

The source dataset is unchanged. A constant source column produces an all-null score
column, so the scaling failure is visible in the data rather than silently absent.

### Verification

The formulas are cross-checked against `numpy` and `scipy.stats` on fixed fixtures:
`np.cov`, `np.corrcoef`, `scipy.stats.spearmanr`, `scipy.stats.skew(bias=False)`, and
`scipy.stats.kurtosis(bias=False)`. Ties in Spearman use average ranks, which is what
`scipy.stats.spearmanr` does.

The standalone functions are exported for use outside a dataset: `covariance`,
`pearsonCorrelation`, `spearmanCorrelation`, `correlationMatrix`, `zScores`, `standardize`,
`normalize`, `percentileRank`, `skewness`, `kurtosis`, `fiveNumberSummary`, and
`detectOutliers`.

## Metrics

A metric is a named calculation that keeps its definition. The number travels with an
account of how it was produced, so it can be printed, grouped, compared, and recalculated
later.

```ts
const revenue = data.createMetric({
  name: "Total Revenue",
  column: "revenue",
  aggregation: "sum",
  format: { prefix: "$", decimals: 2, unit: "currency" },
});

revenue.name; // "Total Revenue"
revenue.value; // 31122.690000000002
revenue.definition; // 'sum("revenue")'
revenue.metric; // { value, rows: 50, values: 50, reason: null }
```

`metric` reports the rows the calculation ran over and the present values it saw. When the
two differ, the column has gaps, and the aggregation skipped them rather than counting them
as zero.

### Grouped metrics

Pass `groupBy` to compute the metric per group. Groups appear in first-appearance order of
their key, so output is deterministic.

```ts
const byRegion = data.createMetric({
  name: "Revenue",
  column: "revenue",
  aggregation: "sum",
  groupBy: ["region"],
});

byRegion.byGroup().groups; // [{ key: { region: "North" }, value: 6058.01, rows: 13, ... }, ...]
byRegion.toDataset().columns; // ["region", "Revenue"]
```

### Custom calculations

Supply `fn` instead of `aggregation`. With a `column`, the callback receives that column's
present values. Without one, it receives the whole row set.

```ts
const spread = data.createMetric({
  name: "Revenue range",
  column: "revenue",
  fn: (values) => Math.max(...(values as number[])) - Math.min(...(values as number[])),
});

const rows = data.createMetric({
  name: "Rows",
  fn: (rows) => rows.length,
});
```

### Recalculation and comparison

```ts
const north = data.filter((row) => row.region === "North");
const scoped = revenue.recalculate(north.data, north.columns);
scoped.value; // a smaller total, over 13 rows

revenue.compare({ to: scoped.metric, label: "North" });
// { difference, ratio, percentChange, percentDifference, reason: null }
```

`compare` returns `reason: "not-numeric"` when either side is not a number, and
`reason: "zero-baseline"` when the baseline is zero, rather than producing `Infinity`.

Two percentage fields, and they differ. For a metric that doubled, baseline `100` to `200`:

| Field               | Formula                            | Result |
| ------------------- | ---------------------------------- | ------ |
| `percentChange`     | `value / otherValue * 100`         | `200`  |
| `percentDifference` | `(value - otherValue) / otherValue * 100` | `100`  |

`percentChange` predates `percentDifference` and reports the new value as a percentage of
the baseline, which reads oddly for a field called "change". It is retained unchanged for
compatibility; prefer `percentDifference` in new code.

Metric aggregations delegate to the same primitives `groupBy().aggregate()` uses, so a
metric and a grouped aggregation over the same column cannot disagree.

## Insights

`Dataset.insights()` reports defensible observations, each with the values behind it. It
never generates a narrative the data does not support, and a check that cannot run is
listed in `skipped` with a reason rather than being silently omitted.

```ts
const report = data.insights();

report.insights; // Insight[]
report.skipped; // { kind, reason, columns }[]
report.truncated; // how many were dropped by maxInsights
report.thresholds; // the defaults actually used
```

Each insight has `kind`, `severity`, `title`, `detail`, `evidence`, and `columns`. The
`detail` is a plain sentence built from `evidence`; nothing is rendered.

| `kind`             | What it reports                                                |
| ------------------ | -------------------------------------------------------------- |
| `missing-data`     | Columns with absent values, as a count and share               |
| `outliers`         | Values outside the IQR fences, with the fences themselves      |
| `correlation`      | Numeric pairs at or above `strongCorrelation`                  |
| `category-extreme` | Highest and lowest group means for each category               |
| `group-change`     | The widest gap between comparable groups                       |
| `dominance`        | A category value holding at least `dominanceShare` of rows     |
| `trend`            | Monotonic movement of a measure over a date or datetime column |

### Thresholds and their defaults

| Option              | Default | Meaning                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| `strongCorrelation` | `0.7`   | Minimum \|r\| to report a relationship                     |
| `dominanceShare`    | `0.5`   | Share one value needs to count as dominant                 |
| `outlierThreshold`  | `1.5`   | IQR fence multiplier (Tukey's convention)                  |
| `trendStrength`     | `0.7`   | Minimum \|rho\| against time for a trend                   |
| `minGroupSize`      | `3`     | Rows a group needs before its mean is ranked               |
| `maxCategoryRatio`  | `0.5`   | Highest distinct-to-rows ratio still treated as a category |
| `minRelativeGap`    | `0.25`  | Smallest gap worth reporting, as a fraction of the range   |
| `maxInsights`       | `50`    | Maximum insights returned                                  |
| `minTrendPoints`    | `4`     | Distinct timestamps a trend needs                          |

### What it refuses to claim

- **No significance.** The correlation detail says so explicitly. There is no p-value
  anywhere, and `strongly` is only used at the conventional 0.7 even if you lower the
  reporting threshold.
- **No identifier rankings.** A near-unique text column such as an order id is excluded as a
  grouping dimension, because ranking one-row groups would describe a single row as a
  category.
- **No noise as findings.** A group gap is measured against the measure's observed range, so
  a difference of 0.17 on a 1-to-7 scale is not reported.
- **No silent omissions.** `skipped` explains every check that could not run, so an empty
  `insights` array is distinguishable from a check that never executed.

## Conditional columns

`addConditionalColumn()` builds a column from ordered rules. The first rule whose `when`
returns `true` supplies the value, so later rules only see rows earlier rules did not
claim.

```ts
const banded = data.addConditionalColumn(
  "category",
  [
    { when: (row) => Number(row.age) < 18, then: "Child" },
    { when: (row) => Number(row.age) < 65, then: "Adult" },
    { when: (row) => Number(row.age) >= 65, then: "Elder" },
  ],
  { else: "Unknown" },
);
```

`then` and `else` each accept a static value or a callback, and `else` defaults to `null`.
The value is cloned per row, so a shared object or `Date` is never aliased.

`addColumn()` is unchanged. The difference is where the branching lives: a callback has to
encode every branch, while a rule list is data that can be logged, tested, and reviewed.

### Counting rule coverage

`addConditionalColumnReport()` returns the same dataset plus per-rule match counts. A rule
that never fires is usually a predicate mistake, and the count makes that visible without
inspecting the output column.

```ts
const { dataset, report } = data.addConditionalColumnReport("band", rules, { else: "Unknown" });
report.matched; // e.g. [21, 14] — one count per rule
report.unmatched; // e.g. 15
```

### Predicates are evaluated verbatim

A `null` cell is passed through as `null`, and `null < 18` is `true` in JavaScript. A
predicate against a nullable column must test for missing first:

```ts
{ when: (row) => row.age !== null && Number(row.age) < 18, then: "Child" }
```

The library does not rewrite predicates. Silently treating a null comparison as false would
hide the caller's bug behind a plausible-looking label.

## Joins

`join()` brings columns from a related dataset. Both sources are left untouched.

```ts
const result = orders.join(customers, { on: "customer_id", how: "left" });
```

Supports `inner`, `left`, `right`, and `full`, an explicit `leftOn`/`rightOn` mapping for
differently named keys, and composite keys via an array.

Keys match by value and type, so `1` never matches `"1"`. A `null` key matches nothing by
default — the SQL reading of an unknown key — unless `nullsMatch: true` is set. A right key
column is dropped when it duplicates its left partner, since the values are equal by
definition; when the left side is absent, the key is sourced from the right row.

Only colliding non-key columns are suffixed, on both sides, so neither side silently wins.
A many-to-many join multiplies rows, so `maxRows` (default 1,000,000) turns a runaway
product into an error naming the cause.

`joinReport()` adds matched and unmatched counts for each side.

## Reshaping

`pivot()` turns long data into one column per distinct value; `melt()` does the reverse and
round trips with it.

```ts
const long = wide.melt({ idVars: "region" }); // { region, variable, value }
const back = long.pivot({ columns: "variable", values: "value" });
```

`pivot()` keeps generated columns in first-appearance order rather than sorting them, so the
result is reproducible without assuming anything about the value types. A missing
combination becomes `null`, and rows whose pivot key is missing are dropped: a missing key
has no column name to become, and a `"null"` column would invent a category. When several
rows share a cell, `aggregate` (`"first"` by default, plus `"last"`, `"sum"`, `"mean"`,
`"min"`, `"max"`, `"count"`) decides how they combine.

`concat()` stacks rows, keeping this dataset's rows first. The default `"union"` policy
takes the union of column names and fills gaps with `null`; `"strict"` rejects any
difference, which catches a schema drift a union would hide.

## Window functions

A window value depends on a row's position among its neighbours, so every window call
requires an explicit `orderBy`. Passing the order in means sorting the dataset first cannot
change the answer: the same `orderBy` always produces the same result.

```ts
const ranked = orders
  .rank("rank", { partitionBy: "store", orderBy: { column: "units", direction: "desc" } })
  .cumSum("running", "units", { partitionBy: "store", orderBy: "at" })
  .rollingMean("avg3", "units", { partitionBy: "store", orderBy: "at", window: 3 });
```

`rowNumber` numbers rows within a partition and always gives distinct values. `rank` leaves
a gap after a tie and `denseRank` does not, matching the SQL meaning of both.

`lag` and `lead` read a neighbour's value at an explicit `offset`, falling back to `fill`
(default `null`) where no such row exists. `cumSum` and `cumMean` accumulate in partition
order. `rollingSum`, `rollingMean`, `rollingMin`, `rollingMax`, and `rollingStd` use a
trailing window that ends at the current row.

A window never crosses a partition boundary: `lag` on the first row of a partition returns
`fill`, not the previous partition's last value.

Missing ordering values sort last in both directions, matching `sort()`. Ties keep their
input order, so results are stable and reproducible.

A rolling window is trailing. By default a row with fewer than `window` predecessors emits
`null` rather than an average of fewer rows than asked for; lower `minPeriods` to accept a
short leading window. `rollingStd` uses the sample divisor `n - 1`, consistent with `std`,
so a window holding one observation has no spread to report and emits `null`.

Window results are appended to the existing columns and the input row order is preserved,
even though the computation follows `orderBy`. Naming a column that already exists is an
error rather than an overwrite.

## Time series

`sortByTime()` orders by a time column, oldest first by default, with missing times last in
both directions.

`extractPeriod()` labels each row with its calendar bucket:

```ts
const weekly = orders.extractPeriod("week", "at", "week");
// week: "2026-11-02"
```

`resample()` groups rows into fixed calendar buckets and aggregates each one:

```ts
const daily = orders.resample({
  every: "day",
  timeColumn: "at",
  aggregate: { units: "sum", orders: "count" },
});
// { period: "2026-11-02", units: 42, orders: 7 }
```

Intervals are `hour`, `day`, `week`, `month`, `quarter`, and `year`. Weeks start on Monday
and quarters on the first day of months 1, 4, 7, and 10. Aggregations are `sum`, `mean`,
`median`, `min`, `max`, `count`, `first`, and `last`.

All calendar arithmetic is UTC. A `Date` is an instant, so bucketing in local time would
move rows between buckets depending on where the code runs; UTC keeps a boundary meaning the
same thing everywhere. Zone offsets in an input string are honoured, so
`2026-11-16T10:00:00+02:00` buckets as `08:00Z`. Nothing is silently converted to local
time.

`resample()` emits one row per non-empty bucket in ascending order. It does not invent a row
for an empty period: a resample summarises observations, and a zero row would assert
something the input never said. Use `resampleReport()` when you also want the count of
bucketed and dropped rows.

A row whose time is present but unparseable always throws. A row whose time is missing is
dropped by default and counted; pass `onMissingTime: "error"` to reject it instead.

## Schema validation

`validate()` checks a dataset against a schema and returns a report. Nothing throws for bad
data: a caller usually wants every problem at once, and the report names the column, the
row, and the value for each one.

```ts
const report = sales.validate({
  order_id: { type: "string", nullable: false, pattern: "[A-Z]-\\d+" },
  revenue: { type: "number", min: 0 },
  region: { type: "string", allowed: ["north", "south"] },
});

report.valid; // false
report.issueCount; // 3
report.issues[0]; // { code: "PATTERN_MISMATCH", column: "order_id", row: 5, ... }
```

Rules are `type`, `nullable`, `min`, `max`, `allowed`, `pattern`, `minLength`, `maxLength`,
and a custom `validate(value, row, index)` callback. A column listed with no rules is still
checked for presence. `validateOrThrow()` returns the dataset when it passes and throws when
it does not.

A `date` or `datetime` column accepts either a `Date` or an ISO string, because the column
holds whichever form the value arrived as. `allowed` compares by value and type, so `1` does
not satisfy `allowed: ["1"]`. `pattern` is anchored to the whole value.

`inferSchema()` derives a schema from data as a starting point:

```ts
inferSchema(sales.data, sales.columns);
// { order_id: { type: "string", nullable: false }, ... }
```

## Pipelines and lineage

A pipeline is a definition, not an execution. Building one runs nothing; `run()` executes
it. That split makes a workflow reusable and lets you inspect it before it touches data.

```ts
const workflow = pipeline({ name: "sales" })
  .load(() => loadCSV("sales.csv"), { name: "load" })
  .transform((data) => data.filter((row) => row.revenue > 0), { name: "positive" })
  .validate(schema, { name: "schema" })
  .build();

const result = await workflow.run();

result.ok; // true
result.dataset?.rowCount; // 3
result.steps; // per-step timing, rows, columns, duration
result.lineage; // columns and row count after each step
```

Steps are `load`, `transform`, `validate`, and `tap`. A step may be synchronous or
asynchronous, and the two mix freely: `run()` is always asynchronous, so adding an async
step later does not change the calling code. The report records the timing actually
observed, not what was expected.

`build()` finalizes the definition and returns the same pipeline, sealed: adding another
step afterwards throws. The point is that the object you run is the object you reviewed.
`run()` does not require it, so both styles work and produce the same result.

By default a failing step is recorded and returned with `ok: false`, along with the name and
index of the step and the steps that succeeded before it. Pass `{ throwOnError: true }` to
throw a `PipelineError` naming the step instead.

Lineage records what each step did to the table — the columns and row count after it, plus
the columns it added or removed. It lives in the report, never in the row values, so it
cannot change the shape of the data.

`describe()` renders the definition as data without running it:

```ts
const description = workflow.describe();
description.steps; // name, kind, and schema per step
description.reproducible; // false when a step holds a callback
description.nonDeterministic; // which steps those are
```

A function has no portable text form, so callback steps are reported honestly as
non-reproducible rather than serialised. Nothing in Numiq `eval`s a string.

## Scope

Implemented: import (CSV, TSV, JSON, URL, local `dataset/` files), normalization, type
casting, the `Dataset` abstraction, inspection, `filter`/`sort`/`select`/`limit`,
the preparation engine (`drop`, `rename`, `dropMissing`, `fillMissing`, `replace`,
`map`, `addColumn`, `addConditionalColumn`, `cast`, `dropDuplicates`, `sample`),
joins (`inner`, `left`, `right`, `full`, with key mapping and collision suffixes),
reshaping (`pivot`, `melt`, `concat`), window functions (`rowNumber`, `rank`,
`denseRank`, `lag`, `lead`, `cumSum`, `cumMean`, and the five `rolling*` helpers, with
partitions and explicit ordering), time-series operations (`sortByTime`, `extractPeriod`,
`resample`, `periodBuckets`), pipelines (`pipeline()` with `load`, `transform`, `validate`,
and `tap` steps, synchronous or asynchronous, with per-step reports and lineage), schema
validation (`Dataset.validate()`, `validateOrThrow()`, `validateRows()`, and
`inferSchema()`, with typed, ranged, enumerated, pattern, length, and custom checks),
structured queries
(`Dataset.query()` with typed conditions, boolean grouping, ordering, and projection),
grouping and aggregation (`Dataset.groupBy(...)` with `aggregate()`, eleven operations,
`ddof` control, and custom callbacks), descriptive statistics (`Dataset.describe()`),
advanced statistics (correlation, rank correlation, correlation matrices, z-scores,
percentile rank, outlier detection, skewness, kurtosis, five-number summaries, and
normalization helpers), metrics (`createMetric`, grouped metrics, custom calculations,
recalculation, comparison, and format hints), insights (`Dataset.insights()` with seven
checks, configurable thresholds, and evidence on every observation), table rendering, the
bundled sample dataset, the error taxonomy, and the environment split.

Deliberately not implemented: hypothesis tests and p-values, machine-learning models, and
Excel import. The architecture reserves space for them
(see `docs/architecture.md`). `Dataset` is immutable, so every transformation returns a new
`Dataset` without changing existing behaviour.

## Development

```bash
npm install
npm run verify
```

`verify` runs the typecheck, the example typecheck, lint, formatting, the cycle check, the
test suite, the build, the no-runtime-deps check, the type-contract tests, and the package
checks. It is also the `prepublishOnly` hook, so a release cannot skip it.

| Script                          | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `npm run build`                 | Compile ESM and CJS builds with declarations    |
| `npm test`                      | Run the test suite                              |
| `npm run test:watch`            | Run the test suite in watch mode                |
| `npm run typecheck`             | Type-check the source                           |
| `npm run typecheck:examples`    | Type-check the runnable examples                |
| `npm run typecheck:benchmarks`  | Type-check the benchmark suite                  |
| `npm run lint`                  | Lint `src` and `tests`                          |
| `npm run format`                | Apply Prettier                                  |
| `npm run format:check`          | Verify formatting without writing               |
| `npm run check:cycles`          | Fail on import cycles                           |
| `npm run check:no-runtime-deps` | Fail if a runtime dependency appears            |
| `npm run generate:sample`       | Regenerate the bundled sample dataset           |
| `npm run test:types`            | Check the published type contract               |
| `npm run test:package`          | Pack and verify the artifact in a real consumer |
| `npm run examples`              | Run every example against the built package     |
| `npm run bench`                 | Time the hot paths                              |
| `npm run bench:json`            | Time the hot paths and write `latest.json`      |
| `npm run verify`                | Everything above, in order                      |

See `docs/` for the architecture and API reference, and `examples/` for runnable
programs.

## Releasing

Releases follow: feature branch → PR → squash merge → annotated tag → GitHub release, with
`npm run verify` green on merged `main` before tagging.

Publishing runs in CI from `.github/workflows/publish.yml` on a `v*` tag, authenticating to
npm with **OIDC trusted publishing** — there is no npm token in the repository or in
Actions secrets. Provenance is attached automatically. The workflow refuses to publish
unless the tag matches `package.json` and the tagged commit is an ancestor of `main`.

A maintainer must authorise the trusted publisher once on npmjs.com; see
[`AGENTS.md`](AGENTS.md). Local `npm publish` also still works for an authorised maintainer
with 2FA, and honours `publishConfig.access: public`.

## License

MIT
