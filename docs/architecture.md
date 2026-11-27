# Architecture

This document describes how Numiq is organised, why it is organised that way, and
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
│   ├── window.ts             ranking, offsets, running and moving values
│   ├── timeseries.ts         sortByTime, extractPeriod, resample, period bucketing
│   ├── validation.ts         schema rules, per-cell checks, validation reports
│   ├── pipeline.ts           Pipeline, pipeline(), step execution and lineage
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

Filesystem access is bound per entry point rather than imported. `loaders.ts` exports
`createFileLoaders(getReader)`, which captures the reader in a closure. `node.ts` builds
`loadCSV`, `loadJSON`, and `loadTSV` around `readLocalFile`; `index.ts` builds them around
`() => null`, so a local path raises an `EnvironmentError` naming the fix.

The reader must not live in module-level state. Both entry points resolve to the same
module instance, so a shared mutable reader would let importing `node.ts` grant filesystem
access to the `@munachi-me/numiq/core` entry — making a documented guarantee depend on
import order. A test imports the Node entry first and asserts the core entry still refuses
local filenames.

## Type inference versus casting

Two different things share the word "type" in Numiq, and the distinction is deliberate.

- **Inference** (`dtypes`, `schema`) describes the values that are actually stored. It
  never changes them. A column of `"2026-01-05"` strings reports `date` while still
  holding strings.
- **Casting** (`schema` option on a loader) converts values, producing numbers, booleans,
  and `Date` objects.

Keeping them apart means `data` always shows what the source contained, and conversion
only happens when a caller asks for it.

## The execution model

Numiq does not build a query plan, and that is a decision rather than an omission.

Every transform is a direct loop over the current rows that produces a new frozen array.
`filter` walks once; `join` builds one hash index on the smaller side and probes it;
`groupBy(...).aggregate(...)` buckets once and folds each bucket. There is no intermediate
representation, no cost model, and no optimizer to disagree with the caller about what a
chain means.

The trade-off is explicit. An optimizer can beat hand-written loops on large joins by
reordering and choosing index sides; Numiq instead asks you to order the chain, which
costs nothing to read and is predictable. Three properties follow from that choice, and
they are the ones the API is built around:

- **Predictable cost.** `filter().sort()` and `sort().filter()` do the same work in the
  same order you wrote them. There is no reordering that changes which rows survive.
- **Predictable memory.** Each step holds its input and its output. That is why chunked
  reading exists: when one step cannot fit, `chunkDelimited` and `reduceChunks` bound the
  live set to a chunk plus an accumulator, at roughly 35% more CPU than a whole-file parse.
- **Debuggable chains.** A wrong result is in the step that produced it, because nothing
  ran out of order.

The one place a plan exists is `Query`. `query()` accumulates conditions, ordering, and
projection, then executes them in one pass. It is a builder, not an optimizer: it exists so
a long filter chain compiles to a single predicate instead of one array allocation per
`filter()` call. `Pipeline` is the same idea for named steps, and adds validation and
lineage on top.

What would justify a real planner later: a join where neither side fits in memory, or a
chain that repeatedly re-reads the same column. Neither is in scope for 2.0.0, and adding a
cost model before those cases exist would make the common path slower and the semantics
harder to predict.

## The Numviz interchange contract

Numviz reads datasets; Numiq does not know Numviz exists. The boundary is one function,
`toInterchange(dataset)`, and its output is a versioned, JSON-safe value. Anything that
produces that shape can feed Numviz, and anything that reads it can be fed by Numiq.

The payload:

```ts
{
  format: "numiq.table",   // literal; a consumer checks this first
  version: 1,              // integer; bumped only when the shape changes
  name: string,
  columns: ColumnDescriptor[],   // { name, type, nullable, role }
  rows: (unknown)[][],           // row-major, aligned with columns
  rowCount: number,
  columnCount: number,
  missingValue: null,            // always null; never undefined or NaN
  metadata: Record<string, unknown>,
}
```

Four decisions make it a contract rather than a dump of internals:

- **`missingValue` is always `null`.** `undefined` disappears through `JSON.stringify`,
  and `NaN` is not valid JSON. A consumer that receives a payload can treat `null` as the
  only absent-value marker without checking the source.
- **`role` classifies, it does not measure.** `measure` for numeric dtypes, `temporal` for
  date and time, `dimension` for everything else. A chart picks axes from roles; it never
  has to parse a dtype string or guess whether a string column is a category.
- **`version` is checked, not assumed.** `isInterchangePayload` narrows to a payload this
  release can read and rejects a future version rather than misreading it.
- **`rows` is row-major and dense.** Every row has exactly `columnCount` cells, so a
  consumer indexes by position without a header lookup per cell.

The inverse, `fromInterchange`, accepts anything `isInterchangePayload` narrows, so a
round trip through JSON preserves values and column order. Column *types* are re-inferred
from the values rather than trusted from the payload: the payload is data, and a declared
type that disagrees with the cells would otherwise smuggle a wrong type into the dataset.

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
- **Window functions** live in `src/core/window.ts`. Every entry point resolves one shared
  ordering plan — partitions first, then the ordered row indices — so `rowNumber`, `rank`,
  and the rolling helpers cannot disagree about what "previous" means. Ordering is a
  required argument rather than an implicit read of the dataset's current row order, which
  keeps a result reproducible: sorting first cannot change the answer.
- **Time series** live in `src/core/timeseries.ts`. `periodStart` is the single place that
  decides where a bucket begins, and `extractPeriod`, `resample`, and `periodBuckets` all
  derive their labels from `periodLabel`, so a row's label always matches the bucket
  `resample` would group it into. Calendar arithmetic is UTC because a `Date` is an
  instant; bucketing in local time would move rows between buckets by host timezone.
- **Schema validation** lives in `src/core/validation.ts` and is the one layer that reads a
  dataset without producing a new one: it takes rows and columns, returns a report, and
  copies nothing. It imports `inferColumnType` from `schema.ts` only so `inferSchema()`
  agrees with the dtype the rest of the package reports. Two decisions are worth naming.
  Temporal checks accept either a `Date` or an ISO string, because a `date` column holds
  whichever form the data arrived as and rejecting one would make validation depend on the
  import path. And `allowed` uses strict value-and-type equality rather than the shared
  `compareValues` comparator, which orders by text as a fallback and would call `1` equal
  to `"1"` — correct for sorting, wrong for an allow-list.
- **Pipelines** live in `src/core/pipeline.ts` and sit above `Dataset` rather than inside
  it: a step is a function the caller supplies, so the module never needs to know what a
  step does. Two properties follow from treating a pipeline as a definition rather than an
  execution. Building one runs nothing, which is what makes `describe()` possible and makes
  a pipeline safe to construct at module load. And steps are awaited uniformly, so a
  synchronous step and an asynchronous one are the same to the caller; the report records
  which actually happened rather than assuming. Lineage is computed from the columns before
  and after each step and returned in the report, never written into row values, so it
  cannot change the shape of the data. A step holding a callback is reported as
  non-reproducible rather than serialised: there is no honest text form for a function, and
  the alternative would be `eval`.
- **Numviz integration** (§12) is a boundary, not a dependency: a separate export subpath
  that converts a `Dataset` into whatever shape Numviz consumes. Numiq must not depend on
  a visualisation library.

Each layer landed without changes to the import layer or the `Dataset` invariants, which is
what the split was for. The Numviz subpath attaches the same way.

## Testing strategy

- `tests/unit/` — parsers, tokenizer, normalization, dataset, table, errors, public API,
  preparation, querying, grouping and aggregation, descriptive statistics, advanced
  statistics, metrics, insights, conditional columns, joins, reshaping, window functions,
  time series, schema validation, and pipelines.
- `tests/integration/` — loaders against a real HTTP server and a real temporary
  directory; the environment split in a separate process; and one suite per release
  (`v020` … `v0100`) that exercises that release's public API end to end.
- `tests/types/` — a compile-time contract for the published declarations, including
  negative assertions that invalid usage fails to compile.
- `scripts/test-package.mjs` — packs the tarball, installs it into a throwaway consumer,
  and exercises ESM import, CJS require, and the browser condition.

No mocks are used. The HTTP tests run a real server on an ephemeral port, and the file
tests use a real temporary directory. The statistical formulas are checked against
reference values computed with `numpy` and `scipy.stats`, recorded in the test file, so a
failure means drift from the reference rather than a transcription error.
