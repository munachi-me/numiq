/**
 * Fails when Numiq acquires a runtime dependency.
 *
 * "Zero dependencies" is a promise to consumers, so it is checked rather than trusted.
 * Three separate things can break it, and all three are covered here:
 *
 *   1. `package.json` declares a runtime dependency.
 *   2. A source file imports a bare package specifier (not relative, not `node:`).
 *   3. The built output imports something a consumer would have to install.
 *
 * Check 3 matters most: a bundler or a stray import can introduce a dependency that
 * `package.json` never mentions, and the declaration would then be wrong.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const failures = [];

const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const declared = Object.keys(manifest[field] ?? {});
  if (declared.length > 0) failures.push(`${field} must stay empty, found: ${declared.join(", ")}`);
}

async function collect(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full, extension)));
    else if (entry.name.endsWith(extension)) files.push(full);
  }
  return files;
}

/** Strip comments so documentation examples are not mistaken for real imports. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Bare specifiers only: relative paths and `node:` built-ins are always allowed. */
function externalSpecifiers(source) {
  const found = new Set();
  const code = stripComments(source);
  const patterns = [/from\s+"([^"]+)"/g, /import\s*\(\s*"([^"]+)"\s*\)/g, /require\(\s*"([^"]+)"\s*\)/g];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      found.add(specifier);
    }
  }
  return [...found];
}

for (const file of await collect(path.join(root, "src"), ".ts")) {
  const source = await readFile(file, "utf8");
  for (const specifier of externalSpecifiers(source)) {
    failures.push(`${path.relative(root, file)} imports "${specifier}"`);
  }
}

let distFiles = [];
try {
  distFiles = [
    ...(await collect(path.join(root, "dist", "esm"), ".js")),
    ...(await collect(path.join(root, "dist", "cjs"), ".js")),
  ];
} catch {
  failures.push("dist/ is missing; run the build before this check");
}

for (const file of distFiles) {
  const source = await readFile(file, "utf8");
  for (const specifier of externalSpecifiers(source)) {
    // A self-reference resolves to this package, so it is not an installed dependency.
    if (specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)) continue;
    failures.push(`${path.relative(root, file)} imports "${specifier}"`);
  }
}

if (failures.length > 0) {
  console.error("Runtime dependency check failed:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`no runtime dependencies (checked ${distFiles.length} built files)`);
