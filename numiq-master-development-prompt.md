# NUMIQ — MASTER DEVELOPMENT PROMPT
## Complete Development Specification: Project Initialization to Production Release

You are the lead software architect and senior TypeScript engineer responsible for designing, developing, testing, documenting, and preparing **Numiq** for production release.

Your task is to build Numiq as a professional, modular, reliable, extensible JavaScript data analysis and manipulation library.

Do not treat this as a small demonstration project. Build it with the architectural discipline expected of a serious open-source npm package.

---

# 1. PROJECT IDENTITY

**Name:** Numiq  
**npm package:** `numiq`  
**GitHub repository:** `munachi-me/numiq`  
**Initial version:** `0.1.0`  
**Language:** TypeScript  
**Module compatibility:** ESM and CommonJS where practical  
**License:** MIT unless otherwise specified.

Numiq is a standalone JavaScript data analysis engine.

Its purpose is to give JavaScript and TypeScript developers powerful tools for loading, preparing, manipulating, exploring, and analyzing structured data.

The library should provide a developer experience inspired by the convenience and expressiveness of tools such as pandas and NumPy, while remaining natural to JavaScript.

### Core responsibilities

- Data loading and importing.
- Data normalization.
- Dataset creation and management.
- Data cleaning and preparation.
- Data transformation.
- Data querying and manipulation.
- Statistical analysis.
- Aggregation and grouping.
- Metrics and analytical insights.

Numiq should prioritize a clean API, predictable behavior, performance, extensibility, and excellent developer experience.

---

# 2. IMPORTANT PROJECT DISTINCTIONS

There is an existing project named **Numeriq**.

The new project is called **Numiq**. These are different projects.

The existing Numeriq repository is:

`https://github.com/munachi-me/numeriq`

The new Numiq repository is:

`https://github.com/munachi-me/numiq`

Do not confuse the two repositories or treat the existing project as the new project's foundation without evaluating its code.

The existing Numeriq repository is a temporary reference for auditing and extracting reusable functionality.

The developer intends to retire and eventually delete the old Numeriq repository.

Therefore:

1. Inspect the old project's relevant source code.
2. Identify reusable import and normalization functionality.
3. Understand its dependencies and internal architecture.
4. Extract useful algorithms and implementation ideas.
5. Rewrite or adapt the code to fit Numiq's architecture.
6. Test the extracted functionality independently.
7. Never make the new Numiq package depend on the old Numeriq repository.

Do not copy the old project wholesale.

The new project must have its own identity, implementation, tests, documentation, and release history.

---

# 3. TECHNOLOGY REQUIREMENTS

Use TypeScript as the primary development language.

### TypeScript requirements

- Strict TypeScript configuration.
- Avoid unnecessary `any`.
- Use meaningful interfaces and type definitions.
- Export public types.
- Maintain clear separation between internal and public APIs.
- Generate JavaScript during the build process.
- Generate `.d.ts` declaration files.
- Ensure JavaScript users can consume the compiled package without installing TypeScript.

### Dependencies

Keep runtime dependencies minimal.

TypeScript, test runners, build tools, linters, and development utilities must be development dependencies unless genuinely required at runtime.

Do not introduce dependencies merely to avoid writing a small, maintainable utility.

Before adding any runtime dependency, explain:

- Why it is needed.
- What functionality it provides.
- Whether a native implementation is practical.
- Its impact on bundle size and compatibility.

### Development tooling

Choose stable, mutually compatible tooling for:

- TypeScript compilation.
- Automated testing.
- Linting.
- Formatting.
- Build verification.
- Package validation.

Use Vitest or another suitable testing framework.

Avoid unnecessary heavyweight dependencies.

---

# 4. ARCHITECTURAL PRINCIPLES

Numiq must follow these principles.

### 4.1 Modular architecture

Separate importing, normalization, datasets, transformations, analytics, statistics, metrics, utilities, and errors into independent modules.

Avoid building one enormous class that contains every feature.

### 4.2 Consistent dataset structure

Regardless of the original data format, successfully imported data must be converted into a consistent Numiq Dataset representation.

### 4.3 Separation of concerns

Importing should not perform analytical operations.

Normalization should not contain dataset management logic.

Analytics should not duplicate unnecessary dataset metadata.

### 4.4 Predictable APIs

Methods should have consistent naming, arguments, return types, error behavior, and documentation.

### 4.5 Immutability

Prefer immutable operations for transformations.

Operations that modify data should clearly document their behavior. Avoid unexpected mutation of original datasets.

### 4.6 Extensibility

Design modules so new import formats, analytical functions, transformation operations, and integrations can be introduced without restructuring the entire library.

### 4.7 Environment compatibility

Design with Node.js and browser compatibility in mind.

Separate Node-specific file-system functionality from browser-compatible functionality.

Do not allow Node-only modules to break browser consumers.

### 4.8 No circular dependencies

Maintain a clear dependency direction between modules.

The core Dataset abstraction must not depend on visualization or reporting functionality.

---

# 5. DATA IMPORT AND NORMALIZATION ENGINE

This is one of the first major development priorities.

The existing Numeriq project contains potentially reusable import functionality. Audit it before implementing replacements.

Relevant old project modules include:

- `src/io/loaders.js`
- `src/io/parsers.js`
- `src/io/normalization.js`

Also inspect the utilities, errors, dataset factory, and tests those modules depend on.

Do not assume these files can be copied directly.

## 5.1 Supported formats for v0.1.0

Implement:

1. CSV.
2. JSON.
3. TSV.
4. HTTP(S) URL imports for supported formats.

**Excel importing is explicitly excluded.**

Do not implement XLS or XLSX importing in this release.

Do not install Excel parsing dependencies.

Excel support can be reconsidered in a future version.

## 5.2 Import functionality

Provide intuitive import methods.

Proposed API:

```ts
import {
  loadCSV,
  loadJSON,
  loadTSV,
  loadURL
} from "numiq";

const sales = await loadCSV("sales.csv");
const users = await loadJSON("users.json");
const records = await loadTSV("records.tsv");
const remote = await loadURL("https://example.com/data.csv");
```

Local file loading must be handled in the appropriate Node.js environment.

Browser users should be able to supply supported File, Blob, or other appropriate input sources without requiring access to Node's filesystem.

Do not expose Node-only functionality through browser entry points.

For URL imports:

- Support HTTP and HTTPS.
- Handle failed requests.
- Handle invalid responses.
- Handle unsupported content types.
- Avoid silently interpreting incorrect data.
- Support format detection using appropriate response metadata and file extensions.
- Allow explicit format selection where automatic detection is ambiguous.

## 5.3 Normalization

All imported data must pass through a normalization stage.

Normalization should handle:

- Consistent column names.
- Consistent row structures.
- Missing values.
- Null values.
- Numeric values.
- Boolean values.
- String values.
- Date values where explicitly supported.
- Mixed data types.
- Empty datasets.
- Inconsistent records.
- Schema validation.
- Optional schema-based type conversion.

Do not convert values aggressively when their intended meaning is ambiguous.

Preserve original information where practical.

Provide meaningful import warnings instead of silently discarding problematic values.

## 5.4 Import reports

Consider returning useful import metadata alongside the Dataset, including:

- Original source.
- Detected format.
- Number of rows imported.
- Number of columns.
- Warnings.
- Normalization information.
- Import errors where applicable.

Keep this information separate from the analytical result model.

---

# 6. DATASET ENGINE

The Dataset is the central abstraction of Numiq.

It should provide a consistent interface for accessing, inspecting, manipulating, and analyzing structured data.

Proposed usage:

```ts
import Numiq, {
  createDataset
} from "numiq";

const data = createDataset([
  { name: "Alice", age: 24, revenue: 500 },
  { name: "Bob", age: 31, revenue: 800 }
]);

console.log(data);
console.log(data.columns);
console.log(data.shape);
console.log(data.data);
```

Both default and named exports must work.

For example:

```ts
import Numiq from "numiq";

const data = Numiq.createDataset(records);
```

And:

```ts
import {
  createDataset
} from "numiq";

const data = createDataset(records);
```

The default export must expose the intended public API consistently with named exports.

## 6.1 Dataset properties

Design and implement appropriate Dataset properties, including:

- `columns`
- `data`
- `shape`
- `rowCount`
- `columnCount`
- `length`
- `schema`, where appropriate.

The Dataset should make it easy to access structured data as an array of JavaScript objects.

Avoid exposing internal implementation details unnecessarily.

## 6.2 Table output

Provide a useful `table()` method.

Requirements:

- Display data in a readable tabular format.
- Support limiting displayed rows.
- Default maximum displayed rows: 1000.
- Show a message similar to:

`Showing 1000 of 50000 rows`

- Allow users to specify another maximum.
- Handle empty datasets.
- Handle wide datasets sensibly.
- Avoid loading or formatting unnecessary rows.

The row identifier in table representations should use `idx`, not `index`, to preserve `index` for future dataset indexing functionality.

## 6.3 Dataset inspection

Provide methods for inspecting:

- Columns.
- Data types.
- Row and column counts.
- Missing values.
- Unique values.
- Distinct values.
- Basic dataset structure.

Keep dataset profiling separate from analytical results.

Do not make every analysis operation return the complete dataset profile.

---

# 7. DATA PREPARATION AND TRANSFORMATION

After establishing the import and Dataset foundations, implement data preparation functionality.

Potential operations include:

- Selecting columns.
- Removing columns.
- Selecting rows.
- Filtering.
- Sorting.
- Renaming columns.
- Removing duplicates.
- Filling missing values.
- Dropping missing values.
- Replacing values.
- Mapping values.
- Creating derived columns.
- Type conversion.
- Limiting rows.
- Sampling.

Operations should be composable where practical.

Example:

```ts
const result = data
  .filter(row => row.revenue > 100)
  .sort("revenue", "desc")
  .select(["name", "revenue"]);
```

The exact API should be designed and tested before implementation.

Do not introduce inconsistent method signatures simply to make the API appear larger.

---

# 8. DATA QUERYING AND GROUPING

Develop a flexible querying and grouping system.

Potential capabilities:

- Filtering by conditions.
- Multiple conditions.
- AND/OR logic.
- Comparison operators.
- Null checks.
- String matching.
- Sorting.
- Selecting.
- Grouping.
- Aggregating.
- Distinct values.
- Row selection.
- Column selection.

Support clear, composable operations.

Consider future support for:

- Joins.
- Pivoting.
- Window functions.
- Query pipelines.

These advanced features should be introduced in stages and must not compromise the Dataset foundation.

---

# 9. STATISTICS AND ANALYTICS ENGINE

Numiq should provide a useful collection of analytical functions.

Build this as a separate module.

Potential descriptive statistics:

- Count.
- Sum.
- Mean.
- Median.
- Mode.
- Minimum.
- Maximum.
- Range.
- Variance.
- Standard deviation.
- Quartiles.
- Percentiles.
- Interquartile range.
- Skewness.
- Kurtosis.
- Missing-value counts.
- Unique-value counts.

Support appropriate numeric and nonnumeric columns.

Do not attempt numerical calculations on unsupported data types.

Return `null` or another explicitly documented representation when a calculation cannot be performed.

## 9.1 Describe

Provide a useful `describe()` method.

It should:

- Work across all relevant columns.
- Handle numeric and nonnumeric columns appropriately.
- Avoid crashing on mixed or unsupported data.
- Return null for noncalculatable statistics where appropriate.
- Support describing an individual column.
- Provide readable table output.

## 9.2 Aggregation

Support operations such as:

- Sum.
- Mean.
- Count.
- Minimum.
- Maximum.
- Median.
- Standard deviation.

Allow grouping and aggregation to work together.

## 9.3 Analysis results

Keep analytical results focused.

Do not return every property of the underlying Dataset inside every analysis result.

Analysis results should contain only information relevant to the analysis.

Use consistent result structures and documented types.

---

# 10. METRICS AND INSIGHTS

Introduce reusable metric definitions.

Conceptual example:

```ts
const revenue = data.createMetric({
  name: "Total Revenue",
  column: "revenue",
  aggregation: "sum"
});

console.log(revenue.name);
console.log(revenue.metric);
```

Metrics should have clear definitions and predictable calculation behavior.

Potential future metric features:

- Custom aggregations.
- Grouped metrics.
- Comparison metrics.
- Targets.
- Period comparisons.
- Reusable metric definitions.

Also develop an insight engine that can identify useful patterns and statistical observations.

Do not make claims that are not supported by the underlying data.

Provide structured outputs with clear descriptions and relevant values.

---

# 11. FUTURE ARCHITECTURAL EXTENSIONS

Keep the architecture open to future capabilities, but do not implement every future feature in v0.1.0.

Potential future capabilities include:

- Advanced statistical analysis.
- Correlation analysis.
- Regression.
- Data joins.
- Window functions.
- Pivoting and reshaping.
- Schema validation.
- Data lineage.
- Analytical pipelines.
- Custom aggregation functions.
- Advanced insight generation.
- Machine learning integrations.
- Multi-dataset analysis.
- Data spaces and database-like structures.

These features must be evaluated and implemented in suitable releases.

Do not add placeholder methods that pretend to provide functionality that does not exist.

---

# 12. NUMVIZ INTEGRATION BOUNDARY

Numiq and Numviz are separate products.

Numviz is a future visualization engine.

Numiq must not depend on Numviz.

Do not implement charts, dashboards, chart renderers, visualization styling, or dashboard builders as part of Numiq's core.

However, Numiq should expose clean, predictable Dataset and analytical result structures that a visualization package can consume.

The two products should be independently installable.

---

# 13. PUBLIC API DESIGN

Before implementing a major module, define its intended public API.

Requirements:

- Consistent naming.
- Clear method signatures.
- Predictable return values.
- Strong TypeScript types.
- Useful autocomplete.
- Clear errors.
- Good JavaScript ergonomics.
- Minimal unnecessary configuration.

Avoid exporting internal helpers as public API.

Use explicit public entry points.

Ensure default and named exports remain synchronized.

Document breaking changes.

Do not expose experimental internal functionality as stable public API without clear justification.

---

# 14. TESTING REQUIREMENTS

Testing is mandatory.

Every major feature must have automated tests.

Test categories:

1. Unit tests.
2. Integration tests.
3. Import tests.
4. Normalization tests.
5. Dataset tests.
6. Transformation tests.
7. Statistical correctness tests.
8. Error-handling tests.
9. TypeScript declaration tests.
10. Package-consumer tests.

Test:

- Valid inputs.
- Invalid inputs.
- Empty datasets.
- Large datasets.
- Mixed data types.
- Missing values.
- Unexpected values.
- Boundary conditions.
- Browser and Node compatibility where supported.

Verify statistical results against known expected values.

Do not claim that a test passed unless it was actually executed successfully.

Do not hide failing tests by weakening assertions or excluding problematic modules.

Maintain a clear test summary.

---

# 15. PERFORMANCE AND RELIABILITY

Numiq should be designed for real-world datasets.

Prioritize:

- Efficient iteration.
- Avoiding unnecessary copying.
- Avoiding repeated normalization.
- Efficient filtering and aggregation.
- Memory-conscious transformations.
- Reasonable handling of large inputs.
- Predictable execution behavior.

Do not optimize prematurely at the cost of correctness.

Benchmark important operations when performance becomes a concern.

Document any known limitations.

---

# 16. DOCUMENTATION

Documentation is part of the product, not an afterthought.

The project must include:

## README

Include:

- Project introduction.
- Installation.
- Quick start.
- Supported formats.
- Basic examples.
- API overview.
- TypeScript usage.
- JavaScript usage.
- Compatibility.
- Development instructions.
- Testing instructions.
- License.

## API documentation

Document every public method.

For each method, include:

- Description.
- Parameters.
- Return type.
- Example.
- Errors.
- Important behavior.

## Examples

Provide practical examples demonstrating:

- Creating a Dataset.
- Importing CSV.
- Importing JSON.
- Importing TSV.
- Loading data from a URL.
- Inspecting a Dataset.
- Displaying a table.
- Preparing data.
- Filtering and sorting.
- Descriptive statistics.
- Aggregation.
- Metrics.

Examples must actually work with the published package.

Never include examples of methods that have not been implemented.

---

# 17. PROJECT STRUCTURE

Design a modular structure.

A suggested starting point:

```text
numiq/
├── src/
│   ├── core/
│   │   ├── dataset.ts
│   │   ├── types.ts
│   │   └── factory.ts
│   │
│   ├── io/
│   │   ├── loaders/
│   │   ├── parsers/
│   │   ├── normalization/
│   │   └── types.ts
│   │
│   ├── preparation/
│   ├── transformations/
│   ├── querying/
│   ├── statistics/
│   ├── analytics/
│   ├── metrics/
│   ├── insights/
│   │
│   ├── errors/
│   ├── utils/
│   └── index.ts
│
├── tests/
├── examples/
├── docs/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── .gitignore
└── ...
```

This is a proposed structure, not a requirement to create empty folders for every future feature.

Create modules when functionality is implemented.

Avoid unnecessary abstractions.

---

# 18. VERSIONING AND DEVELOPMENT ROADMAP

Develop Numiq through controlled releases.

## v0.1.0 — Import and Dataset Foundation

Priority:

- Project initialization.
- TypeScript configuration.
- Build system.
- Testing infrastructure.
- Error system.
- CSV import.
- JSON import.
- TSV import.
- URL loading.
- Data normalization.
- Dataset factory.
- Dataset abstraction.
- Dataset inspection.
- Basic table output.
- Default and named exports.
- Documentation.
- Initial release preparation.

Excel importing is excluded.

Do not overload v0.1.0 with advanced analytics.

## Subsequent releases

Plan future versions around coherent capabilities.

Potential milestones:

- Data preparation.
- Transformation engine.
- Querying and filtering.
- Grouping and aggregation.
- Descriptive statistics.
- Advanced analytics.
- Metrics and insights.
- Joins and advanced data operations.
- Performance and scalability improvements.
- Production API stabilization.

Before starting each milestone, define:

- Scope.
- Public APIs.
- Dependencies.
- Tests.
- Acceptance criteria.
- Version number.

Do not arbitrarily inflate version numbers.

Use semantic versioning consistently.

---

# 19. PRODUCTION-READY REQUIREMENTS

Before publishing a stable release, verify:

### Package quality

- Correct package name.
- Correct version.
- Valid package exports.
- Valid ESM/CJS configuration where supported.
- Correct TypeScript declarations.
- Correct package entry points.
- No accidental inclusion of development files.
- No unnecessary dependencies.
- No secrets or local environment files.
- Correct license.
- Correct repository metadata.

### Build quality

- Clean build.
- No TypeScript errors.
- No broken imports.
- No circular dependencies.
- Correct generated declaration files.

### Test quality

- All required tests pass.
- Important edge cases are covered.
- Statistical calculations are verified.
- Package can be consumed externally.

### Documentation quality

- Installation instructions work.
- Examples work.
- Public APIs are documented.
- Known limitations are disclosed.

### Release quality

- Correct Git tag.
- Correct GitHub release.
- Accurate changelog.
- npm package contents inspected.
- Package installed and tested in a clean consumer project.

Never claim production readiness based only on a successful compilation.

---

# 20. GIT AND RELEASE WORKFLOW

Use a disciplined Git workflow.

The developer will review each version before merging it into the main branch.

For each development milestone:

1. Work on an appropriately named branch.
2. Implement only the approved milestone scope.
3. Run tests.
4. Run the production build.
5. Review changes.
6. Update documentation.
7. Summarize completed functionality.
8. Report remaining limitations.
9. Prepare the release.
10. Wait for developer approval before merging or publishing.

Do not merge, publish to npm, delete branches, or create public releases without explicit authorization.

The developer handles final testing and release approval.

---

# 21. DELIVERY REQUIREMENTS

For every requested version:

- Provide the complete source project.
- Include all required configuration.
- Include tests.
- Include documentation.
- Include examples.
- Include the license.
- Exclude `node_modules`.
- Exclude unnecessary generated files.
- Ensure the project installs and builds independently.

When providing ZIP archives:

Use a versioned folder name such as:

`numiq-v0.1.0/`

Do not create duplicate nested project folders.

Do not include `node_modules`.

Do not claim tests or builds passed unless verified.

---

# 22. DEVELOPMENT EXECUTION RULES

These rules are mandatory.

1. Do not implement everything in one step.
2. Start by auditing the old Numeriq import implementation.
3. Produce a clear reuse assessment.
4. Define the new Numiq architecture.
5. Establish the v0.1.0 API and acceptance criteria.
6. Initialize the new repository.
7. Implement in small, testable stages.
8. Verify each stage before proceeding.
9. Keep the developer informed about significant architectural decisions.
10. Ask for approval when a major design decision could materially affect the public API.
11. Do not invent completed functionality.
12. Do not silently change agreed requirements.
13. Do not introduce Excel support.
14. Do not create a dependency on the old Numeriq project.
15. Do not introduce a dependency on Numviz.
16. Do not publish without approval.

When encountering uncertainty, investigate first rather than guessing.

If an existing implementation is defective, explain the problem and implement a reliable replacement.

---

# 23. FIRST TASK — BEGIN DEVELOPMENT

Do not immediately generate the entire project.

Begin with a technical audit and architecture proposal.

Your first response must contain:

### A. Existing Numeriq audit

Inspect the existing repository and report:

- Importer architecture.
- CSV implementation.
- JSON implementation.
- TSV implementation.
- URL loading.
- Normalization.
- Supporting utilities.
- Existing tests.
- Dependencies.
- Reusable code.
- Code that should be rewritten.

Excel must be excluded from the new project.

### B. Numiq architecture

Propose the new TypeScript project structure.

Explain the responsibilities of each initial module.

### C. Public API proposal

Define the proposed v0.1.0 API, including:

- `createDataset()`
- `loadCSV()`
- `loadJSON()`
- `loadTSV()`
- `loadURL()`
- Dataset properties.
- Dataset inspection.
- `table()`.

Include both named and default imports.

### D. v0.1.0 implementation plan

Break implementation into small milestones.

Define the tests and acceptance criteria for each milestone.

### E. Repository initialization

Once the architecture and API have been reviewed and approved, initialize the new Numiq repository and begin implementation.

The objective is not simply to make Numiq work.

The objective is to build a reliable, maintainable, well-documented data analysis library that can grow into a serious developer tool.

**Build carefully. Test thoroughly. Keep the API clean. Never sacrifice architectural quality for speed.**
