/**
 * Numiq Node.js entry point.
 *
 * Adds filesystem support to the browser-safe core by installing a local file reader.
 * `import Numiq from "@munachi-me/numiq"` resolves here under the `node` export condition.
 */
import { setLocalFileReader } from "./io/loaders/loaders.js";
import { readLocalFile } from "./io/loaders/fs.js";

setLocalFileReader(readLocalFile);

export * from "./index.js";
export { default } from "./index.js";
