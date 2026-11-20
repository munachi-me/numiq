# NUMIQ — CODE REVIEW & VERSION-BY-VERSION DEVELOPMENT PROMPTS

**Repository:** https://github.com/munachi-me/numiq  
**Current published release:** `v0.1.0`  
**Next planned feature release:** `v0.2.0`  
**npm package:** `numiq`  
**Source language:** TypeScript

---

# PART I — CURRENT REPOSITORY REVIEW

## 1. Repository status

The repository is not an empty scaffold. The `main` branch already contains a substantial `v0.1.0` implementation, and GitHub has a published release tagged `v0.1.0`.

The implementation includes:

- CSV, TSV and JSON importing.
- HTTP(S) URL importing.
- Node local-file loading.
- Browser-safe Blob/File and in-memory loading.
- Data normalization and explicit schema casting.
- An immutable Dataset abstraction.
- Dataset inspection (`head`, `tail`, `info`, `column`, `distinct`, `unique`).
- Table rendering with `idx` and a default maximum of 1,000 rows.
- Import reports and typed errors.
- TypeScript source and generated declaration files.
- ESM and CommonJS builds.
- A default namespace export and named exports.
- Unit, integration, type-contract and package-consumer tests.

The repository also includes architecture, API and development documentation.

The GitHub release notes report **215 tests**, 93% statement coverage and 87% branch coverage. However, the architecture audit document reports **186 tests**. These figures disagree and must be reconciled by running the current verification scripts. The GitHub Actions runs endpoint returned no workflow runs, so the release-note figures have not been independently verified by CI in this review.

**This is a static code review. The test suite was not executed during this review.**

## 2. What is already good

### Architecture

The source has a sensible separation:

- `src/core/` — Dataset and schema.
- `src/io/` — loaders, parsers and normalization.
- `src/display/` — table renderer.
- `src/errors/` — typed errors.
- `src/utils/` — value and temporal helpers.
- `src/node.ts` — Node-specific entry.
- `src/index.ts` — browser-safe entry.

The parser/loader separation is a good foundation. Parsers can work synchronously with in-memory text while loaders handle asynchronous I/O.

### Import implementation

The current CSV tokenizer handles quoted fields, escaped quotes, embedded newlines, BOMs, CRLF records and delimiter detection across several sampled lines.

Normalization defaults are conservative. In particular, `NA`, `N/A` and `null` are not automatically converted to missing values. Large unsafe integers and identifier-like strings are also handled more carefully than in the earlier Numeriq prototype.

### Dataset implementation

The Dataset already exposes:

```ts
data.columns
data.data
data.shape
data.rowCount
data.columnCount
data.length
data.schema
data.dtypes
data.importReport
```

It also has useful inspection and table methods. The table renderer uses `idx`, limits output to 1,000 rows by default, and avoids formatting every row of a large dataset.

### Package configuration

TypeScript is a development dependency, not a runtime dependency. Consumers install `numiq`, not TypeScript. The package ships compiled JavaScript and declaration files.

The package also has separate Node and browser entry points, which is important for avoiding Node built-ins in browser bundles.

## 3. Issues to address

These findings should be verified and fixed in the next development cycle.

### P1 — Dataset immutability is not fully enforced at runtime

The Dataset claims to be immutable, and `data` returns defensive copies. However:

- `columns` returns the internal array directly. JavaScript callers can potentially mutate it despite the TypeScript `readonly` type.
- `schema` returns a mutable object.
- `metadata` is only shallow-frozen, so nested objects may remain mutable.

**Required fix:** protect internal state at runtime. Freeze or defensively copy public structures appropriately, including nested metadata where the documented contract promises immutability. Avoid expensive cloning on every hot path without benchmarking.

### P1 — Default and named export parity is incomplete

`src/index.ts` exports `inferColumnType` and `describeColumn` as named exports, but they are not included in the default `Numiq` namespace object.

The documentation says the default namespace and named exports should remain identical.

**Required fix:** decide which runtime exports are truly public, then test parity for every intended public runtime export. Do not expose internal utilities merely to make the lists match.

### P1 — URL timeout does not cover the complete response body

In `src/io/loaders/loaders.ts`, the timeout timer is cleared after `fetch()` resolves with response headers. The response body is read afterward with `response.text()`.

A server that sends headers quickly but stalls while streaming the body may exceed the configured timeout. The external abort listener is also removed before the body has been consumed.

**Required fix:** keep timeout and abort handling active until the response body has been fully read or the operation has failed. Test a server that sends headers and then delays the body.

### P1 — `skipRows` and delimiter detection need a combined regression test

The CSV parser detects the delimiter from the original text before removing skipped preamble rows. Sampling several lines improves detection, but a preamble can still influence the result.

**Required fix:** perform delimiter detection on the relevant post-preamble sample, or explicitly account for `skipRows`. Test a file whose preamble uses a different delimiter from the actual table.

### P2 — Project-root `dataset/` convention is missing

The current `fs.ts` explicitly permits arbitrary paths relative to the process working directory. The current architecture document says Numiq should not dictate where the consumer stores data.

That is not the desired developer experience.

**New required behavior:** a Node project using Numiq must have a `dataset/` folder at its project root, alongside `package.json` and `node_modules`.

```text
my-project/
├── dataset/
│   ├── sales.csv
│   ├── customers.json
│   └── employees.tsv
├── node_modules/
├── package.json
└── index.ts
```

The developer should write:

```ts
import { loadCSV } from "numiq";

const sales = await loadCSV("sales.csv");
```

Not:

```ts
const sales = await loadCSV("./dataset/sales.csv");
```

Apply the same filename-only convention to `loadJSON()` and `loadTSV()`.

Implementation requirements:

- Resolve local filenames from the consumer project's root `dataset/` directory.
- The default project root should be `process.cwd()`, the normal Node project-root convention.
- Reject absolute paths, `..`, path separators and attempts to escape the dataset directory.
- Resolve real paths and prevent symlink-based escapes outside the dataset directory.
- Do not silently fall back to arbitrary paths.
- Give a helpful error if the `dataset/` directory or requested file is missing.
- Keep HTTP(S) URL, Blob/File and in-memory imports working.
- Keep Node filesystem code out of the browser entry.
- Document the folder requirement prominently.
- Do not automatically create, delete or overwrite the user's data directory.

If a configurable project root is needed for monorepos or scripts launched from another directory, propose a typed option with a safe default. Do not silently infer roots by walking arbitrary parent directories.

### P2 — `useSampleDataset()` was omitted

The old Numeriq project had a `useSampleDataset()` helper. Its implementation loaded a package-relative sample sales file and supported CSV, TSV and JSON.

The new Numiq v0.1.0 specification omitted this helper, but it should be restored in a simpler, explicit form.

Add `useSampleDataset()` which loads a bundled CSV sample containing exactly:

- 7 columns.
- 50 data rows (the header is not counted).
- Stable, deterministic content.
- A useful mix of text, categorical, numeric and date-like values.
- A realistic sales/orders theme.

Suggested columns:

`order_id,date,product,category,region,quantity,revenue`

Suggested usage:

```ts
import Numiq, { useSampleDataset } from "numiq";

const sample = await useSampleDataset();

console.log(sample.shape); // [50, 7]
console.log(sample.columns);
console.log(sample.table());
```

Requirements:

- The sample must be included in the published npm package.
- It must work after installation, not only from the GitHub checkout.
- It must return a normal Numiq `Dataset`.
- It must use the same normalization and import-report behavior as regular CSV loading.
- It must work in supported Node and browser environments.
- It must not depend on the consumer's own `dataset/` folder.
- Keep the actual CSV file in the repository and ensure any embedded/generated representation cannot silently drift from it.
- Export the helper as both a named export and a member of the default `Numiq` namespace.
- Prefer an asynchronous helper to match the file-loading API unless the implementation architecture demonstrates a clear advantage to a synchronous API.

The implementation may use a package asset, generated embedded CSV text, or environment-specific asset loading. Choose the most reliable approach for ESM, CommonJS and browser bundlers, and test the packed npm artifact.

### P2 — Fluent/chained Dataset API is not implemented yet

The current Dataset supports inspection, but not a complete chainable transformation API.

The intended developer experience is:

```ts
const result = data
  .filter(row => row.revenue > 100)
  .sort("revenue", "desc")
  .select(["product", "revenue"])
  .limit(10);

console.log(result.table());
```

Introduce the first useful chainable operations in the next release:

- `filter(predicate)`
- `sort(column, direction)`
- `select(columns)`
- `limit(count)`

Each transformation must return a new Dataset and leave the original unchanged.

Requirements:

- Preserve row order unless an operation explicitly changes it.
- Validate column names and arguments.
- Define deterministic sorting for nulls, mixed values and equal values.
- Do not mutate input records.
- Define how names, metadata and import reports behave on derived datasets.
- Do not copy an import report whose row counts no longer describe the derived Dataset.
- Use type-safe predicate and column signatures.
- Keep methods chainable by returning `Dataset`.

Import functions remain asynchronous:

```ts
const data = await Numiq.loadCSV("sales.csv");
const filtered = data.filter(row => row.revenue > 100);
```

Do not pretend a `Promise<Dataset>` has Dataset methods before it is awaited. Fluent Dataset methods and Promise chaining are different concepts.

### P2 — Node engine and build-script compatibility

`package.json` declares Node.js `>=18`, while scripts use `import.meta.dirname`, which is not available in all Node 18 releases.

**Required fix:** use a Node-18-compatible path resolution approach in scripts, such as `fileURLToPath(import.meta.url)`, or explicitly raise the engine requirement with justification. Prefer preserving Node 18 compatibility if the library itself supports it.

### P3 — Documentation and release records need reconciliation

- The architecture document says the repository has not been initialized and returns 404. That is stale; the repository now exists and has a published release.
- The audit says 186 tests; GitHub release notes say 215.
- The README and architecture document describe arbitrary local paths, which conflicts with the restored `dataset/` convention.
- The README must document `useSampleDataset()` and fluent chaining after they ship.

Update these records in the next release.

---

# PART II — RELEASE STRATEGY

## 4. Versioning decision

The current release is `0.1.0`.

The next planned release should be **`0.2.0`**, not `0.1.1`.

Reason: the next release changes the local-file loading contract and adds public APIs and Dataset transformations. In a pre-1.0 package, a minor version is appropriate for a coherent feature/API expansion and potential breaking behavior.

Do not publish automatically. The developer reviews, tests, merges and approves every release.

## 5. Roadmap overview

| Version | Release focus |
|---|---|
| `0.1.0` | Import and Dataset foundation — already released |
| `0.2.0` | Project dataset folder, sample dataset, first fluent operations |
| `0.3.0` | Data preparation and transformation |
| `0.4.0` | Query and filtering engine |
| `0.5.0` | Grouping and aggregation |
| `0.6.0` | Descriptive statistics and `describe()` |
| `0.7.0` | Advanced statistics |
| `0.8.0` | Metrics and analytical insights |
| `0.9.0` | Dataset joins and reshaping |
| `0.10.0` | Window functions and time-series operations |
| `0.11.0` | Pipelines, schema validation and lineage |
| `0.12.0` | Performance, memory and extensibility |
| `1.0.0` | API stabilization and production release |

This is a proposed sequence. Before starting a release, inspect the current repository and verify which features have already shipped. Never reimplement completed functionality just because it appears in this roadmap.

---

# PART III — SHARED INSTRUCTIONS FOR EVERY RELEASE AGENT

## 6. Role

You are the lead TypeScript architect and engineer maintaining the Numiq npm package.

Repository: `https://github.com/munachi-me/numiq`  
Package: `numiq`

Work against the current repository and current release. Do not assume the roadmap describes the repository's exact current state.

## 7. Non-negotiable constraints

1. Use TypeScript as the source language.
2. TypeScript is a development dependency only. Consumers install `numiq`, not TypeScript.
3. Ship compiled JavaScript and generated `.d.ts` declarations.
4. Keep runtime dependencies at zero unless a dependency is justified and approved.
5. Maintain ESM, CommonJS and browser compatibility as documented.
6. Keep Node built-ins out of the browser entry graph.
7. Excel/XLS/XLSX importing is excluded until explicitly approved in a future specification.
8. Do not add a dependency on Numviz.
9. Do not add a dependency on the old Numeriq project.
10. Preserve CSV, JSON, TSV and HTTP(S) URL importing.
11. Preserve conservative normalization and data-preservation guarantees.
12. Keep `maxRows` default at 1,000 for table output.
13. Use `idx`, not `index`, as the table row-label heading.
14. Keep Dataset transformations immutable and chainable.
15. Do not add fake placeholder methods.
16. Do not claim tests, builds, benchmarks or coverage passed unless actually executed.
17. Do not publish to npm, create a public release, merge to `main`, or delete branches without explicit approval.
18. Work on a dedicated feature branch for each release.
19. Update README, API docs, changelog, examples and tests with every public API change.
20. Keep the package small and suitable for developers working on modest hardware.

## 8. Required workflow for each version

1. Inspect the current branch, package version, changelog, release tags and implemented source.
2. Compare the requested scope with what already exists.
3. Produce an implementation plan and identify API decisions.
4. Implement only that release's scope.
5. Add or update automated tests.
6. Run typecheck, lint, formatting checks, cycle checks, unit/integration tests, build, type tests and package-consumer tests.
7. Inspect `npm pack --dry-run`.
8. Test the packed package in a clean consumer project.
9. Update documentation and changelog.
10. Report exact test counts and any failures.
11. Prepare a versioned ZIP if requested, with no `node_modules`.
12. Stop and wait for approval before merge or publication.

Use existing scripts where correct:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run check:cycles
npm test
npm run build
npm run test:types
npm run test:package
npm run verify
npm pack --dry-run
```

If a script is broken, fix it and explain why. Do not skip a check silently.

---

# PART IV — FULL RELEASE PROMPTS

## 9. RELEASE PROMPT — NUMIQ v0.1.0
### Already released — baseline audit only

**Do not recreate or overwrite this release.** This prompt defines the baseline contract for future agents.

You are reviewing the already published Numiq `v0.1.0` release. Understand its implementation and verify the foundation before extending it.

The release provides:

- TypeScript source.
- Dataset factory and immutable Dataset.
- CSV, JSON and TSV import.
- HTTP(S) URL loading.
- Node local-file loading.
- Browser-safe Blob/File and in-memory loading.
- Normalization and explicit schema casting.
- Import reports and typed errors.
- Dataset properties and inspection.
- `table()` with a 1,000-row default limit and `idx`.
- Default and named exports.
- ESM and CommonJS builds.
- Generated declaration files.

Excel is not supported.

### Baseline verification

Verify the actual implementation of each feature. Resolve the discrepancy between the architecture audit's 186 tests and the GitHub release notes' 215 tests by running the current suite.

Review:

- Dataset immutability.
- Default/named export parity.
- URL timeout and abort lifecycle.
- CSV delimiter detection with skipped preamble rows.
- Package compatibility with the declared Node engine.
- npm tarball contents.

Produce a baseline review with confirmed defects, reproduction examples, severity and recommended fixes.

Do not change the published `v0.1.0` tag. Any fixes belong in a new release.

**Acceptance:** baseline inventory is accurate; test count is measured; every defect has reproduction evidence; no release or merge is performed.

---

## 10. RELEASE PROMPT — NUMIQ v0.2.0
### Project Dataset Workflow, Sample Dataset and Fluent API

You are implementing Numiq v0.2.0. This release improves local data loading, restores the sample helper and introduces the first chainable Dataset transformations.

### A. Project-root dataset directory

A consumer project uses:

```text
my-project/
├── dataset/
│   ├── sales.csv
│   ├── customers.json
│   └── employees.tsv
├── node_modules/
├── package.json
└── index.ts
```

The directory is named exactly `dataset`.

The local import API accepts a filename only:

```ts
const sales = await loadCSV("sales.csv");
const customers = await loadJSON("customers.json");
const employees = await loadTSV("employees.tsv");
```

Resolve filenames from the consumer project's root `dataset/` directory. The default project root is `process.cwd()`.

Do not require developers to write `./dataset/`, absolute paths or full paths.

Security requirements:

- Accept a filename only for local-file loading.
- Reject absolute paths.
- Reject `..` traversal.
- Reject path separators and nested paths in this initial contract.
- Resolve the real target path and reject symlink escapes.
- Never fall back to arbitrary paths.
- Return a helpful error when the `dataset/` folder or file is missing.
- Do not automatically create, delete or overwrite user files.
- Keep URL, Blob/File and in-memory imports working.
- Keep filesystem code isolated from browser entry points.

Document the project-root rule. If a configurable project root is necessary for monorepos, propose a typed option with a safe default.

### B. `useSampleDataset()`

Add:

```ts
const sample = await useSampleDataset();
```

Requirements:

- Include a real CSV sample asset in the package.
- Exactly 7 columns.
- Exactly 50 data rows, excluding the header.
- Stable deterministic content; no random values per call.
- Realistic sales/order theme.
- Suggested columns: `order_id`, `date`, `product`, `category`, `region`, `quantity`, `revenue`.
- Include text, categorical, numeric and date-like values.
- Return a normal Numiq `Dataset`.
- Expected shape: `[50, 7]`.
- Include a meaningful import report with a sample source label.
- Work after npm installation.
- Work in supported Node and browser environments.
- Do not depend on the consumer's `dataset/` directory.
- Keep the repository CSV and any embedded/generated representation synchronized.
- Export as a named export and as `Numiq.useSampleDataset`.

Choose a reliable implementation for ESM, CommonJS and browser bundlers. Test the packed npm artifact, not just source imports. Prefer an asynchronous helper to match file-loading APIs unless there is a clear architectural reason not to.

### C. Fluent/chained Dataset API

Introduce:

```ts
const result = data
  .filter(row => Number(row.revenue) > 100)
  .sort("revenue", "desc")
  .select(["product", "revenue"])
  .limit(10);

console.log(result.table());
```

Implement:

- `filter(predicate)` — returns a Dataset of matching rows.
- `sort(column, direction)` — returns a Dataset sorted by a selected column.
- `select(columns)` — returns a Dataset with only selected columns in requested order.
- `limit(count)` — returns a Dataset containing at most the requested number of rows.

Requirements:

- Every operation returns a new Dataset.
- Original Dataset remains unchanged.
- Preserve order unless explicitly changed.
- Validate columns and arguments.
- Define deterministic sorting for nulls, mixed values and equal values.
- Do not mutate input records.
- Define metadata and import-report behavior for derived Datasets.
- Do not carry an import report whose row counts describe the source rather than the derived Dataset.
- Use type-safe predicate and column signatures.
- Preserve chainability.

Import functions remain asynchronous:

```ts
const data = await Numiq.loadCSV("sales.csv");
const filtered = data.filter(row => row.revenue > 100);
```

Do not pretend a `Promise<Dataset>` has Dataset methods before it is awaited.

### D. API, documentation and tests

Update README, Node loading instructions, browser loading instructions, sample dataset docs, Dataset API reference, chaining examples, errors, changelog and runnable examples.

Test:

- Filename-only local loading.
- Missing dataset directory and missing files.
- Absolute paths rejected.
- `../` rejected.
- Windows and POSIX separators rejected.
- Symlink escape rejected.
- URL and Blob/File loading unaffected.
- Sample has exactly 7 columns and 50 rows.
- Sample works from packed package in Node and browser-compatible build.
- Sample CSV and embedded asset remain identical.
- Named/default export parity includes the sample helper.
- Each chain method returns a Dataset.
- Chaining works in different orders.
- Original Dataset remains unchanged.
- Sorting edge cases and stable ties.
- Invalid columns and limits produce typed errors.

### Acceptance criteria

- `loadCSV("sales.csv")` reads only `projectRoot/dataset/sales.csv`.
- Arbitrary local paths are not accepted through the filename API.
- `useSampleDataset()` works from an installed package.
- Sample shape is exactly `[50, 7]`.
- The fluent example works.
- Existing v0.1.0 features remain functional except documented corrections.
- No Excel support or dependency is introduced.
- Verification scripts pass.
- No npm publish or merge without approval.

---

## 11. RELEASE PROMPT — NUMIQ v0.3.0
### Data Preparation and Transformation Engine

Implement a comprehensive set of immutable Dataset preparation methods.

Features:

- `drop(columns)`
- `rename(mapping)`
- `dropMissing(options?)`
- `fillMissing(strategyOrMapping)`
- `replace(mappingOrOptions)`
- `map(column, callback)`
- `addColumn(name, callbackOrValues)`
- `cast(schema)`
- `dropDuplicates(columns?)`
- `sample(count, options?)`

Example:

```ts
const prepared = data
  .drop(["internal_note"])
  .rename({ qty: "quantity" })
  .fillMissing({ quantity: 0 })
  .dropDuplicates(["order_id"])
  .addColumn("total", row => row.quantity * row.unit_price);
```

Requirements:

- Every Dataset-to-Dataset operation returns a new Dataset.
- Define behavior for missing columns and invalid input.
- Preserve column order predictably.
- Preserve values not targeted by a transformation.
- Make missing-value strategies explicit (`mean`, `median`, `mode`, constant, callback).
- Reject unsupported strategies for a column type.
- Do not silently coerce data.
- Make sampling deterministic when a seed is supplied.
- Document metadata and import-report behavior for derived Datasets.
- Ensure callback errors identify operation and row/column context where practical.

Test empty, mixed, missing, duplicate and large datasets. Test chained combinations and original-data immutability. Do not add query DSL, grouping or statistics in this release.

**Acceptance:** all new methods are typed, documented, tested and chainable; existing APIs remain compatible; package verification passes.

---

## 12. RELEASE PROMPT — NUMIQ v0.4.0
### Query and Filtering Engine

Add a structured query API alongside predicate-based `filter()`.

Proposed usage:

```ts
const result = data.query()
  .where("revenue", ">", 100)
  .and("region", "in", ["North", "West"])
  .orderBy("revenue", "desc")
  .select(["product", "region", "revenue"])
  .limit(20)
  .execute();
```

Review logical grouping and precedence before implementing.

Support:

- `=`, `!=`, `>`, `>=`, `<`, `<=`
- `in`, `notIn`
- `between`
- `contains`, `startsWith`, `endsWith`
- `isNull`, `isNotNull`
- Explicit case-sensitive/case-insensitive string comparisons.

Requirements:

- Strong TypeScript types for operators and values.
- Clear logical grouping and precedence.
- No SQL string evaluation or `eval`.
- No arbitrary code execution from query strings.
- Predictable null and mixed-type semantics.
- Clear errors for unknown columns/operators.
- Query execution returns a Dataset when selecting rows.
- Query builder is immutable or safely reusable; document its lifecycle.
- Preserve fluent composition.

Test every operator, boundaries, nulls, mixed columns, AND/OR precedence, nested groups, empty results, invalid operations and query reuse. Add examples and API docs. Do not add joins or aggregation here.

---

## 13. RELEASE PROMPT — NUMIQ v0.5.0
### Grouping and Aggregation Engine

Introduce grouped data operations and reusable aggregation functions.

Proposed API:

```ts
const summary = data
  .groupBy("region")
  .aggregate({
    totalRevenue: { column: "revenue", op: "sum" },
    averageOrder: { column: "revenue", op: "mean" },
    orderCount: { op: "count" }
  });
```

Implement:

- `count`
- `sum`
- `mean`
- `min`
- `max`
- `median`
- `first`
- `last`
- `nunique`
- `std`
- `variance`

Requirements:

- `groupBy()` returns a typed `GroupedDataset` or equivalent.
- Support one or multiple grouping columns.
- Preserve deterministic group ordering.
- Define null grouping behavior.
- Validate numeric-only aggregations.
- Return null or a documented result for noncalculatable combinations.
- Support custom aggregation callbacks without exposing mutable internal arrays.
- Return a normal Dataset from `aggregate()`.
- Keep operations composable where meaningful.

Test empty datasets, one/many groups, multiple keys, null keys, each aggregation, custom aggregators and stable ordering. Validate calculations against known values. Do not implement the full `describe()` API here.

---

## 14. RELEASE PROMPT — NUMIQ v0.6.0
### Descriptive Statistics and Dataset Description

Build a reliable descriptive statistics module and consistent `describe()` API.

Implement:

- count
- missing count
- sum
- mean
- median
- mode
- min
- max
- range
- variance
- standard deviation
- quartiles
- percentiles
- interquartile range
- unique count

Support:

```ts
const summary = data.describe();
const revenue = data.describe("revenue");
```

The all-column result must have a consistent analytical result/table structure. A single-column request may return a documented object, but types must make the distinction explicit. Do not return an unrelated Dataset for one overload and an untyped object for another without a deliberate contract.

Support numeric, categorical, boolean, date and mixed columns where meaningful.

Requirements:

- Noncalculatable statistics return `null` or another documented value.
- Document sample/population formulas.
- Handle empty and all-null columns.
- Consider numeric precision and overflow.
- Do not mutate the source Dataset.
- Keep analysis results focused; do not embed the entire Dataset profile in every result.
- Make results easy for Numviz and external tools to consume without importing Numviz.

Test known expected values, empty, singleton, all-null, mixed, categorical and numeric columns. Test overloads and declaration inference. Document every statistic.

---

## 15. RELEASE PROMPT — NUMIQ v0.7.0
### Advanced Statistical Analysis

Add advanced statistical functions in a separate analytics module.

Consider:

- Covariance.
- Pearson correlation.
- Spearman rank correlation.
- Correlation matrix.
- Z-scores.
- Percentile rank.
- Outlier detection using IQR and z-score.
- Skewness.
- Kurtosis.
- Five-number summary.
- Normalization and standardization helpers.

Requirements:

- Distinguish sample and population formulas.
- Handle zero variance, empty input and insufficient observations.
- Define pairwise missing-value handling.
- Do not claim statistical significance without an appropriate test.
- Keep calculations pure and testable.
- Return structured typed results.
- Do not add machine-learning models in this release.

Use known numerical fixtures and cross-check formulas with trusted reference calculations. Test degenerate datasets and missing-value policies. Document assumptions, formulas and limitations.

---

## 16. RELEASE PROMPT — NUMIQ v0.8.0
### Metrics and Analytical Insights

Introduce reusable metric definitions and a transparent insight engine.

Metric API concept:

```ts
const revenue = data.createMetric({
  name: "Total Revenue",
  column: "revenue",
  aggregation: "sum"
});

revenue.name;
revenue.metric;
```

Support:

- Metric definitions.
- Aggregation-backed metrics.
- Custom metric callbacks.
- Grouped metrics where supported.
- Metric metadata and formatting hints.
- Recalculation against a new Dataset.
- Metric comparisons where dimensions exist.

Insight engine should identify defensible patterns such as:

- Highest/lowest categories.
- Largest changes between comparable groups.
- Missing-data warnings.
- Outlier observations.
- Strong correlations.
- Dominant categories.
- Basic trends when date/time data is valid.

Requirements:

- Separate calculations from presentation.
- Do not generate unsupported narratives.
- Every insight includes the values and evidence behind it.
- Make thresholds configurable and document defaults.
- Return a stable structure such as `{ insights, skipped, truncated }` where appropriate.
- Do not embed visualization or dashboard rendering.

Test metric correctness, custom metrics, missing columns, empty datasets, insight evidence, false-positive avoidance and deterministic output. Provide examples and API docs.

---

## 17. RELEASE PROMPT — NUMIQ v0.9.0
### Dataset Joins and Reshaping

Enable analysis across related datasets and reshape tabular data.

Join API concept:

```ts
const result = orders.join(customers, {
  on: "customer_id",
  how: "left"
});
```

Support:

- inner join
- left join
- right join
- full outer join
- explicit key mapping for differently named columns
- documented suffix behavior for overlapping columns
- validation for missing or ambiguous keys

Reshaping features:

- `pivot()`
- `melt()` / unpivot
- `concat()` / row binding
- column binding where safe and clearly defined

Requirements:

- Preserve source Datasets.
- Define duplicate-key behavior.
- Define null-key behavior.
- Avoid accidental Cartesian explosions; document and optionally guard against them.
- Preserve predictable column order.
- Validate incompatible column shapes.
- Keep outputs as normal Datasets.
- Do not implement window functions here.

Test all join types, one-to-many and many-to-many relationships, duplicate/null keys, unmatched rows, overlapping columns, empty inputs, pivot collisions and reshape round trips. Include performance tests.

---

## 18. RELEASE PROMPT — NUMIQ v0.10.0
### Window Functions and Time-Series Operations

Add operations that depend on ordered rows and neighboring observations.

Window functions to consider:

- `rank`
- `denseRank`
- `rowNumber`
- `lag`
- `lead`
- cumulative sum
- cumulative mean
- rolling sum
- rolling mean
- rolling min/max
- moving standard deviation

Time-series support:

- sort by time
- resample/group by documented intervals
- rolling windows
- period extraction where appropriate

Requirements:

- Require explicit ordering where order matters.
- Define partition/group boundaries.
- Define behavior for missing values and ties.
- Validate date/time inputs.
- Avoid silently changing timezone semantics.
- Make window size and alignment explicit.
- Return new Datasets.
- Preserve original data.

Use deterministic time-series fixtures. Test ties, partition boundaries, missing values, small windows, date parsing, timezones and ordering. Document edge semantics.

---

## 19. RELEASE PROMPT — NUMIQ v0.11.0
### Pipelines, Schema Validation and Data Lineage

Provide reusable, inspectable data workflows.

Pipeline concept:

```ts
const pipeline = Numiq.pipeline()
  .load(() => loadCSV("sales.csv"))
  .transform(data => data.filter(row => row.revenue > 0))
  .transform(data => data.dropDuplicates(["order_id"]))
  .validate(schema)
  .build();

const result = await pipeline.run();
```

The design must preserve async import behavior and distinguish synchronous transformations from asynchronous steps.

Features:

- Declarative pipeline definitions.
- Reusable transformation steps.
- Named steps.
- Step-level validation.
- Structured execution reports.
- Data lineage describing source and transformations.
- Reproducible configuration where serializable.
- Clear error location identifying the failing step.

Schema validation:

- Required columns.
- Allowed types.
- Nullability.
- Constraints such as min/max and allowed values.
- Custom validators.
- Reports with row and column context.

Requirements:

- Do not execute arbitrary serialized JavaScript.
- Do not pretend callback-based steps are serializable.
- Separate pipeline definition from execution.
- Preserve reproducibility and document non-deterministic operations.
- Keep lineage metadata separate from row values.
- Avoid unbounded memory copies.

Test sync/async steps, failures, validation, missing columns, invalid types, reproducibility, pipeline reuse, lineage order and error reporting. Include examples and full API docs.

---

## 20. RELEASE PROMPT — NUMIQ v0.12.0
### Performance, Memory and Extensibility

Improve performance and prepare the engine for larger datasets without sacrificing correctness.

Investigate:

- Dataset internal storage.
- Defensive-copy costs.
- Schema and dtype caching.
- Table rendering.
- Filtering and sorting.
- Grouping and aggregation.
- Join algorithms.
- Memory use.
- Import throughput.
- Streaming/chunked import where justified.
- Optional lazy evaluation only if it can be implemented without making the API unpredictable.

Requirements:

- Establish reproducible benchmarks before optimizing.
- Keep correctness tests as gates.
- Avoid premature complexity.
- Document memory/performance tradeoffs.
- Preserve public APIs unless a breaking change is approved.
- Keep zero runtime dependencies if practical.
- If a dependency is proposed, compare it with a native implementation and quantify the tradeoff.
- Do not add GPU, worker or native bindings without a separate proposal.

Add benchmarks for representative small, medium and large datasets. Record baseline and post-change results. Test memory-sensitive operations and ensure results match reference implementations. Document known performance limits.

---

## 21. RELEASE PROMPT — NUMIQ v1.0.0
### Stable API and Production Release

Prepare Numiq for its first stable major release. This is not a feature dump. Focus on API stability, correctness, documentation, compatibility and release quality.

Audit every public export and method:

- Is it necessary?
- Is its name consistent?
- Are arguments and return values predictable?
- Are errors documented?
- Are types accurate?
- Is behavior covered by tests?
- Does it work in Node and supported browsers?
- Does it preserve data?
- Does it compose with the fluent API?

Production requirements:

- Stable semantic-versioning policy.
- Documented Node.js support matrix.
- Browser/bundler support matrix.
- Complete generated declarations.
- ESM and CommonJS consumer tests.
- API documentation for every public export.
- Migration guide from pre-1.0 releases.
- Security review of local dataset path handling.
- Performance benchmarks and known limits.
- Comprehensive changelog.
- License and package metadata review.
- npm tarball inspection.
- Clean consumer installation test.
- CI workflow that runs verification on supported Node versions.
- No undocumented experimental API in the stable surface.

List every breaking change and provide migration examples. Do not silently change behavior.

The complete verification suite must pass. Package consumers must be able to install and use the package in clean Node and browser projects. Documentation examples must run successfully.

Do not publish until the developer explicitly approves.

---

# PART V — REQUIRED DEVELOPER EXPERIENCE CONTRACT

## 22. Local file loading

The intended Node developer experience is:

```ts
import Numiq, { loadCSV, loadJSON, loadTSV } from "numiq";

const sales = await loadCSV("sales.csv");
const customers = await loadJSON("customers.json");
const employees = await loadTSV("employees.tsv");
```

The consumer project structure is:

```text
project-root/
├── dataset/
│   ├── sales.csv
│   ├── customers.json
│   └── employees.tsv
├── node_modules/
├── package.json
└── src/
    └── index.ts
```

Do not make the user provide `dataset/` in the function argument. Numiq resolves it internally.

URL and in-memory sources remain supported:

```ts
const remote = await loadCSV("https://example.com/sales.csv");
const fromFileInput = await loadCSV(file);
```

The filename-only rule applies to local filesystem paths, not URLs or Blob/File objects.

## 23. Sample dataset

The helper is:

```ts
const sample = await Numiq.useSampleDataset();
```

Expected:

```ts
sample.shape; // [50, 7]
```

The sample is bundled with Numiq and does not require the user's project-level `dataset/` directory.

## 24. Default and named API consistency

Both styles must work:

```ts
import Numiq from "numiq";

const sample = await Numiq.useSampleDataset();
const data = await Numiq.loadCSV("sales.csv");
```

```ts
import {
  useSampleDataset,
  loadCSV
} from "numiq";

const sample = await useSampleDataset();
const data = await loadCSV("sales.csv");
```

For every intended public runtime function, the default namespace member must reference the same function as the named export. Test this contract.

## 25. Fluent Dataset API

The Dataset API should support:

```ts
const data = await loadCSV("sales.csv");

const result = data
  .filter(row => row.revenue > 100)
  .sort("revenue", "desc")
  .select(["order_id", "product", "revenue"])
  .limit(10);

console.log(result.table());
```

Each Dataset transformation returns a Dataset. Scalar/statistical methods may return values or analysis result objects and should be terminal operations unless a specific chainable result abstraction is deliberately designed.

---

# PART VI — RELEASE CHECKLIST

Before marking any version complete:

- [ ] Current repository state inspected.
- [ ] Scope compared with already implemented features.
- [ ] Public API reviewed.
- [ ] TypeScript strict checks pass.
- [ ] Lint passes.
- [ ] Formatting check passes.
- [ ] Dependency-cycle check passes.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Type declaration tests pass.
- [ ] Package-consumer tests pass.
- [ ] Browser entry has no Node built-ins.
- [ ] ESM consumer works.
- [ ] CommonJS consumer works.
- [ ] README and API docs updated.
- [ ] Changelog updated.
- [ ] Examples verified.
- [ ] `npm pack --dry-run` inspected.
- [ ] No `node_modules` in ZIP deliverable.
- [ ] No unsupported Excel functionality.
- [ ] No unapproved dependency.
- [ ] No unapproved merge or npm publication.

**Final instruction:** Numiq should grow as a coherent data analysis engine, not as a collection of unrelated functions. Keep the Dataset model consistent, keep transformations composable, preserve data, and make every release independently testable.
