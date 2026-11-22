/**
 * Verifies the published artifact, not the source tree.
 *
 * Packs the package, installs it into a throwaway consumer project, and exercises each
 * export condition (ESM import, CJS require, browser subpath). This catches packaging
 * faults that unit tests cannot: wrong `exports` targets, a missing declaration file, or
 * a Node built-in leaking into the browser entry.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `here` needs Node >= 20.11, but the package supports Node 18.
const here = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(here, "..");
const { name: packageName } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * `npm publish --dry-run` exports `npm_config_dry_run`, which the nested `npm pack` and
 * `npm install` below would inherit and honour — producing an empty tarball and a
 * "corrupted tarball" error. The rehearsal has to actually pack and install, so strip it.
 */
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run"),
);

/** The bundled sample's columns, in order. */
const SAMPLE_COLUMNS = ["order_id", "date", "product", "category", "region", "quantity", "revenue"];

const workDir = await mkdtemp(path.join(tmpdir(), "numiq-pkg-"));

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
  // `npm pack --json` returns an array in some versions and a name-keyed object in others.
  const parsed = JSON.parse(packOutput);
  const { filename, files } = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const tarball = path.join(workDir, filename);
  const packed = new Set(files.map((file) => file.path));

  console.log("\ntarball contents");
  check("includes the ESM entry", packed.has("dist/esm/index.js"));
  check("includes the Node entry", packed.has("dist/esm/node.js"));
  check("includes the CJS build", packed.has("dist/cjs/node.js"));
  check("includes declarations", packed.has("dist/esm/node.d.ts"));
  check("includes the README", packed.has("README.md"));
  check("includes the licence", packed.has("LICENSE"));
  check("excludes the test suite", ![...packed].some((file) => file.startsWith("tests/")));
  check("excludes sources", ![...packed].some((file) => file.startsWith("src/")));

  const consumer = path.join(workDir, "consumer");
  const installed = path.join(consumer, "node_modules", ...packageName.split("/"));
  await mkdir(consumer, { recursive: true });
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }, null, 2),
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    stdio: "pipe",
    env: childEnv,
  });

  console.log("\nesm import");
  const esm = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import Numiq, { createDataset, loadCSV, parseDelimited, useSampleDataset } from "@munachi-me/numiq";
       const data = parseDelimited("a,b\\n1,2\\n", { format: "csv" });
       const sample = await Numiq.useSampleDataset();
       const chained = sample.filter((r) => Number(r.revenue) > 100).sort("revenue", "desc").select(["order_id", "revenue"]).limit(5);
       const prepared = createDataset([
         { id: 1, qty: null, note: "a" },
         { id: 1, qty: 4, note: null },
         { id: 2, qty: 2, note: null },
       ])
         .drop(["note"])
         .fillMissing({ qty: "median" })
         .dropDuplicates(["id"])
         .addColumn("double", (r) => Number(r.qty) * 2);
       const sampled = prepared.sample(1, { seed: 9 }).data[0];
       const queried = sample
         .query()
         .where("revenue", ">", 0)
         .and("region", "isNotNull")
         .or("region", "isNull")
         .orderBy("revenue", "desc")
         .select(["order_id", "revenue"])
         .limit(3)
         .execute();
       const missing = createDataset([{ r: "N", v: 1 }, { r: null, v: 2 }]);
       const grouped = sample.groupBy("region").aggregate({
         total: { column: "revenue", op: "sum" },
         avg: { column: "revenue", op: "mean" },
         n: { op: "count" },
       });
       const customGrouped = sample.groupBy("region").aggregate({
         labels: (rows) => rows.length,
       });
       const described = sample.describe();
       const totalRevenue = sample.createMetric({ name: "Total Revenue", column: "revenue", aggregation: "sum" });
       const revenue = sample.describe("revenue");
       const revenueCol = sample.column("revenue").values.filter((v) => v !== null && v !== undefined);
       const notN = missing.query().where("r", "!=", "N").execute();
       const notNOrNull = missing.query().where("r", "!=", "N").or("r", "isNull").execute();
       console.log(JSON.stringify({
         rowCount: data.rowCount,
         identity: Numiq.createDataset === createDataset,
         sampleIdentity: Numiq.useSampleDataset === useSampleDataset,
         sampleShape: sample.shape,
         chainedRows: chained.rowCount,
         chainedColumns: chained.columns,
         preparedColumns: prepared.columns,
         preparedRows: prepared.data,
         sampledValue: sampled.double,
         queryColumns: queried.columns,
         queryRows: queried.rowCount,
         queryFirst: queried.data[0]?.order_id,
         queryDescending: queried.data.map((r) => Number(r.revenue)),
         queryGrouping: sample.query().where("region", "=", "North").or("revenue", ">", 100).and("revenue", "<", 200).toString(),
         notN: notN.rowCount,
         notNOrNull: notNOrNull.rowCount,
         QueryIdentity: Numiq.Query !== undefined,
         groupedColumns: grouped.columns,
         groupedRows: grouped.rowCount,
         groupedCounts: grouped.data.map((r) => Number(r.n)),
         groupedCountTotal: grouped.data.reduce((t, r) => t + Number(r.n), 0),
         groupedFirst: grouped.data[0],
         customGroupedRows: customGrouped.rowCount,
         groupSizes: sample.groupBy("region").sizes,
         groupCount: sample.groupBy("region").groupCount,
         GroupedDatasetIdentity: Numiq.GroupedDataset !== undefined,
         standaloneSum: Numiq.sum([1, 2, 3]),
         standaloneMedian: Numiq.median([3, 1, 2]),
         standaloneStd: Numiq.std([1, 2, 3, 4, 5], { ddof: 0 }),
         describeColumns: described.columns,
         describeProfiles: described.profiles.length,
         describeShape: [described.rowCount, described.columnCount],
         revenueProfile: {
           count: revenue.count,
           missing: revenue.missing,
           unique: revenue.unique,
           sum: revenue.sum,
           mean: revenue.mean,
           median: revenue.median,
           min: revenue.min,
           max: revenue.max,
           q1: revenue.q1,
           q3: revenue.q3,
           iqr: revenue.iqr,
           range: revenue.range,
           kind: revenue.kind,
         },
         revenueManual: {
           count: revenueCol.length,
           sum: revenueCol.reduce((t, v) => t + v, 0),
           min: Math.min(...revenueCol),
           max: Math.max(...revenueCol),
         },
         categoryProfile: {
           kind: sample.describe("category").kind,
           sum: sample.describe("category").sum,
           mean: sample.describe("category").mean,
         },
         describedTableHasColumns: described.table().includes("column"),
         describedRows: described.toDataset().rowCount,
         percentileColumns: sample.describe({ percentiles: [90] }).toDataset().columns.includes("p90"),
         percentileValue: sample.describe({ percentiles: [90] }).toDataset().data.find((row) => row.name === "revenue")?.p90,
         standaloneQuantile: Numiq.quantile([1, 2, 3, 4], 0.5),
         standalonePercentile: Numiq.percentile([2, 4, 4, 4, 5, 5, 7, 9], 90),
         standaloneIqr: Numiq.iqr([2, 4, 4, 4, 5, 5, 7, 9]),
         standaloneMode: Numiq.mode([1, 2, 2, 3]),
         DescribeIdentity: Numiq.DatasetDescription !== undefined,
         advanced: {
           pearson: sample.correlation("quantity", "revenue"),
           spearman: sample.rankCorrelation("quantity", "revenue"),
           matrixColumns: sample.correlationMatrix().columns,
           matrixDiagonal: sample.correlationMatrix().matrix.map((row, i) => row[i]),
           matrixSymmetric: (() => {
             const m = sample.correlationMatrix();
             return m.matrix.every((row, i) => row.every((v, j) => v === m.matrix[j][i]));
           })(),
           skewness: sample.skewness("revenue"),
           kurtosis: sample.kurtosis("revenue"),
           five: sample.fiveNumberSummary("revenue"),
           outlierCount: sample.outliers("revenue").outliers.length,
           outlierFence: sample.outliers("revenue").fences,
           zReason: sample.zScores("revenue").reason,
           zFirst: sample.zScores("revenue").values[0],
           zColumn: sample.withZScores("revenue").columns.includes("revenue_z"),
           pctRank: sample.percentileRank("revenue", 2000),
           constantZ: (() => {
             const flat = sample.addColumn("flat", () => 1);
             return flat.withZScores("flat").data[0]?.flat_z;
           })(),
           standaloneCov: Numiq.covariance([1, 2, 3], [2, 4, 6]),
           standalonePearson: Numiq.pearsonCorrelation([1, 2, 3], [2, 4, 6]).r,
           standaloneNormalize: Numiq.normalize([1, 2, 3]),
           standaloneStandardize: Numiq.standardize([1, 2, 3]),
           standaloneSkew: Numiq.skewness([1, 2, 3, 4, 100]),
           AdvancedIdentity: Numiq.correlationMatrix !== undefined && Numiq.detectOutliers !== undefined,
         },
         metrics: {
           name: totalRevenue.name,
           value: totalRevenue.value,
           definition: totalRevenue.definition,
           evidence: totalRevenue.metric,
           count: sample.createMetric({ name: "Orders", aggregation: "count" }).value,
           grouped: (() => {
             const metric = sample.createMetric({
               name: "Region Revenue",
               column: "revenue",
               aggregation: "sum",
               groupBy: ["region"],
             });
             return metric.byGroup().groups.map((group) => [group.key.region, group.value]);
           })(),
           custom: sample.createMetric({
             name: "Revenue range",
             column: "revenue",
             fn: (values) => Math.max(...values) - Math.min(...values),
           }).value,
           recalculated: sample
             .createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" })
             .recalculate(sample.limit(5).data, sample.columns).rowCount,
           comparison: sample
             .createMetric({ name: "Revenue", column: "revenue", aggregation: "sum" })
             .compare({ to: 1000 }),
           format: sample.createMetric({
             name: "Revenue",
             column: "revenue",
             aggregation: "sum",
             format: { prefix: "$", decimals: 2 },
           }).format,
           emptyReason: sample.limit(0).createMetric({ name: "R", column: "revenue", aggregation: "sum" }).metric.reason,
           standalone: Numiq.createMetric({ name: "Rows", aggregation: "count" }, sample.data, sample.columns).value,
           MetricIdentity: Numiq.Metric !== undefined && Numiq.createMetric !== undefined,
         },
         insights: {
           report: (() => {
             const report = sample.insights();
             return {
               count: report.insights.length,
               kinds: [...new Set(report.insights.map((insight) => insight.kind))].sort(),
               truncated: report.truncated,
               skipped: report.skipped.length,
               thresholds: report.thresholds,
               allHaveEvidence: report.insights.every((insight) => Object.keys(insight.evidence).length > 0),
               allNameColumns: report.insights.every((insight) => insight.columns.length > 0),
             };
           })(),
           deterministic: JSON.stringify(sample.insights()) === JSON.stringify(sample.insights()),
           lowered: sample
             .insights({ strongCorrelation: 0.4 })
             .insights.filter((insight) => insight.kind === "correlation").length,
           outlierAgreement:
             sample.insights().insights.find((insight) => insight.kind === "outliers")?.evidence.count ===
             sample.outliers("revenue").outliers.length,
           emptySkipped: sample.limit(0).insights().skipped.length,
           standalone: Numiq.analyze({ rows: sample.data, columns: sample.columns, schema: sample.schema }).thresholds
             .maxInsights,
           InsightsIdentity: Numiq.analyze !== undefined && Numiq.resolveInsightOptions !== undefined,
         },
         loadCSV: typeof loadCSV,
         table: data.table().includes("1 rows × 2 columns"),
       }));`,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  const esmResult = JSON.parse(esm);
  check("parses data", esmResult.rowCount === 1);
  check("default and named exports agree", esmResult.identity === true);
  check("exports loaders", esmResult.loadCSV === "function");
  check("renders a table", esmResult.table === true);
  check("ships the sample dataset", JSON.stringify(esmResult.sampleShape) === "[50,7]", String(esmResult.sampleShape));
  check("exposes the sample helper on the default namespace", esmResult.sampleIdentity === true);
  check("chains transformations from the packed package", esmResult.chainedRows === 5, String(esmResult.chainedRows));
  check("select reorders columns", JSON.stringify(esmResult.chainedColumns) === '["order_id","revenue"]');
  check(
    "prepares data through the preparation engine",
    JSON.stringify(esmResult.preparedColumns) === '["id","qty","double"]',
    JSON.stringify(esmResult.preparedColumns),
  );
  check(
    "fills, de-duplicates and derives as documented",
    JSON.stringify(esmResult.preparedRows) ===
      JSON.stringify([
        { id: 1, qty: 3, double: 6 },
        { id: 2, qty: 2, double: 4 },
      ]),
    JSON.stringify(esmResult.preparedRows),
  );
  check(
    "samples reproducibly from the packed package",
    esmResult.sampledValue === 4 || esmResult.sampledValue === 6,
    String(esmResult.sampledValue),
  );
  check("queries from the packed package", esmResult.queryRows === 3, String(esmResult.queryRows));
  check(
    "query selects and reorders columns",
    JSON.stringify(esmResult.queryColumns) === '["order_id","revenue"]',
    JSON.stringify(esmResult.queryColumns),
  );
  check(
    "query orders descending",
    JSON.stringify(esmResult.queryDescending) === JSON.stringify([...esmResult.queryDescending].sort((a, b) => b - a)),
    JSON.stringify(esmResult.queryDescending),
  );
  check(
    "query reports its grouping",
    esmResult.queryGrouping === "(region = North OR (revenue > 100 AND revenue < 200))",
    esmResult.queryGrouping,
  );
  check(
    "groups from the packed package",
    JSON.stringify(esmResult.groupedColumns) === '["region","total","avg","n"]',
    JSON.stringify(esmResult.groupedColumns),
  );
  check("aggregate produces one row per group", esmResult.groupedRows === 4, String(esmResult.groupedRows));
  check("group counts sum to the row count", esmResult.groupedCountTotal === 50, String(esmResult.groupedCountTotal));
  check("aggregates a first group correctly", esmResult.groupedFirst?.n === 13, JSON.stringify(esmResult.groupedFirst));
  check("supports custom aggregators", esmResult.customGroupedRows === 4, String(esmResult.customGroupedRows));
  check("exposes group sizes", Array.isArray(esmResult.groupSizes), JSON.stringify(esmResult.groupSizes));
  check("exposes the GroupedDataset export", esmResult.GroupedDatasetIdentity === true);
  check(
    "exports standalone aggregation helpers",
    esmResult.standaloneSum === 6 && esmResult.standaloneMedian === 2,
    String(esmResult.standaloneSum),
  );
  check(
    "standalone std honours ddof",
    Math.abs(Number(esmResult.standaloneStd) - Math.sqrt(2)) < 1e-12,
    String(esmResult.standaloneStd),
  );
  check(
    "describe profiles every column",
    esmResult.describeProfiles === esmResult.describeShape[1] &&
      JSON.stringify(esmResult.describeColumns) === JSON.stringify(SAMPLE_COLUMNS),
    `${esmResult.describeProfiles} profiles for ${esmResult.describeShape[1]} columns: ${esmResult.describeColumns}`,
  );
  check(
    "describe reports the dataset shape",
    JSON.stringify(esmResult.describeShape) === "[50,7]",
    JSON.stringify(esmResult.describeShape),
  );
  check(
    "single-column describe counts match the column",
    esmResult.revenueProfile.count === esmResult.revenueManual.count &&
      esmResult.revenueProfile.unique > 0 &&
      esmResult.revenueProfile.missing === 50 - esmResult.revenueManual.count,
    JSON.stringify(esmResult.revenueProfile),
  );
  check(
    "single-column describe sum matches a manual pass",
    Math.abs(Number(esmResult.revenueProfile.sum) - Number(esmResult.revenueManual.sum)) < 1e-9,
    `${esmResult.revenueProfile.sum} vs ${esmResult.revenueManual.sum}`,
  );
  check(
    "single-column describe bounds match a manual pass",
    esmResult.revenueProfile.min === esmResult.revenueManual.min &&
      esmResult.revenueProfile.max === esmResult.revenueManual.max,
    JSON.stringify([esmResult.revenueProfile.min, esmResult.revenueProfile.max]),
  );
  check(
    "describe reports a numeric kind for a numeric column",
    esmResult.revenueProfile.kind === "numeric",
    String(esmResult.revenueProfile.kind),
  );
  check(
    "quartiles bracket the median",
    esmResult.revenueProfile.q1 <= esmResult.revenueProfile.median &&
      esmResult.revenueProfile.median <= esmResult.revenueProfile.q3,
    JSON.stringify([esmResult.revenueProfile.q1, esmResult.revenueProfile.median, esmResult.revenueProfile.q3]),
  );
  check(
    "iqr equals q3 minus q1",
    Math.abs(Number(esmResult.revenueProfile.iqr) - (esmResult.revenueProfile.q3 - esmResult.revenueProfile.q1)) < 1e-9,
    String(esmResult.revenueProfile.iqr),
  );
  check(
    "range equals max minus min",
    Math.abs(Number(esmResult.revenueProfile.range) - (esmResult.revenueProfile.max - esmResult.revenueProfile.min)) <
      1e-9,
    String(esmResult.revenueProfile.range),
  );
  check(
    "non-numeric columns report null arithmetic, not zero",
    esmResult.categoryProfile.kind === "categorical" &&
      esmResult.categoryProfile.sum === null &&
      esmResult.categoryProfile.mean === null,
    JSON.stringify(esmResult.categoryProfile),
  );
  check("describe renders a table", esmResult.describedTableHasColumns === true);
  check(
    "describe converts to a Dataset with one row per column",
    esmResult.describedRows === esmResult.describeShape[1],
    `${esmResult.describedRows} rows`,
  );
  check("exposes the DatasetDescription export", esmResult.DescribeIdentity === true);
  check(
    "toDataset names requested percentiles as columns",
    esmResult.percentileColumns === true,
    String(esmResult.percentileColumns),
  );
  check(
    "toDataset flattens percentiles into cell values",
    typeof esmResult.percentileValue === "number" && esmResult.percentileValue > 1600,
    String(esmResult.percentileValue),
  );
  check("exports standalone quantile", esmResult.standaloneQuantile === 2.5, String(esmResult.standaloneQuantile));
  check(
    "exports standalone percentile without float drift",
    esmResult.standalonePercentile === 7.6,
    String(esmResult.standalonePercentile),
  );
  check("exports standalone iqr", esmResult.standaloneIqr === 1.5, String(esmResult.standaloneIqr));
  check("exports standalone mode", esmResult.standaloneMode === 2, String(esmResult.standaloneMode));
  check("query excludes missing cells from !=", esmResult.notN === 0, String(esmResult.notN));
  check("query can include missing cells via isNull", esmResult.notNOrNull === 1, String(esmResult.notNOrNull));
  check("exposes Query on the default namespace", esmResult.QueryIdentity === true);

  console.log("\nadvanced statistics");
  const adv = esmResult.advanced;
  check(
    "correlates through the packed package",
    Math.abs(adv.pearson.r - 0.43724861958188593) < 1e-12,
    String(adv.pearson.r),
  );
  check("reports the pair count", adv.pearson.n === 50, String(adv.pearson.n));
  check("carries a null reason when computed", adv.pearson.reason === null);
  check(
    "rank correlation differs from Pearson",
    Math.abs(adv.spearman.r - 0.5244511749947358) < 1e-12,
    String(adv.spearman.r),
  );
  check(
    "builds a matrix over numeric columns",
    JSON.stringify(adv.matrixColumns) === '["quantity","revenue"]',
    JSON.stringify(adv.matrixColumns),
  );
  check("matrix diagonal is 1", JSON.stringify(adv.matrixDiagonal) === "[1,1]", JSON.stringify(adv.matrixDiagonal));
  check("matrix is symmetric", adv.matrixSymmetric === true);
  check("reports skewness", Math.abs(adv.skewness - 1.7133020612357541) < 1e-12, String(adv.skewness));
  check("reports excess kurtosis", Math.abs(adv.kurtosis - 2.3952120604810103) < 1e-12, String(adv.kurtosis));
  check("summarises five numbers", adv.five.count === 50 && adv.five.min === 29.5 && adv.five.max === 2720.94);
  check("finds IQR outliers", adv.outlierCount === 4, String(adv.outlierCount));
  check(
    "reports the outlier fence",
    Math.abs(adv.outlierFence.upper - 1903.9875) < 1e-9,
    String(adv.outlierFence.upper),
  );
  check(
    "computes z-scores",
    adv.zReason === null && Math.abs(adv.zFirst + 0.8651368264727416) < 1e-12,
    String(adv.zFirst),
  );
  check("adds a z-score column", adv.zColumn === true);
  check("computes percentile rank", adv.pctRank === 94, String(adv.pctRank));
  check("nulls z-scores for a constant column", adv.constantZ === null, String(adv.constantZ));
  check("exports standalone covariance", Math.abs(adv.standaloneCov - 2) < 1e-12, String(adv.standaloneCov));
  check("exports standalone Pearson", Math.abs(adv.standalonePearson - 1) < 1e-12, String(adv.standalonePearson));
  check(
    "exports normalize",
    JSON.stringify(adv.standaloneNormalize) === "[0,0.5,1]",
    JSON.stringify(adv.standaloneNormalize),
  );
  check(
    "exports standardize",
    JSON.stringify(adv.standaloneStandardize) === "[-1,0,1]",
    JSON.stringify(adv.standaloneStandardize),
  );
  check("exports skewness", adv.standaloneSkew > 1, String(adv.standaloneSkew));
  check("exposes advanced helpers on the default namespace", adv.AdvancedIdentity === true);

  console.log("\nmetrics");
  const met = esmResult.metrics;
  check("names a metric", met.name === "Total Revenue");
  check("computes the metric sum", Math.abs(met.value - 31122.69) < 1e-6, String(met.value));
  check("states the definition", met.definition === 'sum("revenue")');
  check(
    "reports rows and values",
    met.evidence.rows === 50 && met.evidence.values === 50,
    JSON.stringify(met.evidence),
  );
  check("counts rows", met.count === 50, String(met.count));
  check("computes grouped metrics", met.grouped.length === 4, JSON.stringify(met.grouped));
  check("runs a custom callback", met.custom > 0, String(met.custom));
  check("recalculates against new data", met.recalculated === 5, String(met.recalculated));
  check("compares against a baseline", met.comparison.difference > 0 && met.comparison.reason === null);
  check("carries format hints", met.format.prefix === "$" && met.format.decimals === 2);
  check("explains an empty metric", met.emptyReason === "empty", String(met.emptyReason));
  check("exports a standalone createMetric", met.standalone === 50);
  check("exposes metrics on the default namespace", met.MetricIdentity === true);

  console.log("\ninsights");
  const ins = esmResult.insights;
  check("produces insights", ins.report.count > 0, String(ins.report.count));
  check("reports the insight kinds found", ins.report.kinds.length > 0, JSON.stringify(ins.report.kinds));
  check("attaches evidence to every insight", ins.report.allHaveEvidence === true);
  check("names columns on every insight", ins.report.allNameColumns === true);
  check("reports nothing truncated", ins.report.truncated === 0, String(ins.report.truncated));
  check("is deterministic", ins.deterministic === true);
  check("respects a lowered correlation threshold", ins.lowered === 1, String(ins.lowered));
  check("agrees with the outlier statistics", ins.outlierAgreement === true);
  check("explains every check on an empty dataset", ins.emptySkipped === 7, String(ins.emptySkipped));
  check("exports a standalone analyze", ins.standalone === 50, String(ins.standalone));
  check("exposes insights on the default namespace", ins.InsightsIdentity === true);

  console.log("\ncjs require");
  const cjs = execFileSync(
    process.execPath,
    [
      "-e",
      `const Numiq = require("@munachi-me/numiq");
       const data = Numiq.parseJSON('[{"a":1}]');
       console.log(JSON.stringify({ rowCount: data.rowCount, shape: data.shape }));`,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  check("loads through require", JSON.parse(cjs).rowCount === 1);

  console.log("\nbrowser condition");
  const browser = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { readFileSync } from "node:fs";
       const dir = process.argv[1];
       const pkg = JSON.parse(readFileSync(dir + "/package.json", "utf8"));
       const target = pkg.exports["."].browser.default.replace("./", dir + "/");
       const source = readFileSync(target, "utf8");
       const builtins = [...source.matchAll(/from\\s*"(node:[^"]+)"/g)].map((m) => m[1]);
       console.log(JSON.stringify({ target, builtins }));`,
      installed,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  const browserResult = JSON.parse(browser);
  check("browser entry is built", browserResult.target.endsWith("dist/esm/index.js"));
  check("browser entry has no node: built-ins", browserResult.builtins.length === 0, browserResult.builtins.join(", "));

  console.log("\nbrowser sample dataset");
  const browserSample = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { useSampleDataset } from "@munachi-me/numiq/core";
       const sample = await useSampleDataset();
       console.log(JSON.stringify({ shape: sample.shape, source: sample.importReport?.source }));`,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  const browserSampleResult = JSON.parse(browserSample);
  check(
    "loads the sample through the browser-safe entry",
    JSON.stringify(browserSampleResult.shape) === "[50,7]",
    String(browserSampleResult.shape),
  );
  check("sample report names its source", browserSampleResult.source === "sample-sales");

  console.log("\ndeclarations");
  const declaration = await readFile(path.join(installed, "dist", "esm", "node.d.ts"), "utf8");
  check(
    "declares the default export",
    /export\s*\{\s*default\s*\}/.test(declaration) || declaration.includes("export default"),
  );

  const datasetDeclaration = await readFile(
    path.join(installed, "dist", "esm", "core", "dataset.d.ts"),
    "utf8",
  );
  for (const member of [
    "columns",
    "shape",
    "data",
    "table",
    "rowCount",
    "columnCount",
    "filter",
    "sort",
    "select",
    "limit",
    "drop",
    "rename",
    "dropMissing",
    "fillMissing",
    "replace",
    "map",
    "addColumn",
    "cast",
    "dropDuplicates",
    "sample",
    "query",
    "groupBy",
    "describe",
  ]) {
    check(`Dataset declares ${member}`, datasetDeclaration.includes(member));
  }

  const descriptionDeclaration = await readFile(
    path.join(installed, "dist", "esm", "analytics", "describe.d.ts"),
    "utf8",
  );
  for (const member of ["profiles", "get", "table", "toDataset", "rowCount", "columnCount"]) {
    check(`DatasetDescription declares ${member}`, descriptionDeclaration.includes(member));
  }
  for (const field of ["count", "missing", "unique", "sum", "mean", "median", "mode", "iqr", "ddof"]) {
    check(`ColumnProfile declares ${field}`, descriptionDeclaration.includes(field));
  }

  const groupingDeclaration = await readFile(
    path.join(installed, "dist", "esm", "core", "group.d.ts"),
    "utf8",
  );
  for (const member of ["aggregate", "toDataset", "mapGroups", "groupCount", "sizes", "keys"]) {
    check(`GroupedDataset declares ${member}`, groupingDeclaration.includes(member));
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} package check(s) failed.`);
  process.exit(1);
}
console.log("\npackage checks passed.");
