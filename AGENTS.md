# AGENTS.md

Repository notes for anyone — human or agent — changing Numiq.

## What this is

Numiq is a TypeScript data-science engine published as an npm package. It has **no runtime
dependencies**, and that is enforced in CI rather than trusted: `check:no-runtime-deps`
fails the build if a runtime dependency appears.

The library is pure: parsing, transforms, and statistics run in-process with no I/O except
the explicit `load*` helpers.

## Commands

```bash
npm run verify      # the gate — run this before every commit
npm run build       # tsc to dist/ (ESM + CJS + browser entry)
npm run test        # vitest unit + integration
npm run test:types  # type-level contract tests
npm run bench       # benchmarks (see benchmarks/README.md)
```

`verify` chains typecheck, lint, format check, cycle check, tests, type tests, package
checks, and the no-runtime-deps check. A release is not ready until `verify` is green on
the merged branch, not just on the feature branch.

Other useful scripts: `npm run typecheck:examples`, `npm run typecheck:benchmarks`,
`npm run examples`, `npm run check:cycles`, `npm run test:package`.

## Layout

| Path                                                | Holds                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/`                                         | `Dataset`, `Query`, grouping, joins, preparation, schema, pipeline |
| `src/analytics/`                                    | `describe()`, statistics, advanced statistics                      |
| `src/io/`                                           | loaders, parsers, normalization                                    |
| `src/display/`                                      | table rendering                                                    |
| `src/insights/`, `src/metrics/`                     | higher-level analysis helpers                                      |
| `src/utils/`                                        | value cloning, comparison, freezing                                |
| `benchmarks/`                                       | benchmark harness and recorded results                             |
| `tests/unit/`, `tests/integration/`, `tests/types/` | vitest suites                                                      |

## Conventions

- **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`. Indexing an array yields
  `T | undefined`; assert or narrow rather than adding `!`.
- **Imports carry the `.js` extension** (NodeNext), even from `.ts` sources.
- **No import cycles.** `check:cycles` fails on any. Keep `utils/` at the bottom of the
  dependency graph.
- **Errors** come from `src/errors/`. Use the specific class (`ValidationError`,
  `ColumnNotFoundError`, `FormatError`) rather than a bare `Error`.
- **Comments explain why, not what.** Non-obvious invariants, workarounds, and deliberate
  trade-offs get a comment; a restatement of the code does not.

## Invariants worth knowing before you change anything

- **Datasets are immutable.** Rows are frozen at construction and `#rows` is frozen. A
  transform never mutates; it builds a new dataset. `data` returns a deep copy on every
  read, which is the documented contract.
- **Cells are normalized once.** `createDataset` runs `normalizeCell` on input; derived
  datasets are marked `NORMALIZED` and only clone. Adding normalization to a derived path
  changes behaviour for already-clean data.
- **`describe()` shares one sort and one frequency pass.** Statistics read the same sorted
  array and the same counts. If you add a statistic, take it from those; do not re-sort or
  re-hash. `tests/unit/describe.test.ts` pins each value against its standalone function.
- **`sort()` relies on stable sort for ties.** Missing values sort last in both directions.
  `tests/unit/dataset.test.ts` covers tie order and missing-value order.
- **Group order is first-appearance order**, not sorted, so results are deterministic.
- **The public surface is tested for parity.** `tests/unit/api.test.ts` asserts that every
  named export also appears on the default export. Adding an export means adding it to both
  and updating `tests/types/exports.test-d.ts`.

## Performance work

**Measure first.** `benchmarks/` exists so a change can be justified by a number instead
of a hunch. The method (warmup, median of nine samples, seeded data) is in
`benchmarks/README.md`, along with recorded results and known limits.

When optimizing:

1. Run `npm run bench` and keep the output.
2. Find where the time actually goes — profile, do not guess. Two hypotheses in v0.12.0
   were wrong and were reverted rather than kept.
3. Make one change.
4. Re-run the tests **and** the benchmark. A change that does not move a number beyond
   noise (roughly 8% here) is not worth keeping.
5. Revert anything unproven, including your own work.

`describe()` and `sort()` are the hot paths that matter. `toTable()` is bounded by
`maxRows` and is not one.

## Stable surface (since 1.0.0)

The API is frozen and follows semantic versioning; the policy is in
`docs/compatibility.md`. Before adding an export, ask whether it is necessary — a new
export is a permanent commitment, not a convenience. Anything not exported is internal and
free to change in a minor release.

- **Every export is documented.** `docs/api.md` covers all 93 runtime exports. An export
  without documentation is an incomplete change.
- **No breaking change without a major release** and a note in `docs/migration.md`.
- **Node 18, 20, and 22 are the support matrix**, enforced by CI. `engines.node` is `>=18`
  because `test-package.mjs` avoids `import.meta.dirname` (Node 20.11+) for that reason.
- **The local-file sandbox is a security boundary, not a preference.** Absolute paths,
  `..`, path separators on both platforms, null bytes, and symlinks resolving outside
  `dataset/` are refused; containment is checked on `realpath` results.
  `tests/integration/loaders.test.ts` pins each case — including a symlink escape, which
  is the one only `realpath` catches. Do not relax these to make a test pass.

## Release flow

Feature branch → PR → squash merge → annotated tag → GitHub release. Verify on merged
`main` before tagging. The spec files in the repo root are local-only and gitignored; do
not commit them.

CI (`.github/workflows/ci.yml`) runs `npm run verify` and a clean consumer install on Node
18/20/22.

Publishing is a separate, explicitly approved step. `.github/workflows/publish.yml` runs on
a `v*` tag and authenticates to npm with **OIDC trusted publishing** — there is no
`NPM_TOKEN` secret anywhere. It refuses to publish unless the tag matches
`package.json` and the tagged commit is an ancestor of `main`. GitHub Packages reuses the
ephemeral `GITHUB_TOKEN`.

Trusted publishing needs npm CLI 11.5.1+ and Node 22.14+, so the workflow installs
`npm@11` explicitly rather than trusting the runner image. It also omits `registry-url`
on `setup-node`: that input writes an `.npmrc` with `_authToken=${NODE_AUTH_TOKEN}`, which
is empty in this workflow and can shadow the OIDC exchange.

The trusted-publisher link on npm must be created interactively by a maintainer with 2FA.
Granular tokens that bypass 2FA are rejected with E403 for this action, so it cannot be
scripted. Configure once:

```bash
npm trust github @munachi-me/numiq --file publish.yml --repo munachi-me/numiq --allow-publish
```

Never publish without the developer's approval.
