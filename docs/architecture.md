# Architecture

This document describes how Numiq v0.9.0 is organised, why it is organised that way, and
where the remaining capabilities attach.

## Design principles

1. **Immutable datasets.** A `Dataset` never changes after construction. Every operation
   that produces a subset returns a new `Dataset`. This makes datasets safe to share,
   cache, and pass across module boundaries, and it means future transformations can be
   added without breaking existing behaviour.
2. **Separate I/O from parsing.** `parseDelimited` and `parseJSON` are pure, synchronous
   functions over text. `loadCSV`, `loadJSON`, `loadTSV`, and `loadURL` handle I/O and
   delegate parsing. This keeps the parsing logic testable without files, network, or
   mocks, and it lets the same parser serve Node, browsers, and tests.
3. **Conservative normalization.** Coercion destroys data silently. Numiq converts only
   what is unambiguous, and records a warning whenever it declines to convert.
4. **Explicit failure.** Every error is a typed class with a stable code. Structural
   problems throw; recoverable problems become warnings in the import report.
5. **Environment split by module, not by runtime check.** The browser entry has no Node
   built-ins at all, so bundlers never need polyfills and a missing capability surfaces as
   an actionable error rather than a bundler failure.

## Module map

```
src/
├── index.ts                  browser-safe entry point (no node: imports)
├── node.ts                   Node entry point; installs the file reader
├── core/
│   ├── dataset.ts            Dataset class, createDataset
│   ├── schema.ts             type inference and column description
│   ├── types.ts              public types: Row, DType, TableOptions, ...
│   ├── prepare.ts            drop, rename, fillMissing, cast, sample, ...
│   ├── query.ts              Dataset.query(), conditions, ordering, projection
│   ├── group.ts              GroupedDataset, aggregate(), mapGroups()
│   ├── aggregate.ts          sum, mean, variance, std, and the other primitives
│   ├── conditional.ts        addConditionalColumn, ordered rule evaluation
│   ├── join.ts               hash join: inner, left, right, full
│   ├── reshape.ts            pivot, melt, concat
│   └── sample.ts             the bundled sample dataset accessor
├── analytics/
│   ├── stats.ts              quantile, percentile, quartiles, iqr, mode, extremes
│   ├── describe.ts           DatasetDescription, ColumnProfile, profileColumn
│   └── advanced.ts           covariance, correlations, z-scores, outliers, shape
├── data/
│   └── sample-sales.ts       generated sample rows (see scripts/generate-sample.mjs)
├── io/
│   ├── types.ts              loader and parser option types
│   ├── loaders/
│   │   ├── loaders.ts        loadCSV / loadTSV / loadJSON / loadURL, fetch, dispatch
│   │   ├── source.ts         source resolution, format detection, browser guards
│   │   ├── fs.ts             Node-only filesystem reader
│   │   └── index.ts          internal barrel
│   ├── parsers/
│   │   ├── csv-tokenizer.ts  RFC 4180 tokenizer and delimiter detection
│   │   ├── csv.ts            delimited-text to Dataset
│   │   ├── json.ts           JSON to Dataset
│   │   └── index.ts          internal barrel
│   └── normalization/
│       ├── policy.ts         default policy and merging
│       ├── values.ts         single-cell normalization
│       ├── schema.ts         explicit type casting
│       └── report.ts         import report accumulator
├── display/
│   └── table.ts              box-drawing table renderer
├── errors/
│   └── index.ts              NumiqError and subclasses
└── utils/
    ├── values.ts             clone, freeze, stable keys, presence checks
    ├── compare.ts            the shared ordering comparator used by sort and min/max
    └── temporal.ts           ISO date/time recognition and parsing
```

## Data flow

```
source ──► loader ──► resolved text ──► parser ──► rows ──► Dataset
              │                          │
              │                          ├─ normalize cells
              └─ format detection        ├─ apply schema casts
                                         └─ accumulate report
```

The loader resolves a source to text plus whatever metadata it knows (declared format,
content type, label). The parser owns everything after that: tokenizing, header handling,
normalization, casting, and the report. The parser builds the `Dataset` through
`createNormalizedDataset`, which tells the constructor that values are already normalized
so they are not normalized twice.

## The environment split

`src/index.ts` must never import a `node:` built-in. `scripts/build.mjs` fails the build
if `dist/esm/index.js` contains one, and two tests assert the same thing — one over the
source tree, one over the packed artifact.

Filesystem access is injected rather than imported. `loaders.ts` holds a module-level
`localFileReader` that is `null` until `node.ts` calls `setLocalFileReader(readLocalFile)`.
When the reader is `null`, a local path raises an `EnvironmentError` naming the fix.

This is why `node.ts` is listed in `sideEffects`: importing it mutates loader state on
purpose. Bundlers must not tree-shake that assignment away.

## Type inference versus casting

Two different things share the word "type" in Numiq, and the distinction is deliberate.

- **Inference** (`dtypes`, `schema`) describes the values that are actually stored. It
  never changes them. A column of `"2026-01-05"` strings reports `date` while still
  holding strings.
- **Casting** (`schema` option on a loader) converts values, producing numbers, booleans,
  and `Date` objects.

Keeping them apart means `data` always shows what the source contained, and conversion
only happens when a caller asks for it.

## Where the remaining capabilities attach

Preparation, querying, grouping, descriptive statistics, advanced statistics, metrics,
insights, conditional columns, joins, and reshaping have landed. Each attaches as follows,
alongside the layers already built.

- **Preparation and transformation** are `Dataset` methods returning new datasets,
  implemented in `src/core/prepare.ts`. They needed no changes to the import layer.
- **Querying and filtering** live in `src/core/query.ts` and return a `Dataset` or plain
  values.
- **Grouping and aggregation** introduce a `GroupedDataset` in `src/core/group.ts`, holding
  keys and row indices, with aggregation methods that return a `Dataset`. The aggregation
  primitives themselves sit in `src/core/aggregate.ts`, shared with the statistics layer.
- **Statistics and metrics** live in `src/analytics/` as pure functions over column
  values, so they are testable without a `Dataset`. Descriptive statistics arrived in
  v0.6.0 this way: `src/analytics/stats.ts` holds the arithmetic and `describe.ts` adds the
  profiling layer, neither of which knows about `Dataset` internals. v0.7.0 extends the same
  pattern with `advanced.ts` for two-column statistics and distribution shape; `Dataset`
  methods are thin wrappers that extract column values and delegate. v0.8.0 adds two layers
  on top of the same primitives rather than beside them: `src/metrics/metric.ts` binds a
  definition to a calculation and delegates to `src/core/aggregate.ts`, so a metric and a
  grouped aggregation cannot diverge; `src/insights/insights.ts` reads column profiles and
  the statistics layer, then applies thresholds to decide what is worth reporting. Neither
  module imports `Dataset`; `createMetric()` and `insights()` are thin wrappers, and the
  standalone `createMetric()` and `analyze()` take rows and columns directly.
- **Conditional columns** live in `src/core/conditional.ts`. The rule list is validated in
  full before any row is evaluated, so a malformed list fails immediately instead of after
  partially processing the data, and the module returns a per-rule match count so a rule
  that never fires is observable. Like the preparation functions it takes rows and columns
  and returns new ones.
- **Joins** live in `src/core/join.ts` and build a hash index on the right side, so a
  one-to-many join is linear in the left row count rather than quadratic. The module
  decides the output column plan before emitting a single row, which is what lets a
  collision be suffixed consistently and a duplicate column name be rejected up front.
- **Reshaping** lives in `src/core/reshape.ts`. `pivot()` orders generated columns by first
  appearance rather than by sort, so the result does not depend on the value types, and
  `pivot()`/`melt()` round trip through the same plain `{ rows, columns }` shape every other
  primitive uses.
- **Numviz integration** (§12) is a boundary, not a dependency: a separate export subpath
  that converts a `Dataset` into whatever shape Numviz consumes. Numiq must not depend on
  a visualisation library.

Each layer landed without changes to the import layer or the `Dataset` invariants, which is
what the split was for. Window functions and the Numviz subpath attach the same way.

## Testing strategy

- `tests/unit/` — parsers, tokenizer, normalization, dataset, table, errors, public API,
  preparation, querying, grouping and aggregation, descriptive statistics, advanced
  statistics, metrics, insights, conditional columns, joins, and reshaping.
- `tests/integration/` — loaders against a real HTTP server and a real temporary
  directory; the environment split in a separate process; and one suite per release
  (`v020` … `v090`) that exercises that release's public API end to end.
- `tests/types/` — a compile-time contract for the published declarations, including
  negative assertions that invalid usage fails to compile.
- `scripts/test-package.mjs` — packs the tarball, installs it into a throwaway consumer,
  and exercises ESM import, CJS require, and the browser condition.

No mocks are used. The HTTP tests run a real server on an ephemeral port, and the file
tests use a real temporary directory. The statistical formulas are checked against
reference values computed with `numpy` and `scipy.stats`, recorded in the test file, so a
failure means drift from the reference rather than a transcription error.
