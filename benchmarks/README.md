# Benchmarks

Reproducible measurements of Numiq's hot paths, used to decide what to optimize and to
prove that a change helped.

## Running

```bash
npm run bench                          # full suite, human-readable
npm run bench -- --filter describe     # one group or case
npm run bench:json                     # full suite, writes benchmarks/results/latest.json
npm run typecheck:benchmarks           # type-check the benchmark sources
```

Benchmarks run through `tsx` against `src/`, so they measure the source directly rather
than a build artifact. Build the package with `npm run build` before timing `dist/` if
you need to confirm the published output behaves the same.

## Method

Three rules make the numbers comparable between runs:

1. **Warm up first.** Each case runs three untimed times so the JIT has compiled the code.
2. **Report the median of nine samples.** A mean is pulled around by a single GC pause; the
   median is not. The minimum and 95th percentile are printed alongside it, so a wide gap
   between them is visible as noise rather than hidden inside one number.
3. **Generate data from a seeded PRNG.** Every run measures the same rows. A benchmark
   whose input changes between runs cannot show whether a change helped.

A `consume()` call keeps each result reachable, so the engine cannot discard work whose
value is unused and time nothing at all.

## What is measured

| Group     | Cases                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| construct | `createDataset` from records                                                   |
| access    | `data` (defensive copy), `schema`, `info()`                                    |
| transform | `filter`, `sort`, `select`, `groupBy().aggregate()`, `describe()`, `toTable()` |
| join      | inner join of 100,000 fact rows against 200 dimension rows                     |
| parse     | `parseDelimited` on 10,000 and 50,000 rows of CSV text                         |
| chunk     | `chunkDelimited` and `reduceChunks` at 1,000 rows per chunk                    |
| interchange | `toTableData`, `toInterchange`, and `toCSV` on 25,000 rows                   |
| pipeline  | a four-step chain over 25,000 rows                                             |

Sizes are 1,000 / 25,000 / 100,000 rows for the dataset groups. The join uses a unique key
on the dimension side: joining on a low-cardinality column such as `region` is
many-to-many, and the row explosion would measure something other than probe cost.

## Recorded results (v0.12.0)

Measured on Node v24.22.2. `benchmarks/results/baseline-0.11.1.json` holds the
pre-optimization run and `benchmarks/results/latest.json` the post-optimization run;
`benchmarks/results/` is committed so the comparison survives.

| Case                    | 1,000 | 25,000 | 100,000 |
| ----------------------- | ----- | ------ | ------- |
| `createDataset`         | 0.8ms | 21.4ms | 73.6ms  |
| `data` (full copy)      | 0.5ms | 5.4ms  | 32.1ms  |
| `info()`                | 1.1ms | 7.1ms  | 28.7ms  |
| `filter`                | 0.2ms | 3.4ms  | 16.4ms  |
| `sort`                  | 0.9ms | 19.0ms | 125.4ms |
| `select`                | 0.5ms | 4.8ms  | 19.9ms  |
| `groupBy().aggregate()` | 0.4ms | 8.3ms  | 39.7ms  |
| `describe()`            | 3.1ms | 77.4ms | 325.9ms |
| `toTable()`             | 2.0ms | 2.0ms  | 2.0ms   |

| Case                               | Time    |
| ---------------------------------- | ------- |
| inner join, 100,000 × 200          | 119.6ms |
| `parseDelimited`, 10,000 rows      | 19.6ms  |
| `parseDelimited`, 50,000 rows      | 116.2ms |
| pipeline, 4 steps over 25,000 rows | 17.4ms  |

## Change from v0.11.1

Only two cases moved beyond noise, and both were targeted from these measurements:

| Case (100,000 rows) | v0.11.1  | v0.12.0 | Change   |
| ------------------- | -------- | ------- | -------- |
| `describe()`        | 1312.5ms | 325.9ms | **-75%** |
| `sort`              | 156.7ms  | 125.4ms | **-20%** |

Every other case is within run-to-run variance, which is the expected result: they were
measured and left alone. Numbers that moved by less than 8% between runs were not treated
as improvements.

### Why `describe()` was slow

Profiling one numeric column called `quartiles()`, `iqr()`, and `median()` separately, and
each sorted the whole column. `iqr()` sorted three more times to get its quartiles. With
requested percentiles, every percentile sorted again — seven full sorts of the same values
for one column. `unique` and `mode` each built the same frequency map, hashing the column
twice.

The fix shares one sort and one frequency pass across every statistic. The values are
identical because they all read the same ordering; the tests in `tests/unit/describe.test.ts`
pin each statistic against its standalone reference function to keep it that way.

### Why `sort()` was slow

The comparator read `row[column]` twice per comparison, about `n log n` times. Keys are now
read once per row and carried into the comparator, which compares plain values. Ties keep
source order through the language's stable sort rather than an explicit index comparison.

## Known limits

- **Every transform copies.** `filter`, `sort`, and `select` each build a new dataset, so a
  chain of _k_ steps touches the data _k_ times. This is deliberate: rows are frozen and
  shared, and copy-on-write would make aliasing observable. Chaining ten transforms on
  100,000 rows costs roughly ten constructor passes.
- **`data` is a deep copy on every read.** It is the documented contract — callers get
  values they may mutate — and the copy is proportional to dataset size. Read it once and
  keep the result rather than calling it inside a loop.
- **Memory scales with the dataset, not the column.** Rows are objects, so a wide dataset
  pays per-column property overhead. A columnar store would cut memory and speed up
  `describe()`, but it would change what `data` returns and is a breaking change.
- **Joins hold the whole right side in memory.** The hash index is built from the smaller
  side as written; a very large right side will not stream.
- **`describe()` is the most expensive single call** at roughly 3.3ms per 100,000 rows per
  column. It is proportional to column count, so profile a subset with
  `describe(column)` when only one column matters.
- **No streaming import.** `parseDelimited` needs the whole document as a string. Chunked
  parsing was considered and rejected for this release: it needs an incremental tokenizer
  and a story for how a partial dataset is exposed, and nothing measured here justified
  that complexity.

## Adding a case

Add a `bench()` call in `benchmarks/run.ts` inside the relevant group. Keep the case
measuring one public operation, and keep its input seeded so runs stay comparable.
