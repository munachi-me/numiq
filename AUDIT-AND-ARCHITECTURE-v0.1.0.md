# Numiq v0.1.0 — Numeriq Audit, Architecture, API Proposal, Plan

Status: **proposal, awaiting developer approval.** No repository has been initialized and nothing has been published.

Audited source: `https://github.com/munachi-me/numeriq` @ v0.16.0 (MIT, `type: module`, zero runtime dependencies).
Verification environment: Node.js 24.22.2. Its own suite runs green: `node --test` → 186 pass, 0 fail.

---

## A. Existing Numeriq audit

### A.1 Importer architecture

Three layers, ESM-only, no runtime dependencies:

| Layer | File | Lines | Responsibility |
|---|---|---|---|
| Entry | `src/io/index.js` | 3 | Re-exports `parseCSV`, `parseJSON`, `loadCSV`, `loadJSON`, `loadData`, `loadMany`, `useSampleDataset` |
| Loaders | `src/io/loaders.js` | 194 | Source resolution (local path vs URL), fetch, format dispatch, multi-source merge |
| Parsers | `src/io/parsers.js` | 218 | CSV/TSV tokenizer + header handling, JSON shape handling, dataset construction |
| Normalization | `src/io/normalization.js` | 77 | Missing markers, per-column schema casts, warnings, missing counts |
| Values | `src/utils/values.js` | 98 | `normalizeValue`, `castValue`, `inferType`, `cloneValue` |
| Temporal | `src/utils/temporal.js` | 227 | ISO + format-string date/time parsing and inference |
| Display | `src/display/table.js` | 25 | Box-drawing table renderer |
| Errors | `src/errors/index.js` | 6 | `NumeriqError`, `ValidationError` |

Flow: `loadCSV → readSource → parseCSV → normalizeImportRecords → createDataset(rows, {importReport, [NORMALIZED_ROWS]})`.

The parser never builds a Dataset by re-normalizing: it passes an internal `NORMALIZED_ROWS` symbol so the `Dataset` constructor skips a second pass. That is a good idea and worth keeping.

### A.2 CSV implementation

A hand-written character scanner (`parseCsvRows`) with a 4-candidate delimiter vote on the **first line only** (`, \t ; |`), BOM strip, `header: false` + `columns` support, `skipRows` preamble skipping, blank-row removal, strict/lenient row-width handling with warnings, and `nullValues`/`schema`/`onInvalid` passthrough.

Verified working: quoted delimiters, escaped `""`, embedded newlines, CRLF record separators, lone CR, trailing newline, BOM, semicolon/pipe/tab detection, headerless files, blank-row skipping.

Verified broken or lossy: bare `"` inside an unquoted field (defect #12), `\r\n` preserved inside quoted cells so CRLF and LF sources disagree (defect #13), delimiter voted from the first physical line only, ignoring `skipRows` (defect #19).

### A.3 JSON implementation

Accepts: array of records, array of arrays (requires `columns`), column-oriented object (`{a:[...],b:[...]}`), with equal-length enforcement (strict or pad-with-null + warning), `schema`, `skipRows`. Rejects top-level scalars and non-array objects with clear messages.

### A.4 TSV implementation

Not a separate path. TSV is CSV with `delimiter: '\t'` selected by file extension or `format`, and recorded in the report. Sound approach, no duplication.

### A.5 URL loading

`fetch`-based, supports method/headers/body/signal, maps `!response.ok` to `ValidationError`, and derives format from extension first, then `content-type` (`application/json`, `+json`, `text/csv`, `text/tab-separated-values`).

### A.6 Normalization

`normalizeValue` trims strings (default on), maps empty strings and a default marker set `['null','undefined','n/a','na']` to `null`, infers booleans (`true`/`false`) and numbers (regex-guarded, leading-zero identifiers preserved), then `castValue` applies explicit schema types (`string|number|integer|boolean|date|datetime|time`, optional format strings). Failures either throw with `row N, column "x"` or set `null` and append a warning under `onInvalid: 'null'`.

### A.7 Supporting utilities

`inferType` (boolean/integer/number/date/datetime/time/string/mixed), `cloneValue` (deep, Date-aware), `stableValue` for dedupe keys, `deepFreeze` for the import report.

### A.8 Existing tests

19 files, 186 tests, `node:test` + `node:assert/strict`, no dependencies. Import coverage is genuinely good: `import-preparation.test.js` (options, schemas, warnings, sample datasets) and `local-loading-describe.test.js` (local files, quoting, symlink escape, live HTTP server). There is no TypeScript test, no declaration test, and no consumer test.

### A.9 Dependencies

Runtime: **none**. Dev: **none** (tests use `node:test`). Publishing is raw ESM source with a hand-maintained `index.d.ts` (23 KB). No build, no lint, no type check.

### A.10 Reusable code (adapt, do not copy)

| Item | Verdict |
|---|---|
| `parseCsvRows` tokenizer | **Reuse algorithm**, rewrite in strict TS with CRLF normalization inside quoted fields |
| Delimiter detection | **Reuse idea**, improve: vote across up to N non-blank lines, not just the first |
| `normalizeImportRecords` / `missingCounts` / `importerNormalization` | **Reuse design**, restructure into a normalization module with an explicit policy object |
| `castValue` + temporal parsing | **Reuse**, keep behind explicit schema only |
| `inferType` | **Reuse**, with a safe-integer guard added |
| `renderTable` | **Reuse nearly as-is**: `idx` column, `maxRows`/`maxColumns`/`maxCellWidth`, "Showing N of M rows", wide-data ellipsis. Meets most of §6.2; empty-dataset output needs work (defect #18) |
| `NORMALIZED_ROWS` skip-renormalization flag | **Reuse** the concept (as an internal brand, not a public symbol) |
| Frozen `importReport` shape (`format`, `source`, `rowsRead`, `rowsImported`, `columns`, `missingByColumn`, `warnings`) | **Reuse** as the v0.1.0 report contract |
| `NumeriqError`/`ValidationError` | **Replace** with a real hierarchy (§C.5) |
| `node:util` inspect hook in `dataset.js` | **Drop** from core; it is what breaks browser bundling |
| Dataset analytics, joins, windows, reshape, charts, dashboards, reports, insights | **Out of scope** for v0.1.0 |

### A.11 Defects found — code that must be rewritten, not ported

Each item below was reproduced, not inferred.

| # | Severity | Defect | Evidence |
|---|---|---|---|
| 1 | **P1 data loss** | Default missing markers `['null','undefined','n/a','na']` silently null out real data. Namibian country code `NA` is destroyed. | `parseCSV('country\nNA\nNA\n').rows` → `[{"country":null},{"country":null}]` |
| 2 | **P1 data loss** | Numeric inference loses integer precision silently. | `parseCSV('id\n9007199254740993\n').rows` → `9007199254740992` |
| 3 | **P1 data loss** | Phone/ID-like values are coerced to numbers. | `parseCSV('phone\n+26481234\n').rows` → `26481234` |
| 4 | **P1 API** | `Dataset` has no `table()`; only `toTable()` exists. `table()` and `toArray()` exist on `AnalysisResult` only, so the renderer is not reachable from the object §6.2 names. | `Dataset.prototype.table` → `undefined`, `Dataset.prototype.toArray` → `undefined`; `toAnalysisResult().table` → `function` |
| 5 | **P1 API** | `Dataset` lacks `data`, `rowCount`, `columnCount`, all required by §6.1. | each → `undefined`; only `length`, `shape`, `columns`, `schema`, `dtypes` exist |
| 6 | **P1 types** | Hand-written `index.d.ts` has drifted from runtime: `parseCSV`/`parseJSON` declared `Promise<Dataset>` but return synchronously; `loadMany` declared `Promise<Dataset[]>` but returns a single `Dataset`. | `parseCSV(...) instanceof Promise` → `false`; `loadMany(...)` → `Dataset` |
| 7 | **P1 browser** | The root entry graph imports `node:util` (`dataset.js`), `node:fs/promises` and `node:path` (`loaders.js`, `samples.js`). `import 'numeriq'` cannot bundle for the browser without polyfills. | grep of `from 'node:` across `src/` |
| 8 | **P2 API** | Local files may only be loaded from `<projectRoot>/dataset/`, with realpath + symlink-escape rejection. A published library cannot dictate a `dataset/` folder in the consumer's project. | `loadCSV('../package.json')` → "must stay inside the project dataset/ directory" |
| 9 | **P2 API** | `loadCSV('x.json')` silently parses as JSON; `loadCSV` also accepts TSV. A format-specific loader should not change format behind the caller's back. | `loaders.js` line 8 |
| 10 | **P2 API** | `describe()` returns a `Dataset` for the whole frame but a plain object for one column. Consumers cannot write one code path. | `describe()` → `Dataset`, `describe('a')` → `object` |
| 11 | **P2 correctness** | `dtypes` reports `'date'` while the stored value remains a string. Dtype and representation disagree. | `parseCSV('when\n2026-01-05\n').dtypes.when` → `'date'`, `rows[0].when` → `'2026-01-05'` (not a `Date`) |
| 12 | **P2 correctness** | A bare `"` inside an unquoted field aborts the whole import. Real exports contain inch marks. | `parseCSV('product,size\nMonitor 5" wide,24\n')` → "Unexpected quote in CSV at character 22" |
| 13 | **P2 correctness** | `\r\n` inside a quoted field is preserved verbatim, so multi-line cells differ between CRLF and LF sources. | quoted branch of `parseCsvRows` appends `\r` |
| 14 | **P2 perf** | `rows`, `dtypes`, `schema` deep-clone or recompute on every access; no caching. 20k × 4 rows: `rows` 20 ms, `dtypes` 6 ms per call. Repeated access in a loop is O(n) each time. | measured |
| 15 | **P3** | Errors carry one flat `ValidationError`; no way to distinguish a bad URL from a bad schema from a bad cell. | `src/errors/index.js` |
| 16 | **P3** | No streaming: whole file into a string, whole row set into memory. | `readSource` → `readFile(..., 'utf8')` |
| 17 | **P3** | Duplicate/empty header errors do not say which header or which position. | `parseCSV('a,a\n1,2\n')` → "Column names must be unique." |
| 18 | **P3** | `table()` on an empty dataset prints a bare border with no explanation. | `toTable()` → `"┌─────┬───┐\n│ idx │ a │\n├─────┼───┤\n└─────┴───┘\nShowing 0 of 0 rows.\n0 rows × 1 columns"` |
| 19 | **P2 correctness** | Delimiter detection reads only the **first physical line** and ignores `skipRows`. A preamble line with no delimiter (or the wrong one) poisons the whole import. | `parseCSV('report title\na;b\n1;2\n', {skipRows:1})` → columns `["a;b"]`, row `{"a;b":"1;2"}` — no error, silently wrong |

Not a defect, but a decision to revisit: default `trimStrings: true` mutates values (`'  Ada  '` → `'Ada'`), which conflicts with §5.3 "preserve original information where practical".

Excel: confirmed **absent** from Numeriq, and stays absent from Numiq.

---

## B. Numiq architecture

### B.1 Principles applied

1. TypeScript is the source of truth; declarations are **generated**, never hand-written (kills defect #6 by construction).
2. No Node built-ins reachable from the default entry point (kills #7). Environment is selected by `exports` conditions, not by the caller.
3. Strict separation: `io` parses and normalizes; `core` stores and inspects; nothing analytical enters v0.1.0.
4. Immutable transformations; the only mutable surface is documented (`Dataset` is frozen by convention, never by `Object.freeze` on hot paths).
5. Dependency direction is one-way and enforced in CI.

### B.2 Structure

```text
numiq/
├── src/
│   ├── core/
│   │   ├── dataset.ts          # Dataset class: storage, access, inspection, table()
│   │   ├── factory.ts          # createDataset() input normalization
│   │   ├── schema.ts           # ColumnSchema / dtype inference over a column
│   │   └── types.ts            # Row, ColumnName, DType, DatasetOptions, TableOptions
│   ├── io/
│   │   ├── index.ts            # public io surface
│   │   ├── parsers/
│   │   │   ├── csv.ts          # RFC4180-ish tokenizer + header handling
│   │   │   ├── json.ts         # record / array-of-arrays / column-oriented
│   │   │   └── index.ts
│   │   ├── normalization/
│   │   │   ├── policy.ts       # NormalizationPolicy + defaults
│   │   │   ├── values.ts       # normalizeCell, inferCellType
│   │   │   ├── schema.ts       # explicit per-column casting
│   │   │   └── report.ts       # ImportReport assembly, missing counts, warnings
│   │   ├── loaders/
│   │   │   ├── url.ts          # fetch-based; browser-safe
│   │   │   ├── source.ts       # Source type discrimination (string | URL | Blob | File | ArrayBuffer)
│   │   │   └── fs.ts           # NODE ONLY — never imported by src/index.ts
│   │   └── types.ts            # ImportFormat, ImportReport, LoadOptions
│   ├── display/
│   │   └── table.ts            # renderTable() + width/clip logic
│   ├── errors/
│   │   ├── base.ts             # NumiqError with code
│   │   └── index.ts            # ValidationError, ImportError, FormatError, EnvironmentError, ColumnNotFoundError
│   ├── utils/
│   │   ├── values.ts           # cloneValue, stableValue, isRecord
│   │   └── temporal.ts         # ISO detection + explicit-format parsing
│   ├── node.ts                 # Node entry: re-exports core + fs-backed loaders
│   ├── browser.ts              # Browser entry: core + Blob/File/URL loaders
│   └── index.ts                # Default entry (browser-safe); re-exported by node.ts
├── tests/
│   ├── unit/                   # parsers, normalization, table, stats-free core
│   ├── integration/            # loadCSV/loadJSON/loadTSV/loadURL end to end
│   ├── fixtures/               # csv/tsv/json files, including hostile ones
│   ├── types/                  # tsc --noEmit against a consumer .ts file
│   └── package/                # pack + install into a temp project, run both CJS and ESM
├── examples/
├── docs/
├── package.json
├── tsconfig.json               # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── tsup.config.ts (or tsc dual emit)
├── vitest.config.ts
├── eslint.config.js
├── README.md · CHANGELOG.md · LICENSE · .gitignore
```

### B.3 Module responsibilities

| Module | Owns | Must not |
|---|---|---|
| `core/dataset.ts` | Row storage, `columns`/`data`/`shape`/`rowCount`/`columnCount`/`length`/`schema`, `head`/`tail`/`info`, `table()` | Parse, fetch, compute statistics |
| `core/factory.ts` | Turning records / column-oriented objects / `Dataset` into a `Dataset` | Infer import metadata |
| `io/parsers` | Text → `RawRow[]` + column names | Touch the filesystem, build reports |
| `io/normalization` | Cell policy, schema casts, warnings | Know about file formats |
| `io/loaders` | Source → text (+content type) | Parse |
| `display/table` | Rendering only | Access `Dataset` internals |
| `errors` | Typed failures with codes | Depend on anything else |

### B.4 Environment split (fixes defect #7)

`package.json`:

```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "browser": "./dist/browser.js",
      "node": "./dist/node.js",
      "default": "./dist/index.js"
    },
    "./core": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  }
}
```

- `dist/index.js` — core + parsers + URL loading. **Zero Node built-ins.** `loadCSV('/path/file.csv')` throws `EnvironmentError` here.
- `dist/browser.js` — same API; string paths unsupported; `Blob`, `File`, `URL`, and response bodies supported.
- `dist/node.js` — same API plus `node:fs/promises` for local paths and `Buffer`/stream sources.

One import path for users (`import { loadCSV } from "numiq"`), no Node code in the browser graph, and `numiq/core` for bundle-sensitive consumers. Verified in CI by: bundling `src/index.ts` with a node-builtin-external error, and running the Node suite with `--conditions=browser`.

### B.5 Dependency direction (CI-enforced)

`errors ← utils ← core ← io ← index` and `core ← display`. `io` never imports `display`; `core` never imports `io`. Enforced with `dependency-cruiser` or a small `import/no-restricted-paths` ESLint rule, plus a cycle check.

---

## C. Public API proposal — v0.1.0

### C.1 Entry points

```ts
import Numiq, { createDataset, loadCSV, loadJSON, loadTSV, loadURL } from "numiq";
import { createDataset } from "numiq";        // named
import Numiq from "numiq";                     // default namespace, same members
```

The default export is an object whose members are exactly the named exports (`Numiq.createDataset === createDataset`). Asserted in tests so the two can never drift.

### C.2 Dataset

```ts
const data = createDataset([
  { name: "Alice", age: 24, revenue: 500 },
  { name: "Bob",   age: 31, revenue: 800 },
]);

data.columns;      // readonly string[]      ["name","age","revenue"]
data.data;         // readonly Row[]          frozen snapshot of rows
data.shape;        // readonly [number, number]  [2, 3]
data.rowCount;     // 2
data.columnCount;  // 3
data.length;       // 2
data.schema;       // Record<string, ColumnSchema>  { name: {type:'string',nullable:false}, ... }
data.dtypes;       // Record<string, DType>   shorthand for schema types
data.importReport; // ImportReport | null

data.head(5); data.tail(5); data.info();
data.column("revenue");  // ColumnView: name, values, type, missing, unique
data.table();            // string
```

Signatures:

```ts
createDataset(
  input: readonly Row[] | Readonly<Record<string, readonly unknown[]>> | Dataset,
  options?: DatasetOptions,
): Dataset;

interface DatasetOptions {
  columns?: readonly string[];         // required for array-of-arrays rows
  name?: string;
  metadata?: Readonly<Record<string, unknown>>;
  normalization?: Partial<NormalizationPolicy>;  // applied only to non-normalized input
}
```

### C.3 `table()`

```ts
table(options?: TableOptions): string;

interface TableOptions {
  maxRows?: number;        // default 1000; Infinity allowed
  maxColumns?: number;     // default 20
  maxCellWidth?: number;   // default 28
  showIndex?: boolean;     // default true, header label "idx"
  showShape?: boolean;     // default true
}
```

Behaviour: `idx` row label (never `index`), trailing `Showing 1000 of 50000 rows`, `50000 rows × 6 columns`, `… N more` column ellipsis, `NULL` for nullish cells, empty-dataset message instead of a bare border, and **no formatting work for rows beyond `maxRows`** (§6.2 "avoid formatting unnecessary rows"). `toTable()` kept as an alias for Numeriq familiarity.

### C.4 Loaders

```ts
loadCSV(source: Source, options?: LoadOptions & CsvOptions): Promise<Dataset>;
loadJSON(source: Source, options?: LoadOptions & JsonOptions): Promise<Dataset>;
loadTSV(source: Source, options?: LoadOptions & CsvOptions): Promise<Dataset>;
loadURL(url: string | URL, options?: LoadOptions & FormatOptions): Promise<Dataset>;

type Source = string | URL | Blob | File | ArrayBuffer | Uint8Array;

interface LoadOptions {
  name?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;                 // URL only
  headers?: Record<string, string>;     // URL only
  timeoutMs?: number;                   // URL only, default 30_000
}

interface CsvOptions {
  delimiter?: string;                   // single char; default detected
  header?: boolean;                     // default true
  columns?: readonly string[];
  skipRows?: number;
  trimStrings?: boolean;                // default false (changed from Numeriq)
  nullValues?: readonly string[];       // default [''] only
  schema?: Record<string, ColumnType | ColumnTypeSpec>;
  onInvalid?: "error" | "null";         // default "error"
  onRaggedRow?: "error" | "pad";        // default "error"
}

interface FormatOptions {
  format?: "csv" | "tsv" | "json";      // overrides detection
  contentType?: string;
}
```

Rules:
- Each loader honors its own format. `loadCSV('x.json')` **throws** `FormatError` instead of quietly parsing JSON (fixes defect #9).
- `loadURL` detects from `format` → URL path extension → `content-type`, in that order; unresolvable → `FormatError` listing what was seen.
- HTTP failures → `ImportError` with `status`; aborts → `AbortError` passthrough; unsupported `content-type` → `FormatError`.
- Local string paths work only in the Node build; in the browser build they throw `EnvironmentError` with a message pointing at `Blob`/`File`/`URL`.
- Parsers are also exported for in-memory use and are **synchronous and typed as such**: `parseCSV(text, options): Dataset`, `parseJSON(value | text, options): Dataset`, `parseTSV(text, options): Dataset` (fixes defect #6).

### C.5 Import report

```ts
interface ImportReport {
  format: "csv" | "tsv" | "json";
  source: string;                       // path, URL, or "memory"
  rowsRead: number;
  rowsImported: number;
  columns: readonly string[];
  missingByColumn: Readonly<Record<string, number>>;
  warnings: readonly ImportWarning[];   // { code, message, row?, column? }
  normalization: Readonly<NormalizationPolicy>;
  delimiter?: string;                   // csv/tsv
  contentType?: string;                 // url
}
```

Attached to the dataset as `dataset.importReport`, deeply frozen, and `null` for datasets built with `createDataset`. It lives on the dataset, never inside analytical results (§5.4), so future analysis results stay free of import metadata.

### C.6 Errors

```ts
NumiqError extends Error            { code: NumiqErrorCode }
ValidationError extends NumiqError  // bad arguments / bad shapes
ImportError extends NumiqError      // source unreachable, HTTP status, unreadable body
FormatError extends NumiqError      // undetectable or unsupported format, malformed text
EnvironmentError extends NumiqError // API used outside its environment
ColumnNotFoundError extends NumiqError
```

### C.7 Deliberate behaviour changes from Numeriq (need sign-off)

| # | Change | Reason |
|---|---|---|
| 1 | Default `nullValues` is `['']` only, not `['null','undefined','n/a','na']` | Fixes Namibia-style data loss (#1); explicit opt-in restores old behaviour |
| 2 | Integers outside `Number.MAX_SAFE_INTEGER` stay strings and emit a warning | Fixes silent precision loss (#2) |
| 3 | Values are not trimmed by default; header names always are | §5.3 preserve original data |
| 4 | Date strings are **not** auto-converted; `dtypes` never claims `'date'` for a string | Fixes #11; dates arrive via `schema: { d: 'date' }` |
| 5 | Local paths are unconstrained (no `dataset/` sandbox) | Fixes #8; this is a library, not an app |
| 6 | `table()` is the canonical name; `toTable()` aliases it | §6.2 |
| 7 | `describe()` and all analytics are **absent** from v0.1.0 | §18 scope control; no placeholders |
| 8 | `loadMany`, `loadData`, `useSampleDataset` are not carried over | Out of the approved v0.1.0 list |

### C.8 Explicitly out of scope for v0.1.0

Excel/XLSX, statistics, `describe`, grouping, aggregation, querying, filtering, sorting, joins, reshape, charts, dashboards, insights, metrics, schema-validation engine, lineage, pipelines.

---

## D. v0.1.0 implementation plan

Every milestone ends green (tests + `tsc --noEmit` + build) before the next begins, and each lands on its own branch.

### M0 — Toolchain (no library code)

Scaffold: `package.json` (`numiq@0.1.0`, MIT, `files: ["dist"]`, `engines.node >= 18`, `sideEffects: false`), strict `tsconfig.json`, dual ESM/CJS + `.d.ts` build, Vitest, ESLint + Prettier, `.gitignore`, `LICENSE`.

**Acceptance:** `npm run build` produces `dist/{index,node,browser}.{js,cjs,d.ts}`; `npm test` runs an empty-but-real suite; `npm run lint` and `npm run typecheck` pass; `npm pack --dry-run` lists only intended files.

### M1 — Errors + utils

Error hierarchy with codes; `cloneValue`, `stableValue`, `isRecord`; temporal ISO detection.

**Tests:** every error carries its `code` and `instanceof` chain; `cloneValue` deep-copies `Date`/arrays/objects without sharing references; malformed dates rejected.
**Acceptance:** no `any` in public types; 100 % of exported error classes exercised.

### M2 — Dataset core + `table()`

`createDataset` (records, column-oriented, `Dataset`), `Dataset` with `columns`/`data`/`shape`/`rowCount`/`columnCount`/`length`/`schema`/`dtypes`, `head`/`tail`/`info`/`column`, `renderTable` + `table()`.

**Tests:** shapes and counts for 0-row, 0-column, 1-row, wide (25 cols), ragged input; `data` immutability (mutating the returned array must not affect the dataset); `table()` shows `idx`, respects `maxRows` (asserting a 5 000-row dataset renders in bounded time and only `maxRows` cells), prints `Showing 1000 of 50000 rows`, handles empty and wide datasets, `maxRows: 0`.
**Acceptance:** §6.1/§6.2 fully met; `Numiq.createDataset === createDataset`.

### M3 — CSV/TSV parser + normalization

Tokenizer (RFC 4180 quoting, CRLF-inside-quotes normalized to `\n`, BOM, blank rows, ragged handling, delimiter vote across several lines), header repair rules with positional error messages, normalization policy, explicit schema casting, import report.

**Tests:** all §A.2 passing cases ported as fixtures; plus inch-mark handling decided explicitly (default: tolerate a bare `"` inside an unquoted field, warn), CRLF multi-line cell equality, duplicate/empty header errors naming the position, `NA` preserved, big integers preserved as strings, phone-like values preserved, `trimStrings: false` default, `skipRows`, `header: false`, `onRaggedRow`, `onInvalid`, empty input, header-only input.
**Acceptance:** every Numeriq CSV behaviour either reproduced or intentionally changed with a test asserting the new behaviour; no `any`.

### M4 — JSON parser

Records, array-of-arrays with `columns`, column-oriented objects, `null` vs missing distinction, schema casts, warnings.

**Tests:** equal-length enforcement, pad-with-warning, top-level scalar rejection, nested objects preserved (not flattened, dtype `mixed`), empty array with `columns`, schema-cast failures.
**Acceptance:** report parity with CSV (`rowsRead`, `rowsImported`, `missingByColumn`).

### M5 — Loaders: `loadCSV`/`loadJSON`/`loadTSV`/`loadURL` + environment split

Source discrimination, Node fs loader (outside the default graph), Blob/File loader, fetch loader with timeout/abort/status mapping, format detection and `FormatError`.

**Tests:** local fixtures; a real `node:http` server for 200/404/500, wrong `content-type`, missing extension, `format` override, abort, timeout; `loadCSV('x.json')` throws; browser build rejects string paths with `EnvironmentError`; bundler check asserting no `node:` specifier is reachable from `dist/index.js`; Node suite run with `--conditions=browser`.
**Acceptance:** §5.1/§5.2 met; Excel absent; no runtime dependency added.

### M6 — Packaging, docs, examples, release prep

README (intro, install, quick start, formats, TS + JS usage, compatibility, dev, test, license), `docs/api/*.md` for every public export, runnable examples, `CHANGELOG.md` for 0.1.0, declaration test (`tsc --noEmit` on a consumer file), package-consumer test (`npm pack` → install in a temp dir → run ESM **and** CJS consumers → assert output).

**Acceptance:** §19 checklist complete; `npm pack` contents inspected; consumer test passes in a clean directory; no `node_modules`, no secrets, no dev files in the tarball.

### Verification commands (run for every milestone)

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm pack --dry-run
```

---

## E. Repository initialization — needs approval

Not done yet, because §23.E gates it on review, and `github.com/munachi-me/numiq` currently returns **404** (it does not exist).

On approval I will:

1. Create `munachi-me/numiq` (private until you say otherwise), MIT, no README from template.
2. Commit M0 scaffold on `chore/toolchain`, push, and report — then continue milestone by milestone on `feat/<milestone>` branches.
3. Never merge to `main`, tag, or publish without explicit approval per §20.

### Decisions I need from you

1. **Behaviour changes in §C.7** — accept all eight, or keep any Numeriq behaviour?
2. **Environment split (§B.4)** — conditional `exports` with a browser build, or two explicit packages/subpaths instead?
3. **Default `trimStrings: false`** and **date strings not auto-typed** — accept, or match Numeriq?
4. **`table()` canonical with `toTable()` alias** — accept?
5. **GitHub repo creation** — private first? Default branch `main`?
6. **Runtime dependencies** — I propose zero for v0.1.0. Confirm.
