# Changelog

All notable changes to Numiq are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
