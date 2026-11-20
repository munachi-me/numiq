# Changelog

All notable changes to Numiq are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.3.0] - 2026-11-20

`Dataset` becomes a preparation engine. Ten new methods clean, reshape, and derive data
without ever touching the source dataset.

### Added

- `drop(columns)` removes columns, keeping the remaining ones in their original order.
- `rename(mapping)` renames columns in place, preserving each column's position and
  every value it holds.
- `dropMissing(options?)` removes rows with missing cells. `how: "any"` (default) drops a
  row when any considered cell is missing; `how: "all"` drops only when every considered
  cell is.
- `fillMissing(strategyOrMapping)` fills gaps with `"mean"`, `"median"`, `"mode"`, a
  constant, or a `(row, index) => value` callback. One strategy applies to every column, or
  a per-column mapping narrows it.
- `replace(rules)` replaces values per column. Rules match by value (`{ from, to }`,
  where `from` may be a list), by predicate (`{ match, to }`), or by transformation
  (`(value, context) => value`). Rules apply in order.
- `map(column, callback)` transforms one column from `(value, row, index)`.
- `addColumn(name, callbackOrValues)` appends a computed column or a value list.
- `cast(schema)` converts columns to explicit types, reusing the loader's type names,
  aliases, and `{ type, format }` descriptors.
- `dropDuplicates(columns?)` keeps the first row of each distinct combination.
- `sample(count, options?)` draws rows, deterministically when `seed` is supplied.
- Exported types: `DropMissingOptions`, `FillStrategy`, `FillValue`, `ReplaceContext`,
  `ReplaceRule`, `SampleOptions`.

### Changed

- Derived datasets now inherit the normalization policy explicitly, so a chain built from
  a cast import keeps its policy.

### Fixed

- `sample` reports an empty dataset before it reports a too-large count, so drawing from
  nothing names the real problem.

### Notes

- Missing-value strategies never coerce. `"mean"` and `"median"` require a numeric column
  and throw `ValidationError` on text rather than parsing it. A column with no present
  values is left untouched instead of being filled with a fabricated value.
- Equality in `replace` and `dropDuplicates` compares by value and type, so `1` never
  matches `"1"`. `null` and `undefined` are treated as the same missing value.
- Callback failures raise `ValidationError` naming the operation, row, and column, with the
  original error attached as `cause`.
- Every method returns a new `Dataset`; prepared datasets report `importReport === null`.

## [0.2.0] - 2026-11-20

Local data loading becomes a one-line operation, and `Dataset` gains the first
transformations.

### Added

- Local files are read from a `dataset/` folder in the project root, by filename only:
  `loadCSV("sales.csv")` reads `<cwd>/dataset/sales.csv`. The same applies to `loadJSON`
  and `loadTSV`.
- `datasetDir` loader option for scripts that do not run from the project root.
- `useSampleDataset()`, a bundled 50-row, 7-column sales table that needs no files on
  disk and returns identical data on every call.
- `Dataset.filter()`, `Dataset.sort()`, `Dataset.select()`, and `Dataset.limit()`. Each
  returns a new `Dataset`, so they chain.
- `SortDirection` type (`"asc" | "desc"`).

### Changed

- **Breaking:** local loading no longer accepts arbitrary paths. Absolute paths, `..`,
  any path separator, and symlinks that resolve outside `dataset/` are rejected with
  `ValidationError` or `ImportError`. Pass a URL, `Blob`, or in-memory value for data
  that lives elsewhere.
- Derived datasets (`head`, `tail`, `filter`, `sort`, `select`, `limit`) report
  `importReport` as `null` rather than the source import's report.

### Fixed

- `loadURL` no longer hangs when a response body stalls. The timeout now covers reading
  the body, not only receiving the headers.
- CSV delimiter detection samples the rows after `skipRows`, so a preamble that uses a
  different separator can no longer corrupt the parse.
- `columns`, `schema`, `importReport`, and `metadata` are frozen; pushing to `columns`
  previously desynchronised `columnCount`.
- Dataset rows are frozen too. A `filter` predicate that assigned to its row argument
  previously rewrote the dataset's own data, so filtering could silently change the
  source instead of only selecting from it.
- `inferColumnType` and `describeColumn` are no longer exported; they were internal
  helpers that leaked into the public surface without appearing in the default
  namespace.
- Build and test scripts use `fileURLToPath` instead of `import.meta.dirname`, which
  needs Node 20.11 but was used in a package that supports Node 18.

### Notes

- `sort` is total and deterministic: missing values sort last in both directions,
  numbers and dates compare numerically, other values compare as text, and ties keep
  their original order.

## [0.1.0] - 2026-11-20

The import and dataset foundation. This is the first release.

### Added

- `createDataset()` accepting records, column-oriented parallel arrays, or an existing
  `Dataset`.
- `Dataset` with `columns`, `data`, `shape`, `rowCount`, `columnCount`, `length`, `empty`,
  `name`, `metadata`, `dtypes`, `schema`, and `importReport`.
- Inspection: `head()`, `tail()`, `info()`, `column()`, `distinct()`, `unique()`.
- Table rendering via `table()`, `toTable()`, `display()`, and standalone `renderTable()`.
- Importers: `loadCSV()`, `loadTSV()`, `loadJSON()`, `loadURL()`, and the synchronous
  `parseDelimited()` and `parseJSON()`.
- Sources: file paths (Node), http(s) URLs, `Blob`/`File`, `ArrayBuffer`, and
  `Uint8Array`.
- Normalization policy with opt-in null markers, plus explicit type casting through a
  `schema` option supporting `string`, `number`, `integer`, `boolean`, `date`,
  `datetime`, and `time`.
- A frozen import report recording format, source, counts, per-column missing values,
  warnings, and the normalization policy applied.
- Error taxonomy: `NumiqError`, `ValidationError`, `ImportError`, `FormatError`,
  `EnvironmentError`, `ColumnNotFoundError`, each with a stable `code`.
- ESM and CommonJS builds with declarations, and a browser entry free of Node built-ins.
- Default and named exports, kept identical.

### Notes on data preservation

Several behaviours differ from the earlier Numeriq prototype on purpose, because the
prototype silently lost or corrupted data:

- `NA`, `N/A`, and `null` are no longer treated as missing by default. They are data.
  Opt in with `normalization: { nullValues: [...] }`.
- Integers beyond `Number.MAX_SAFE_INTEGER` are kept as strings with an `unsafe-integer`
  warning rather than being rounded.
- Values beginning with `+`, and values with leading zeros, stay strings so phone numbers
  and identifiers survive.
- A stray double quote inside an unquoted field is literal text, not a parse failure.
- `\r\n` inside quoted fields is normalized to `\n`, so CRLF and LF sources agree.
- Delimiter detection samples several lines, so a preamble line cannot mislead it.

### Not included

Excel import, filtering, sorting, grouping, aggregation, descriptive statistics, joins,
metrics, and Numviz integration. See `README.md` and `docs/architecture.md`.
