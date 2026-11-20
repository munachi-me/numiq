/**
 * Fails the build on an import cycle among source modules.
 *
 * Cycles are legal in ES modules but produce half-initialised bindings at runtime, which
 * surfaces as confusing `undefined` errors far from the cause. Parsing `import` statements
 * is enough here: Numiq has no dynamic imports or `require` calls in `src/`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `here` needs Node >= 20.11, but the package supports Node 18.
const here = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(here, "..", "src");

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

const files = await collectFiles(root);
const graph = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const dependencies = new Set();
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*"([^"]+)"/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    dependencies.add(path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
  }
  graph.set(file, [...dependencies]);
}

const cycles = [];
const state = new Map();
const stack = [];

function visit(node) {
  if (state.get(node) === "done") return;
  if (state.get(node) === "visiting") {
    const start = stack.indexOf(node);
    cycles.push([...stack.slice(start), node].map((file) => path.relative(root, file)));
    return;
  }
  state.set(node, "visiting");
  stack.push(node);
  for (const dependency of graph.get(node) ?? []) visit(dependency);
  stack.pop();
  state.set(node, "done");
}

for (const file of graph.keys()) visit(file);

if (cycles.length > 0) {
  console.error(`Found ${cycles.length} import cycle(s):`);
  for (const cycle of cycles) console.error(`  ${cycle.join(" -> ")}`);
  process.exit(1);
}
console.log(`no import cycles among ${graph.size} modules`);
