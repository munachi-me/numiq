import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tsc = path.join(root, "node_modules", ".bin", "tsc");

const run = (args) => execFileSync(tsc, args, { cwd: root, stdio: "inherit" });

await rm(path.join(root, "dist"), { recursive: true, force: true });

run(["-p", "tsconfig.esm.json", "--outDir", "dist/esm"]);
run(["-p", "tsconfig.cjs.json"]);

// Both compilations emit `.js`; mark each tree's module system so Node resolves
// `dist/cjs/*.js` as CommonJS and `dist/esm/*.js` as ESM.
await mkdir(path.join(root, "dist/esm"), { recursive: true });
await mkdir(path.join(root, "dist/cjs"), { recursive: true });
await writeFile(path.join(root, "dist/esm/package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
await writeFile(path.join(root, "dist/cjs/package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");

const entry = await readFile(path.join(root, "dist/esm/index.js"), "utf8");
if (/\bnode:/.test(entry)) {
  throw new Error("dist/esm/index.js must not reference node: built-ins.");
}
console.log("build ok");
