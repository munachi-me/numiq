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
  ]) {
    check(`Dataset declares ${member}`, datasetDeclaration.includes(member));
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} package check(s) failed.`);
  process.exit(1);
}
console.log("\npackage checks passed.");
