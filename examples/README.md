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

The examples import `numiq` by package name. To run them before publishing, either
`npm link` the package or build and point your tool at `dist/`.
