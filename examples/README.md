# Examples

Each file is a runnable program against the built package.

```bash
npm run build
npx tsx examples/01-load-and-inspect.ts
```

| File | Shows |
| --- | --- |
| `01-load-and-inspect.ts` | Loading a CSV and inspecting it |
| `02-type-casting.ts` | Casting columns to numbers and dates |
| `03-normalization.ts` | Default versus opted-in normalization |
| `04-json-and-tsv.ts` | JSON and TSV through the same `Dataset` |
| `05-errors.ts` | Catching typed errors |
| `06-sample-and-chaining.ts` | The bundled sample dataset and a fluent chain |
| `07-preparation.ts` | Cleaning, deriving columns, de-duplicating and sampling |
| `08-query.ts` | Structured queries: operators, precedence, grouping, and reuse |
| `09-grouping.ts` | Grouping and aggregation: totals, dispersion, missing values, custom aggregators |
| `10-describe.ts` | Descriptive statistics: profiling columns, quartiles, percentiles, type-aware nulls |
| `11-advanced-statistics.ts` | Advanced statistics: correlation, matrices, shape, outliers, z-score columns |
| `12-metrics-and-insights.ts` | Metrics that keep their definition, and insights that carry their evidence |
| `13-conditional-joins-reshape.ts` | Conditional columns from ordered rules, joins, and pivot/melt/concat |
| `14-windows-and-time-series.ts` | Ranking, offsets, running and moving values, and calendar resampling |
| `15-pipelines-and-validation.ts` | Reusable pipelines, schema validation reports, and lineage |

The examples read from the project-root `dataset/` folder by filename, so run them from
the repository root. They import `numiq` by package name; to run them before publishing,
either `npm link` the package or build and point your tool at `dist/`.
