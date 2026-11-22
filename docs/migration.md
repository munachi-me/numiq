# Migrating to 1.0.0

Numiq `1.0.0` stabilizes the API that grew through `0.1.0`–`0.12.0`. For most projects this
is a no-op upgrade: no export was removed, renamed, or given a new signature. Two things
changed during the pre-1.0 series that a project pinned to an early version must account
for.

## From 0.1.0 – 0.2.0

### Local loading is sandboxed to `dataset/`

**Breaking.** `0.2.0` stopped accepting arbitrary local paths. Absolute paths, `..`, any
path separator, null bytes, and symlinks resolving outside the folder are rejected.

Before:

```ts
const sales = await loadCSV("./data/sales.csv");
const config = await loadCSV("/etc/reports/config.csv");
```

After — files live in `<projectRoot>/dataset/`, by filename only:

```text
project-root/
├── dataset/
│   └── sales.csv
└── src/
```

```ts
const sales = await loadCSV("sales.csv"); // reads <cwd>/dataset/sales.csv
```

If your script does not run from the project root, pass `datasetDir`:

```ts
const sales = await loadCSV("sales.csv", { datasetDir: "/path/to/project" });
```

Data that must live elsewhere is not unreachable — it just does not come from the local
filesystem loader:

```ts
const remote = await loadCSV("https://example.com/sales.csv"); // URL
const parsed = await loadCSV(buffer); // in-memory
const picked = await loadCSV(file); // Blob / File
```

This is a security boundary, not a style preference: it stops a dataset name from reading
an arbitrary file. It is not relaxed in `1.0.0`.

### Derived datasets report no import report

**Breaking.** `head`, `tail`, `filter`, `sort`, `select`, and `limit` return `importReport`
as `null`, because the report describes an import and a derived dataset did not import
anything. If you read `importReport` after a transform, keep the original:

```ts
const source = await loadCSV("sales.csv");
const report = source.importReport; // the import's report
const top = source.head(10); // top.importReport === null
```

### Rows and metadata are frozen

**Breaking if you mutated them.** `columns`, `schema`, `importReport`, `metadata`, and every
row are frozen. A `filter` predicate that assigned to its row argument used to rewrite the
source dataset; that now throws in strict mode instead of corrupting data.

Before:

```ts
data.filter((row) => {
  row.total = row.price * row.qty;
  return true;
}); // mutated the source
```

After — derive a column instead of mutating a row:

```ts
data.addColumn("total", (row) => row.price * row.qty);
```

## From 0.2.0 onward

No further breaking changes landed before `1.0.0`. Releases `0.3.0`–`0.12.0` were additive:
the preparation engine, query engine, grouping and aggregation, `describe()`, advanced
statistics, metrics and insights, conditional joins and reshape, window functions and time
series, pipelines with schema validation and lineage, and the `0.12.0` performance work.
Upgrading from any `0.3.0`+ release needs no code change.

## Internal helpers are no longer exported

`inferColumnType` and `describeColumn` were removed from the public surface in `0.2.0` —
they were internal helpers that had leaked. If you imported them, use the documented
equivalents: `Dataset.info()` for column types and `describe()` for column statistics.

## What 1.0.0 means for you

- Every export in the stable surface is documented in `docs/api.md`.
- Semantic versioning applies from here: breaking changes need a major release. See
  [compatibility.md](./compatibility.md).
- The API surface is frozen. If something is missing, it is added in a minor release — no
  existing call has to change to get it.
