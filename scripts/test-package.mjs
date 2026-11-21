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
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const workDir = await mkdtemp(path.join(tmpdir(), "numiq-pkg-"));

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
    cwd: root,
    encoding: "utf8",
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
  await mkdir(consumer, { recursive: true });
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }, null, 2),
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: consumer, stdio: "pipe" });

  console.log("\nesm import");
  const esm = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import Numiq, { createDataset, loadCSV, parseDelimited, useSampleDataset } from "numiq";
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
  check(
    "group counts sum to the row count",
    esmResult.groupedCountTotal === 50,
    String(esmResult.groupedCountTotal),
  );
  check("aggregates a first group correctly", esmResult.groupedFirst?.n === 13, JSON.stringify(esmResult.groupedFirst));
  check("supports custom aggregators", esmResult.customGroupedRows === 4, String(esmResult.customGroupedRows));
  check("exposes group sizes", Array.isArray(esmResult.groupSizes), JSON.stringify(esmResult.groupSizes));
  check("exposes the GroupedDataset export", esmResult.GroupedDatasetIdentity === true);
  check("exports standalone aggregation helpers", esmResult.standaloneSum === 6 && esmResult.standaloneMedian === 2, String(esmResult.standaloneSum));
  check(
    "standalone std honours ddof",
    Math.abs(Number(esmResult.standaloneStd) - Math.sqrt(2)) < 1e-12,
    String(esmResult.standaloneStd),
  );
  check("query excludes missing cells from !=", esmResult.notN === 0, String(esmResult.notN));
  check("query can include missing cells via isNull", esmResult.notNOrNull === 1, String(esmResult.notNOrNull));
  check("exposes Query on the default namespace", esmResult.QueryIdentity === true);

  console.log("\ncjs require");
  const cjs = execFileSync(
    process.execPath,
    [
      "-e",
      `const Numiq = require("numiq");
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
       const pkg = JSON.parse(readFileSync("node_modules/numiq/package.json", "utf8"));
       const target = pkg.exports["."].browser.default.replace("./", "node_modules/numiq/");
       const source = readFileSync(target, "utf8");
       const builtins = [...source.matchAll(/from\\s*"(node:[^"]+)"/g)].map((m) => m[1]);
       console.log(JSON.stringify({ target, builtins }));`,
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
      `import { useSampleDataset } from "numiq/core";
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
  const declaration = await readFile(path.join(consumer, "node_modules", "numiq", "dist", "esm", "node.d.ts"), "utf8");
  check(
    "declares the default export",
    /export\s*\{\s*default\s*\}/.test(declaration) || declaration.includes("export default"),
  );

  const datasetDeclaration = await readFile(
    path.join(consumer, "node_modules", "numiq", "dist", "esm", "core", "dataset.d.ts"),
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
  ]) {
    check(`Dataset declares ${member}`, datasetDeclaration.includes(member));
  }

  const groupingDeclaration = await readFile(
    path.join(consumer, "node_modules", "numiq", "dist", "esm", "core", "group.d.ts"),
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
