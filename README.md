# Numiq

A modular TypeScript engine for loading, normalizing, preparing, querying, and
profiling structured data.

Numiq v0.6.0 reads CSV, TSV, and JSON from files, URLs, and in-memory buffers,
normalizes the values, and gives you an immutable `Dataset` you can inspect, filter,
sort, prepare, query, summarize, and render as a table.

```ts
import { loadCSV } from "numiq";

const data = await loadCSV("sales.csv"); // reads ./dataset/sales.csv

data.shape;        // [2, 2]
data.columns;      // ["product", "amount"]
data.table();      // a box-drawing table

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
npm install numiq
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
import { loadCSV, loadJSON, loadTSV } from "numiq";

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
import { useSampleDataset } from "numiq";

const sample = await useSampleDataset();

sample.shape;   // [50, 7]
sample.table();
```

The sample is a fixed 50-row sales table that ships inside the package, so it works
without creating a `dataset/` folder and is identical on every call.

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

Transformation methods return a new `Dataset`, so they chain:

| Method | Description |
| --- | --- |
| `filter(predicate)` | Rows where `predicate(row, index)` is true |
| `sort(column, direction?)` | Sorted copy; `direction` is `"asc"` (default) or `"desc"` |
| `select(columns)` | Only the named columns, in the requested order |
| `limit(count)` | At most `count` rows from the start |

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

| Method | Description |
| --- | --- |
| `drop(columns)` | Remove columns, keeping the rest in order |
| `rename(mapping)` | Rename columns in place, preserving position and values |
| `dropMissing(options?)` | Drop rows with missing cells (`how: "any"` by default) |
| `fillMissing(strategyOrMapping)` | Fill gaps with `"mean"`, `"median"`, `"mode"`, a constant, or a callback |
| `replace(rules)` | Replace values per column, by value, predicate, or callback |
| `map(column, callback)` | Transform one column from `(value, row, index)` |
| `addColumn(name, callbackOrValues)` | Append a computed column or a value list |
| `cast(schema)` | Convert columns to explicit types |
| `dropDuplicates(columns?)` | Keep the first row of each distinct combination |
| `sample(count, options?)` | Draw rows; deterministic when `seed` is given |

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

| Operator | Meaning |
| --- | --- |
| `=`, `!=`, `>`, `>=`, `<`, `<=` | Comparison, by value and type |
| `in`, `notIn` | Membership in a non-empty array |
| `between` | Inclusive range, given as `[low, high]` |
| `contains`, `startsWith`, `endsWith` | Substring tests on text |
| `isNull`, `isNotNull` | Missing-value tests |

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

Local filenames are resolved against the `dataset/` folder in the current working
directory and are confined to it: absolute paths, `..`, path separators, and symlinks
that resolve outside the folder are all refused.

CommonJS consumers can `require("numiq")`; the `require` condition resolves to a
CommonJS build.

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
sales.describe().table();         // one row per column
sales.describe({ ddof: 0 });      // every column, population formula
sales.describe("revenue").mean;   // a single profile
sales.describe().get("revenue");  // the same profile, by name
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

| Statistic | numeric | boolean | temporal | text | mixed |
| --- | --- | --- | --- | --- | --- |
| count, missing, unique, mode, min, max | yes | yes | yes | yes | yes |
| sum, mean, median, quartiles, iqr, variance, std, range | yes | `null` | `null` | `null` | `null` |

`variance` and `std` default to the sample formula (`ddof: 1`); pass `ddof: 0` for the
population formula. Every profile records the `ddof` it used, so a result is never
ambiguous about which formula produced it. Percentiles are interpolated with the same
method as `numpy.percentile` and R's `quantile(type = 7)`.

```ts
const profile = sales.describe("revenue", { ddof: 0, percentiles: [10, 90] });
profile.std;                  // 657.3298, the population standard deviation
profile.percentiles.p90;      // 1631.1600000000003
```

The description is an analytical result, not a `Dataset`. Call `toDataset()` when you need
tabular output with every statistic — including any requested percentiles, which become
columns named after their keys — for example to feed a chart:

```ts
sales.describe({ percentiles: [90] }).toDataset().select(["name", "kind", "mean", "p90"]);
```

Percentiles are interpolated in floating point, so a value like `1631.1600000000003` is
expected rather than a sign of a bug. `table()` rounds for display; the numbers above are
the full-precision values on `profiles`.

The standalone statistics are exported too, for use outside a dataset:
`quantile`, `percentile`, `quartiles`, `iqr`, `mode`, `range`, and `extremes`.

## Advanced statistics

Correlation, distribution shape, position, and outliers. Every function returns a typed
result rather than a bare number where the answer needs context.

```ts
sales.correlation("quantity", "revenue");      // { r: 0.43724861958188593, n: 50, reason: null }
sales.rankCorrelation("quantity", "revenue");  // { r: 0.5244511749947358, n: 50, reason: null }
sales.correlationMatrix();                     // every numeric column, symmetric
sales.zScores("revenue");                      // { values, mean, std, reason }
sales.outliers("revenue");                     // Tukey's fences by default
sales.fiveNumberSummary("revenue");
sales.skewness("revenue");                     // 1.7133020612357541
sales.kurtosis("revenue");                     // 2.3952120604810103 (excess)
```

### Undefined is `null`, never `NaN` or `0`

A coefficient that does not exist for the data returns `null` with a `reason`, so a caller
can branch on it:

| Situation | Result |
| --- | --- |
| fewer than two complete pairs | `{ r: null, n, reason: "insufficient-data" }` |
| one column is constant | `{ r: null, n, reason: "zero-variance" }` |
| both columns vary | `{ r: number, n, reason: null }` |

`NaN` would silently poison downstream arithmetic; `0` would claim "no relationship" when
the honest answer is "cannot be computed".

### Missing values are handled pairwise

`covariance` and the correlations use only the rows where *both* columns are present.
A row missing either coordinate cannot contribute to a relationship, and imputing one would
invent data. Consequently `n` can differ between pairs, and every result reports the `n` it
used so this stays visible.

### No significance claims

The correlation results carry `r`, `n`, and `reason` — and nothing else. There is no
p-value and no "significant" flag. Deciding whether a relationship is real needs a test
with its own distributional assumptions, and a bare `r` from nine points looks identical
to one from nine thousand. Ship the number, not a verdict.

### Correlation method choice

| Method | Measures | Use when |
| --- | --- | --- |
| Pearson (`correlation`) | linear association | both columns are roughly continuous and outlier-free |
| Spearman (`rankCorrelation`) | any monotonic association | data is skewed, has outliers, or is ordinal |

Pearson on `[1..5]` against `[1, 8, 27, 64, 125]` (a perfect cubic) is well under 1;
Spearman is exactly 1. A single wild outlier drops Pearson sharply and leaves Spearman
untouched. Both are correct answers to different questions.

### Outliers

```ts
sales.outliers("revenue");                            // IQR fences, k = 1.5
sales.outliers("revenue", { threshold: 3 });          // Tukey's "extreme" fence
sales.outliers("revenue", { method: "zscore" });      // |z| > 3
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
standardize([1, 2, 3]);                          // z-scores: [-1, 0, 1]
normalize([1, 2, 3]);                            // [0, 0.5, 1]
normalize([1, 2, 3], { min: -1, max: 1 });       // [-1, 0, 1]
normalize([-2, 1, 2], { method: "maxabs" });     // [-1, 0.5, 1]
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
sales.withZScores("revenue");            // adds revenue_z, aligned to rows
sales.withZScores("revenue", "rev_z");   // custom name
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

## Scope of v0.7.0

Implemented: import (CSV, TSV, JSON, URL, local `dataset/` files), normalization, type
casting, the `Dataset` abstraction, inspection, `filter`/`sort`/`select`/`limit`,
the preparation engine (`drop`, `rename`, `dropMissing`, `fillMissing`, `replace`,
`map`, `addColumn`, `cast`, `dropDuplicates`, `sample`), structured queries
(`Dataset.query()` with typed conditions, boolean grouping, ordering, and projection),
grouping and aggregation (`Dataset.groupBy(...)` with `aggregate()`, eleven operations,
`ddof` control, and custom callbacks), descriptive statistics (`Dataset.describe()`),
advanced statistics (correlation, rank correlation, correlation matrices, z-scores,
percentile rank, outlier detection, skewness, kurtosis, five-number summaries, and
normalization helpers), table rendering, the bundled sample dataset, the error taxonomy,
and the environment split.

Deliberately not in v0.7.0: hypothesis tests and p-values, machine-learning models, joins,
metrics, and Excel import. The architecture reserves space for them (see
`docs/architecture.md`). `Dataset` is immutable, so every transformation returns a new
`Dataset` without changing existing behaviour.

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
