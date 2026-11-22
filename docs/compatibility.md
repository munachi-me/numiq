# Compatibility

Numiq is at `1.0.x`. From here the public API is stable: it follows semantic versioning,
and a breaking change requires a major release with a documented migration path.

## Semantic versioning policy

The public API is every value exported from the package entry points (`@munachi-me/numiq` and
`@munachi-me/numiq/core`) plus every public member of the exported classes and interfaces. Anything not
exported is internal and may change in a minor release.

| Change                                         | Release |
| ---------------------------------------------- | ------- |
| Remove or rename an export                     | major   |
| Change a signature, return type, or default    | major   |
| Change behaviour that existing code depends on | major   |
| Narrow an accepted input                       | major   |
| Add an export, method, or option               | minor   |
| Fix behaviour to match documentation           | patch   |
| Internal refactor, performance work            | patch   |
| Documentation only                             | patch   |

Rules we hold to:

- **Additive is minor, never patch.** New exports appear in a minor release.
- **Bug fixes that match documented behaviour are patch.** If the docs said one thing and
  the code did another, the code moves to the docs.
- **Deprecation before removal.** A deprecated API keeps working for at least one minor
  release and carries a `@deprecated` tag naming the replacement.
- **No silent behaviour changes.** If a value would change, it is a major release with a
  migration note, even when the new value is more correct.

## Node.js support

| Version  | Status                                                                 |
| -------- | ---------------------------------------------------------------------- |
| 18.x     | supported (minimum, `engines.node: ">=18"`)                            |
| 20.x     | supported (CI)                                                         |
| 22.x     | supported (CI)                                                         |
| 24.x     | used by the release workflow; expected to work, not in the test matrix |
| 23+, 25+ | expected to work, not tested                                           |

Node 18 is the floor because the local-file loader uses `node:fs/promises` `realpath` and
the package ships ESM with a CommonJS build. Both module systems are tested on every
supported version.

## Browser and bundler support

| Environment                       | Status                           |
| --------------------------------- | -------------------------------- |
| Chrome / Edge (current)           | supported                        |
| Firefox (current)                 | supported                        |
| Safari 16+                        | supported                        |
| Vite, Rollup, webpack 5, esbuild  | supported                        |
| Node-style `require` in a bundler | supported via the CommonJS build |

The browser entry (`@munachi-me/numiq`) is pure JavaScript with **no runtime dependencies** and no
Node built-ins. The Node entry (`@munachi-me/numiq` under the `node` condition) adds the local-file
loaders; bundlers must not pull `node:fs` into a browser build, which the `browser` export
condition prevents.

`loadURL` uses `fetch`, so it works anywhere `fetch` exists (all the browsers above, Node 18+).

## Module formats

| Consumer          | Import                                             | Resolves to              |
| ----------------- | -------------------------------------------------- | ------------------------ |
| ESM in Node       | `import Numiq from "@munachi-me/numiq"`            | `dist/esm/node.js`       |
| CommonJS in Node  | `const Numiq = require("@munachi-me/numiq")`       | `dist/cjs/node.js`       |
| Bundler / browser | `import Numiq from "@munachi-me/numiq"`            | `dist/esm/index.js`      |
| Core only         | `import { Dataset } from "@munachi-me/numiq/core"` | no filesystem or network |

Types are generated for every entry point, so both module systems get accurate declarations.

## Data preservation

Values are preserved on import unless a `NormalizationPolicy` says otherwise. Normalization
is explicit and reported: every import returns an `ImportReport` listing what changed.
Nothing is coerced silently — a column that looks numeric but contains a non-numeric value
stays a string column rather than dropping or mangling the value.

`Dataset.data` returns a deep copy, so a consumer cannot mutate internal state by accident.
This costs time on large datasets; use `toTable({ maxRows })` for display and iterate with
`rows()` when reading every row.
