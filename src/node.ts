/**
 * Numiq Node.js entry point.
 *
 * Binds the file loaders to a real filesystem reader and re-exports the browser-safe core
 * unchanged. `import Numiq from "@munachi-me/numiq"` resolves here under the `node` export
 * condition.
 *
 * The reader is captured per entry point instead of being installed into shared module
 * state, so importing this module cannot grant filesystem access to
 * `@munachi-me/numiq/core` — that entry builds its loaders with no reader and is
 * unaffected by import order.
 */
import { createFileLoaders, loadURL } from "./io/loaders/loaders.js";
import { readLocalFile } from "./io/loaders/fs.js";
import NumiqCore from "./index.js";

const { loadCSV, loadJSON, loadTSV } = createFileLoaders(() => readLocalFile);

export * from "./index.js";
export { loadCSV, loadJSON, loadTSV, loadURL };

/**
 * Default namespace with the Node-bound loaders substituted.
 *
 * Every other member is the same object as its named export, as in the core entry.
 */
const Numiq = {
  ...NumiqCore,
  loadCSV,
  loadJSON,
  loadTSV,
} as const;

export default Numiq;
