# Changelog

All notable changes to Numiq are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-11-23

### Added

- `MetricComparison.percentDifference`: the conventional
  `(value - otherValue) / otherValue * 100`, so a doubling reports `100`. `percentChange`
  is unchanged at `200` for the same comparison; it reports the new value as a percentage
  of the baseline, which is not what its name suggests. Both are documented side by side.

### Fixed

- `parseDelimited` now validates `format` instead of failing obscurely. Omitting the
  options object threw a bare `TypeError` from reading `.delimiter` off `undefined`, and
  passing `{}` parsed successfully while labelling the report `format: undefined`. Both
  now throw `ValidationError` naming the expected values. `format: "json"` was also
  accepted and produced CSV rows tagged as JSON; it is now rejected, and the `format`
  parameter is typed `"csv" | "tsv"` so the mistake is caught at compile time.
- `package.json` `sideEffects` listed `./dist/{esm,cjs}/node.js`, a leftover from when the
  Node entry installed a filesystem reader into shared module state. That entry is now
  pure, so the field is `false` and bundlers can tree-shake the package freely.

### Changed

- Documentation corrections, no runtime change. The README described every failed cast as
  throwing `FormatError`; `Dataset.cast()` throws `ValidationError`, because it runs after
  the import and has no format context. The README now states both classes and notes that
  `NumiqError` catches either. It also documents that `createDataset` normalizes
  hand-built rows like a parsed file (`createDataset([{ a: "1" }])` stores `1`), with
  `normalization: { inferTypes: false }` as the opt-out.

## [1.0.4] - 2026-11-23

### Fixed

- `@munachi-me/numiq/core` no longer gains filesystem access when the Node entry is
  imported in the same process. The local file reader was module-level state in
  `loaders.ts`, and both entry points resolve to that same module instance, so
  `node.ts` installing a reader made `core.loadCSV("sales.csv")` read from disk instead
  of raising the documented `EnvironmentError`. The guarantee held only when `/core` was
  loaded first, so it depended on import order. Each entry point now binds its own reader
  in a closure, and a regression test imports the Node entry first to pin the behaviour.
  The defect predates 1.0.3; it was found while verifying that release.

## [1.0.3] - 2026-11-23

### Added

- npm **trusted publishing** via GitHub Actions OIDC. `.github/workflows/publish.yml`
  publishes on a `v*` tag with no npm token in the repository or in Actions secrets, and
  attaches provenance automatically. GitHub Packages continues to use the ephemeral
  `GITHUB_TOKEN`.
- `publishConfig.access: "public"`. Scoped packages default to restricted, so without this
  a release would have been published privately.
- README badges for the published version, CI status, and license.
- README "Releasing" section, the `@munachi-me/numiq/core` subpath, and a complete script
  table covering every `package.json` script.

### Fixed

- A `workflow_dispatch` rehearsal of an already-published version failed at npm's
  duplicate-version check, so the documented "rehearse with `dry_run`" procedure always
  reported red. A dry run now tolerates that specific error, since reaching it proves
  `prepublishOnly` ran and the tarball packed. The tolerance is gated on `--dry-run`, so a
  real publish that hits a duplicate or an auth error still fails.

### Changed

- The publish workflow checks that the OIDC token is available before doing any work, so a
  missing `id-token: write` fails in seconds rather than after the full verify run.
- `docs/compatibility.md` and `docs/architecture.md` no longer claim an older version, and
  the Node support table now records 24.x as the release-workflow version.

## [1.0.2] - 2026-11-20

### Changed

- The package is published as `@munachi-me/numiq`. npm refused the unscoped name `numiq`
  with `403 Package name too similar to existing packages umi,dumi`, a typosquatting
  guard that only runs at publish time. The API is unchanged; only the install command
  and import specifiers differ.

  ```diff
  -npm install numiq
  +npm install @munachi-me/numiq

  -import { loadCSV } from "numiq";
  +import { loadCSV } from "@munachi-me/numiq";
  ```

- `scripts/test-package.mjs` reads the package name from `package.json` and derives the
  installed path from it. Scoped packages nest under `node_modules/@scope/name`, so the
  previous hardcoded paths would have pointed at a directory that does not exist.

## [1.0.1] - 2026-11-20

### Fixed

- `npm publish --dry-run` failed in `prepublishOnly`. `npm publish` exports
  `npm_config_dry_run`, the package test inherited it, and its nested `npm pack` produced
  an empty tarball that `npm install` then rejected as corrupted. The release path could
  not be rehearsed, which is the one time a rehearsal matters most. The package test now
  strips the variable from the environment of its child processes.

## [1.0.0] - 2026-11-20

First stable release. The API that grew through `0.1.0`–`0.12.0` is now frozen and follows
semantic versioning: a breaking change requires a major release with a migration note.

This release adds no features. It audits what exists, documents it, proves the security
boundary with tests, and puts verification in CI.

### Added

- `docs/compatibility.md`: the semantic-versioning policy, the Node.js support matrix
  (18/20/22), and the browser and bundler support matrix.
- `docs/migration.md`: the migration guide from pre-1.0 releases, covering the two
  breaking changes made during the series.
- `.github/workflows/ci.yml`: runs `npm run verify` and a clean consumer install on
  Node 18, 20, and 22. The repository previously had no CI at all.
- Tests for the local-file security boundary, which was implemented but not covered:
  absolute paths, Windows drive paths, nested paths, null bytes, and — the case that only
  `realpath` containment catches — a symlink inside `dataset/` pointing outside it. A
  companion test pins that a symlink staying inside `dataset/` still reads.
- API documentation for seven exports that were public but undocumented: `joinTables`,
  `pivotRows`, `meltRows`, `concatRows`, `profileColumn`, `validateDescribeOptions`, and
  `DEFAULT_NORMALIZATION`. Every one of the 93 runtime exports is now documented.

### Changed

- `docs/api.md` gains a "Building blocks" section for the functions that do the work
  behind the corresponding `Dataset` methods.

### Security

- The local-file sandbox was reviewed. It rejects absolute paths, `..`, path separators on
  both platforms, null bytes, and symlinks resolving outside `dataset/`, and it checks
  containment on `realpath` results so a link cannot escape while appearing to comply.
  Behaviour is unchanged; the review found no defect, and the guarantees are now pinned by
  tests rather than assumed.

### Notes

- No public export was removed, renamed, or changed. No behaviour changed. Upgrading from
  `0.12.0` requires no code change.
- Still zero runtime dependencies, enforced in `verify`.

## [0.12.0] - 2026-11-20

Performance, measured before it was changed.

This release starts with a benchmark suite, because a change that is not measured is a
guess. `npm run bench` times the hot paths on 1,000, 25,000 and 100,000 rows, and
`benchmarks/results/` records the runs from before and after so the comparison is
reproducible rather than asserted. Only two operations moved beyond run-to-run noise;
everything else was measured and deliberately left alone.

### Added

- A benchmark suite under `benchmarks/`, run with `npm run bench`, `npm run bench:json`,
  or `npm run bench -- --filter <text>`. It times dataset construction, `data`, `schema`,
  `info()`, `filter`, `sort`, `select`, `groupBy().aggregate()`, `describe()`, `toTable()`,
  joins, CSV parsing, and a multi-step pipeline. Each case warms up first, reports the
  median of nine samples with the minimum and 95th percentile, and generates its rows from
  a seeded PRNG so runs are comparable.
- `benchmarks/README.md` documents the method, the recorded results, and the known
  performance limits.
- `npm run typecheck:benchmarks`, and a `tsconfig.benchmarks.json` so the benchmark sources
  are type-checked with the same strict settings as `src/`.

### Changed

- `describe()` is about 4x faster on numeric columns (1312ms → 326ms at 100,000 rows).
  Profiling a column used to sort it seven times — once each for the quartiles, the
  interquartile range, the median, and every requested percentile — and hashed it twice to
  answer both `unique` and `mode`. It now sorts once and hashes once, sharing both across
  every statistic. Results are unchanged; the profile is pinned against each standalone
  statistic function in the tests.
- `sort()` is about 20% faster at 100,000 rows (157ms → 125ms). The comparator read
  `row[column]` twice per comparison, roughly `n log n` times; it now reads each key once
  and compares values. Tie order still follows source order, via the language's stable
  sort.
- The join output loop resolves each column's right-hand key partner once instead of
  scanning the key list per column per row.

### Notes

- No public API was added, removed, or changed. The new statistics helpers stay internal:
  they exist to serve `describe()`, and exporting them would widen the stable surface for
  no caller benefit.
- There are still no runtime dependencies.

## [0.11.1] - 2026-11-20

Adds `Pipeline.build()`, which the v0.11.0 documentation example used but the release did
not provide.

### Added

- `Pipeline.build()` finalizes the definition and returns the same pipeline, sealed so no
  further step can be added. Building an empty pipeline throws; calling `build()` twice is
  allowed and changes nothing.
- `Pipeline.built` and `PipelineDescription.built` report whether the definition has been
  sealed, without running anything.

`run()` does not require `build()`. Both styles produce the same result, so no existing
code changes behaviour.

## [0.11.0] - 2026-11-20

Pipelines, schema validation, and data lineage: reusable workflows that can be inspected
before they run, and a validation report that points at the offending cell rather than at
the dataset as a whole.

### Added

- `pipeline(options?)` and the `Pipeline` class. A pipeline is a definition: building one
  runs nothing, and `run()` executes it. That split is what makes a workflow reusable and
  inspectable, and what lets the same object be described without side effects.
- Step kinds: `load` (produces the first dataset), `transform` (replaces it), `validate`
  (checks a schema), and `tap` (observes without replacing). Steps are named, and
  duplicate or empty names are rejected at definition time.
- `Dataset.validate(schema, options?)` returns a `ValidationReport`;
  `Dataset.validateOrThrow(...)` throws a `ValidationError` naming the first issue.
  Validation reads the dataset and never copies or modifies its rows.
- Schema rules per column: `type`, `nullable`, `min`, `max`, `allowed`, `pattern`,
  `minLength`, `maxLength`, and a custom `validate` callback. A column listed with no
  rules is still checked for presence.
- `validateRows(rows, columns, schema, options?)` and `inferSchema(rows, columns)` for
  callers working outside a `Dataset`.
- `PipelineError` with `step`, `stepIndex`, `stepKind`, and `original`, thrown from
  `run({ throwOnError: true })`. By default a failure is reported with `ok: false` instead.
- Structured execution reports: per-step timing, row and column counts, duration, and the
  error or validation report for the failing step.
- Lineage: one entry per step with the columns and row count after it, plus the columns
  that step added or removed. Lineage lives in the report and on `pipeline.lineage`, never
  in the row values.
- `Pipeline.describe()` renders the definition as data and states which steps hold
  callbacks, so it is clear what could be stored and replayed and what cannot.

### Behaviour

- Steps may be synchronous or asynchronous, and the two can be mixed in one pipeline. The
  report records the timing actually observed, so an async step that rejects is still
  labelled `async`.
- `run()` is always asynchronous, even when every step is synchronous, so adding an async
  step later does not change the calling code.
- A transform may return a `Dataset` or an array of rows. Anything else fails with a
  message naming the step and what it returned.
- Type checks for temporal columns accept both a `Date` and an ISO string, because a
  `date` column holds whichever the data arrived as. Rejecting one would make validation
  depend on the import path rather than on the data.
- `allowed` compares by value and type, so `1` never satisfies `allowed: ["1"]`. The
  general-purpose comparator treats those as equal, which would be wrong for an allow-list.
- `pattern` is anchored, so `pattern: "\\d+"` means the whole value rather than a substring
  of it.
- A custom validator that throws is reported as an issue with code
  `CUSTOM_VALIDATOR_THREW` rather than letting the exception escape mid-report.
- A malformed schema throws: an unknown type, an invalid regular expression, or
  `min` greater than `max` is a programming error, not a data problem, and reporting it as
  a per-row issue would hide it among the rows.
- Validation reports cap their issue list (`maxIssues`, default 100) and set `truncated`,
  so a badly broken dataset cannot exhaust memory by building an unbounded list.
- Pipeline definitions never execute serialised JavaScript: steps are functions supplied by
  the caller. Nothing is `eval`-ed, and callback steps are reported as non-reproducible
  rather than pretended to be serialisable.
- A stored schema is cloned at definition time, so mutating the original afterwards cannot
  change a pipeline that already exists.

### Compatibility

No new dependencies, and `src/index.ts` remains free of Node built-ins. Excel/XLS/XLSX
importing stays excluded, per the standing constraint. The version bump reflects new
public API only; no existing behaviour changed.

## [0.10.0] - 2026-11-20

Window functions and time-series operations: values that depend on a row's position among
its neighbours, and grouping by calendar intervals. Every window function requires an
explicit `orderBy`, so a result can never depend on the dataset's current row order.

### Added

- `Dataset.window(name, { partitionBy?, orderBy, fn })` and the standalone
  `windowColumn(...)` for a window value the named helpers do not cover. The callback
  receives the row, its 1-based position, its partition index, and that partition's
  ordered rows.
- Ranking: `rowNumber`, `rank`, and `denseRank`. `rank` leaves a gap after a tie and
  `denseRank` does not, matching the SQL meaning of both. `rankRows()` returns the
  ordering itself as `{ index, rank }` pairs.
- Offsets: `lag` and `lead` with an explicit `offset` and `fill`.
- Running values: `cumSum` and `cumMean`.
- Moving values: `rollingSum`, `rollingMean`, `rollingMin`, `rollingMax`, and
  `rollingStd`, each with an explicit `window` and an optional `minPeriods`.
- Time series: `sortByTime`, `extractPeriod(name, column, interval)`, `resample(...)`,
  `resampleReport(...)`, and `periodBuckets(...)`.
- Standalone `toTime`, `periodStart`, and `periodLabel` for callers who need the same
  parsing and bucketing rules outside a `Dataset`.
- Intervals `hour`, `day`, `week`, `month`, `quarter`, and `year`. Weeks start on Monday
  and quarters on the first day of months 1, 4, 7, and 10.

### Behaviour

- Missing ordering values sort last in both directions, matching `Dataset.sort`, so a
  `desc` order does not move nulls to the top. Ties keep their input order.
- Windows never cross a partition boundary. `lag` on the first row of a partition returns
  `fill`, not the previous partition's last value.
- A rolling window is trailing and ends at the current row. By default a row with fewer
  than `window` predecessors emits `null`; lower `minPeriods` to accept a short window.
- `rollingStd` uses the sample divisor `n - 1`, consistent with `std`, so a window with
  one observation has no spread and emits `null` rather than `0`.
- All calendar arithmetic is UTC. A `Date` is an instant, so bucketing in local time would
  move rows between buckets depending on where the code runs.
- `resample` emits one row per non-empty bucket in ascending time order and does not
  invent rows for empty periods.
- A row whose time is present but unparseable always throws. A row whose time is missing
  is dropped by default and counted, or rejected with `onMissingTime: "error"`.
- Window results are appended, so a name that already exists is rejected rather than
  overwriting the column. Row order and every input column are preserved.

### Notes

- No runtime dependencies were added, and no Node.js built-ins enter the browser entry
  graph: the new modules use only `Date` and `Math`.
- `Dataset` gained 19 methods and the package gained 21 named exports, all mirrored in the
  default namespace.

## [0.9.0] - 2026-11-21

Conditional columns, joins, and reshaping: derive a column from ordered rules, bring in
columns from a related dataset, and change a table's shape without changing its data.

### Added

- `Dataset.addConditionalColumn(name, rules, options?)` and the standalone
  `addConditionalColumn(rows, columns, name, rules, options?)`. Rules are evaluated in
  order and the first match wins, so later rules only see rows earlier rules did not claim.
  `then` and `else` each accept a static value or a callback, and `else` defaults to `null`.
- `Dataset.addConditionalColumnReport(...)` for per-rule match counts, so a rule that never
  fires is visible without inspecting the output column.
- `Dataset.join(other, options)` and `joinTables(...)`, with `inner`, `left`, `right`, and
  `full` strategies; `on` or an explicit `leftOn`/`rightOn` mapping; a documented suffix
  policy for colliding non-key columns; and `nullsMatch` for the deliberate null-to-null
  case.
- `Dataset.joinReport(other, options)` for matched and unmatched counts on each side.
- `Dataset.pivot(options)` and `pivotRows(...)`, with `first`, `last`, `sum`, `mean`, `min`,
  `max`, and `count` aggregation, plus `pivotReport(...)` for generated column names and
  the collapse count.
- `Dataset.melt(options?)` and `meltRows(...)` for unpivoting wide data. Round trips with
  `pivot()`.
- `Dataset.concat(others, options?)` and `concatRows(...)` with `"union"` and `"strict"`
  column policies.
- `examples/13-conditional-joins-reshape.ts`.

### Changed

- `ConditionalThen` is a union of concrete value kinds rather than `unknown | callback`.
  A union containing `unknown` collapses to `unknown`, which left callback parameters
  without contextual types and silently made them `any`.

### Notes

- `addColumn()` is unchanged. `addConditionalColumn()` complements it: the same result for
  simple cases, with the branching expressed as data rather than as a nested callback.
- A join key of `null` matches nothing by default, which is the SQL reading of an unknown
  key. `nullsMatch: true` opts into null-to-null matching.
- `maxRows` (default 1,000,000) turns an accidental many-to-many explosion into an error
  naming the cause instead of a runaway result.
- Predicates are evaluated verbatim. Since `null < 18` is `true` in JavaScript, a predicate
  against a nullable column must test for missing first; the behaviour is documented and
  covered by a test rather than silently rewritten.

## [0.8.0] - 2026-11-21

Metrics and insights: reusable calculations that carry their definition, and an engine
that reports only what the data supports. Every insight includes the values behind it, and
every check that could not run says why.

### Added

- `Dataset.createMetric(spec)` and the standalone `createMetric(spec, rows, columns)`.
  A metric is a value plus the definition that produced it: name, aggregation, column,
  format hints, and metadata.
- Built-in aggregation metrics over all eleven operations, plus custom callbacks that
  receive either a column's present values or the whole row set.
- `Metric.byGroup()` and `Metric.toDataset()` for grouped metrics, in first-appearance
  order of the group key.
- `Metric.recalculate(rows, columns?)`, which returns a new metric with the same
  definition against different data.
- `Metric.compare({ to, label? })` for differences, ratios, and percentage change against
  a baseline, reporting `not-numeric` or `zero-baseline` instead of inventing a number.
- `Metric.definition`, a one-line account such as `sum("revenue")`, so a printed value can
  be audited.
- `Dataset.insights(options?)` and the standalone `analyze(input, options?)`, returning
  `{ insights, skipped, truncated, thresholds }`.
- Seven insight checks: missing data, IQR outliers, strong correlations, category extremes,
  the widest gap between comparable groups, category dominance, and monotonic trends over
  time.
- `resolveInsightOptions(options?)` for the documented defaults, which are also reported
  back in every result.

### Notes

- Metric aggregations delegate to the same primitives `GroupedDataset.aggregate()` uses,
  so a metric and a grouped aggregation over one column cannot disagree.
- A metric never counts a missing cell as zero; each result reports both `rows` and
  `values` so the difference is visible.
- Insights claim no statistical significance, and the correlation check says so in its own
  detail text. A relationship is only described as "strong" at the conventional 0.7, even
  when a caller lowers the reporting threshold.
- Identifier-like columns are excluded as grouping dimensions: a near-unique text column
  would otherwise rank the extreme of a set of one-row samples as a category finding.
- Group gaps are measured against the measure's observed range, so a difference that is
  noise on that scale is not reported.
- Output is deterministic for the same input, and truncation is reported rather than
  dropping observations silently.

## [0.7.0] - 2026-11-21

`Dataset` gains advanced statistics: relationships between columns, distribution shape,
position within a distribution, and outlier detection. Every result carries the evidence
behind it, and undefined answers are `null` with a reason rather than `NaN` or `0`.

### Added

- `Dataset.covariance(left, right, options?)`, with `ddof` selecting the sample (default)
  or population formula.
- `Dataset.correlation(left, right)` and `Dataset.rankCorrelation(left, right)`, returning
  `{ r, n, reason }`.
- `Dataset.correlationMatrix(columns?, method?)`, returning a symmetric matrix with
  `columns`, `matrix`, `cells`, `method`, and a `get(x, y)` lookup.
- `Dataset.zScores(column, options?)` returning `{ values, mean, std, reason }`, aligned to
  the source rows.
- `Dataset.withZScores(column, name?, options?)`, adding a score column without mutating the
  source dataset.
- `Dataset.percentileRank(column, value)`.
- `Dataset.skewness(column)` and `Dataset.kurtosis(column)`.
- `Dataset.fiveNumberSummary(column)`, returning `min`, `q1`, `median`, `q3`, `max`, plus
  `mean` and `count`.
- `Dataset.outliers(column, options?)`, using Tukey's IQR fences (default, `k = 1.5`) or a
  z-score threshold.
- Standalone functions: `covariance`, `pearsonCorrelation`, `spearmanCorrelation`,
  `correlationMatrix`, `zScores`, `standardize`, `normalize`, `percentileRank`, `skewness`,
  `kurtosis`, `fiveNumberSummary`, and `detectOutliers`.
- `examples/11-advanced-statistics.ts`.

### Changed

- Undefined statistics return `null` with a `reason` of `"insufficient-data"` or
  `"zero-variance"`. A caller can branch on the reason; `NaN` would poison downstream
  arithmetic and `0` would misreport "no relationship" as a measurement.
- Skewness and kurtosis use the bias-corrected sample formulas that `scipy.stats` reports
  with `bias=False`, not the raw moment ratios. Kurtosis is excess, so a normal
  distribution is `0`.
- Spearman correlation assigns average ranks to ties, matching `scipy.stats.spearmanr`.
  Assigning arbitrary distinct ranks would invent an ordering the data does not have.
- Correlation results carry no p-value and no significance flag. Deciding whether a
  relationship is real needs a test with its own distributional assumptions.

### Fixed

- The numeric-column guard compared against the `"number"` dtype alone and rejected every
  `integer` column, which is most real-world data. It now defers to `columnKind()`, so
  `number` and `integer` are treated alike. Caught by an integration test before release
  and covered by a regression test that fails against the old check.
- `correlationMatrix` clamps coefficients to `[-1, 1]`; floating point could otherwise
  report `1.0000000000000002`.

### Notes

- Missing values are handled pairwise: two-column statistics use only rows where both
  values are present, and report the `n` they used. Nothing is imputed, so in a matrix over
  gappy data different cells can rest on different row sets.
- Outlier detection identifies unusual values, not errors. A single extreme value inflates
  the standard deviation enough to hide itself from a z-score test, which is why IQR fences
  are the default.
- No hypothesis tests, p-values, or machine-learning models in this release.
- Formulas are cross-checked against `numpy` and `scipy.stats` on fixed fixtures.

## [0.6.0] - 2026-11-21

`Dataset` gains descriptive statistics. `describe()` profiles every column at once;
`describe(column)` returns one column's profile directly.

### Added

- `Dataset.describe()` returns a `DatasetDescription` holding one `ColumnProfile` per
  column, with `get(column)`, `columns`, `table(options?)`, `toDataset()`, and `toJSON()`.
- `Dataset.describe(column, options?)` returns that column's `ColumnProfile` directly. The
  two overloads return different types on purpose, so a single-column answer needs no
  unwrapping.
- `ColumnProfile` reports `count`, `missing`, `total`, `unique`, `sum`, `mean`, `median`,
  `mode`, `min`, `max`, `range`, `variance`, `std`, `q1`, `q3`, `iqr`, and requested
  `percentiles`.
- `ddof` option on `describe`, selecting the sample formula (default) or the population
  formula for `variance` and `std`. Every profile records the `ddof` it used.
- `percentiles` option, adding named percentiles to a profile as `p<value>`.
- `DatasetDescription.toDataset()` returns a `Dataset` with every statistic as a column, for
  piping into charting tools. Requested percentiles become columns named after their keys
  (`p90`), with the values flattened into the cells.
- Standalone statistics: `quantile`, `percentile`, `quartiles`, `iqr`, `mode`, `range`, and
  `extremes`.
- `ColumnKind` classification (`numeric`, `boolean`, `temporal`, `categorical`, `mixed`,
  `empty`) via `columnKind(type)`.

### Changed

- Statistics that do not apply to a column's type are `null`, never `0`. Only numeric
  columns get `sum`, `mean`, `median`, `range`, `variance`, `std`, quartiles, and IQR;
  `count`, `missing`, `unique`, `mode`, `min`, and `max` work on every type.

### Fixed

- `toDataset()` listed `percentiles` as a column but left it out of the row shape, so
  requested percentiles disappeared on conversion. They are now flattened into their own
  columns.
- `percentile` computes its position as `(n - 1) * p / 100` in one expression. Dividing `p`
  by 100 first made `p10` of `[2, 4, 4, 4, 5, 5, 7, 9]` read `3.4000000000000004`.

### Notes

- Quantiles use linear interpolation between order statistics (Hyndman-Fan type 7), the
  same default as `numpy.percentile` and R's `quantile(type = 7)`.
- A single value has no sample spread: `variance` and `std` are `null`, `iqr` and `range`
  are `0`.

## [0.5.0] - 2026-11-21

`Dataset` gains grouping and aggregation. `groupBy()` describes a split and computes
nothing; `aggregate()` runs it and returns an ordinary `Dataset`, so summaries compose with
queries, sorting, and preparation like any other data.

### Added

- `Dataset.groupBy(...columns)` returns a `GroupedDataset`. Accepts one or more columns, or
  a single array of them.
- `GroupedDataset.aggregate(spec)` computes one output column per spec entry and returns a
  `Dataset` whose columns are the grouping columns followed by the spec's keys.
- Aggregations: `count`, `sum`, `mean`, `min`, `max`, `median`, `first`, `last`, `nunique`,
  `std`, and `variance`.
- `ddof` option on `std` and `variance`, selecting the sample formula (default, divides by
  `n - 1`) or the population formula (`ddof: 0`, divides by `n`).
- Custom aggregators in two forms: a bare callback receiving the group's rows, and a
  `{ column, fn }` entry receiving that column's present values. Both receive frozen copies.
- `GroupedDataset` metadata that computes nothing: `columns`, `groupCount`, `rowCount`,
  `sizes`, and `keys`.
- `GroupedDataset.toDataset()` and `mapGroups(fn)` for working with grouped rows directly.
- Standalone helpers exported for use outside a grouping: `sum`, `mean`, `median`,
  `variance`, `std`, `min`, `max`, `first`, `last`, and `nunique`.
- Exported types: `GroupedDataset`, `GroupSource`, `AggregateSpec`, `AggregationEntry`,
  `AggregationFn`, `AggregationOp`, `AggregationSpec`, `AggregationContext`,
  `CustomAggregation`, and `DispersionOptions`.
- `examples/09-grouping.ts` walks through totals, dispersion, missing values, and custom
  aggregators.

### Behaviour

- **Groups keep first-appearance order** of their key, so output is deterministic and
  independent of hashing. Rows keep source order within each group, which is what makes
  `first` and `last` meaningful.
- **A missing key forms its own group** with a `null` key rather than being dropped.
  Discarding such rows silently makes totals that do not add up. Filter with
  `.query().where(key, "isNotNull")` when the group is not wanted.
- **Missing cells inside a group are excluded from every aggregation**, so `mean` of
  `[1, null, 3]` is `2`. `count` with no column counts rows; with a column it counts
  present cells.
- **Noncalculatable results are `null`**, not `0` or `NaN`: a group with no present values
  has a `null` mean, and a single-row group has a `null` sample variance, because one
  observation says nothing about spread. `count`, `nunique`, and `sum` report `0`.
- **Numeric-only operations are validated against the column's type before any row is
  scanned.** `sum` on a text column throws `ValidationError` naming the column and its
  type, rather than quietly returning `null`. `min`, `max`, `first`, `last`, `count`, and
  `nunique` are allowed on text, booleans, and dates.
- **`aggregate` validates the whole spec before computing**, so a mistake in the last entry
  cannot leave a partial result. Output names must not collide with grouping columns.
- **Group keys are compared by value and type, with an injective encoding.** Values that
  contain the internal separator cannot forge a key boundary, so `["x\u0000y", "z"]` and
  `["x", "y\u0000z"]` stay distinct groups. `null` and the string `"null"` are likewise
  different keys.

### Numerical notes

- `sum` uses Neumaier compensated summation. Naive left-to-right addition returns `0` for
  `[1e16, 1, -1e16]` and `0.9999999999999999` for ten copies of `0.1`; compensated
  summation returns `1` for both.
- `variance` is two-pass, computing deviations from the known mean. The one-pass
  `E[x²] - E[x]²` shortcut returns `0` for `[1000000001, 1000000002, 1000000003]`, where
  the correct answer is `1`.

### Removed

- `AUDIT-AND-ARCHITECTURE-v0.1.0.md`. The audit it recorded was superseded by the
  implementation, and keeping a stale snapshot of the codebase invites readers to trust
  descriptions that no longer match the code.

### Not included

`describe()` and the wider descriptive-statistics API, which arrive in 0.6.0. Correlation,
rank statistics, and outlier detection follow in 0.7.0.

## [0.4.0] - 2026-11-21

`Dataset` gains a structured query API. Conditions are typed values passed to methods
rather than text, so there is no query language to parse and no way for data to become
executable code.

### Added

- `Dataset.query()` returns a `Query<Dataset>`.
- `Query` operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `notIn`, `between`,
  `contains`, `startsWith`, `endsWith`, `isNull`, and `isNotNull`.
- `where`, `and`, `or`, plus `andGroup` and `orGroup` for explicit parenthesisation.
- `orderBy`, `select`, `limit`, and `execute`.
- `Query.toString()` renders the compiled conditions with their grouping.
- `ignoreCase` option on the value operators, for case-insensitive text comparisons.
- Exported types: `QueryOperator`, `ComparisonOperator`, `SetOperator`, `RangeOperator`,
  `StringOperator`, `NullOperator`, `QueryDirection`, `WhereOptions`, `QuerySource`,
  and `CellShape`.

### Design notes

- `and` binds tighter than `or`, so `a OR b AND c` reads as `a OR (b AND c)`.
- A missing cell never satisfies a comparison, including `!=` and `notIn`, matching SQL's
  three-valued logic. `isNull` and `isNotNull` test for missingness directly.
- Equality compares by value and type, so `1` never equals `"1"`.
- Conditions are validated against the column's type before any row is scanned. Comparing
  a numeric column against a string raises `ValidationError` instead of silently matching
  nothing. `mixed` and `unknown` columns are exempt.
- `between` rejects inverted bounds, missing bounds, and bounds of different types.
- Every builder step returns a new `Query`; a partially built query is safe to reuse.
  Nothing runs until `execute()`, which returns a new `Dataset` with
  `importReport === null`.
- A `date` column may hold ISO strings (as imported) or `Date` objects (after `cast`).
  Query values are converted to the column's own representation, using strict ISO parsing,
  so comparing either form against an ISO string works instead of silently matching
  nothing. Non-ISO text is rejected rather than becoming an Invalid Date.
- `Dataset.sort` and `Query.orderBy` share one comparator, so they can never disagree
  about ordering.

### Tooling

- `tsx` is now a development dependency, so the documented example command works.
- Examples are typechecked in `verify` via `tsconfig.examples.json`. They were previously
  unchecked, which allowed them to rot.
- `check:no-runtime-deps` fails the build if `package.json` declares a runtime dependency,
  or if `src/` or `dist/` imports a bare package specifier.

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
