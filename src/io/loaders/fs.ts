import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative as relativePath, resolve } from "node:path";
import { ImportError, ValidationError } from "../../errors/index.js";
import { formatFromPath, labelFromPath, type ResolvedSource } from "./source.js";

/** Folder name a project uses for its data files. Fixed by the v0.2.0 contract. */
export const DATASET_DIR_NAME = "dataset";

/**
 * Resolve the directory that local filenames are read from.
 *
 * Defaults to `<cwd>/dataset`. `process.cwd()` is the Node project-root convention and is
 * used as-is rather than walking up the tree, because guessing a root from an arbitrary
 * parent would make it unclear which folder a call reads from.
 */
export function resolveDatasetDir(datasetDir?: string): string {
  const base = datasetDir ?? process.cwd();
  return resolve(base, DATASET_DIR_NAME);
}

/**
 * Reject anything that is not a bare filename.
 *
 * The dataset folder is a sandbox, not a convenience prefix: a caller cannot reach a
 * parent directory, an absolute path, or a nested subdirectory through this API. Data
 * that lives elsewhere must be passed as a URL, Blob, or in-memory value instead.
 */
function assertBareFilename(filename: string): void {
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new ValidationError('A local filename is required, for example loadCSV("sales.csv").');
  }
  if (isAbsolute(filename) || /^[A-Za-z]:[\\/]/.test(filename)) {
    throw new ValidationError(
      `Absolute paths are not allowed: "${filename}". Local files are read from the project's dataset/ folder, ` +
        "so pass a filename only.",
    );
  }
  if (filename.includes("\0")) {
    throw new ValidationError("A filename cannot contain a null byte.");
  }
  // Both separators are checked on every platform: a POSIX host must still refuse
  // "..\\secrets.csv" so behaviour cannot depend on where the code runs.
  if (filename.includes("/") || filename.includes("\\")) {
    throw new ValidationError(
      `Path separators are not allowed in "${filename}". Local files are read from the project's dataset/ ` +
        "folder, so pass a filename only, without directories.",
    );
  }
  if (filename === "." || filename === "..") {
    throw new ValidationError(`"${filename}" is not a file name.`);
  }
}

/**
 * Read a local dataset file by filename from `<projectRoot>/dataset`.
 *
 * Every path is resolved with `realpath` before the containment check, so a symlink
 * inside `dataset/` cannot point outside it.
 */
export async function readLocalFile(filename: string, datasetDir?: string): Promise<ResolvedSource> {
  assertBareFilename(filename);

  const dir = resolveDatasetDir(datasetDir);
  const target = join(dir, filename);

  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ImportError(
        `No dataset folder found at ${dir}. Create a "dataset" folder in your project root and put ` +
          `"${filename}" inside it.`,
        { source: filename },
      );
    }
    throw new ImportError(`Could not open the dataset folder ${dir}: ${(error as Error).message}.`, {
      source: filename,
    });
  }

  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ImportError(`File not found: ${filename}. Expected it at ${join(realDir, filename)}.`, {
        source: filename,
      });
    }
    if (code === "EACCES") throw new ImportError(`Permission denied reading ${filename}.`, { source: filename });
    throw new ImportError(`Could not read ${filename}: ${(error as Error).message}.`, { source: filename });
  }

  // Containment is checked on real paths. A symlink inside dataset/ that resolves outside
  // it would otherwise read an arbitrary file while appearing to respect the sandbox.
  const relative = relativePath(realDir, realTarget);
  if (relative === "" || relative.startsWith("..") || isAbsolute(relative)) {
    throw new ImportError(`Refusing to read "${filename}": it resolves outside the dataset folder (${realDir}).`, {
      source: filename,
    });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(realTarget);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EISDIR") throw new ImportError(`${filename} is a directory, not a file.`, { source: filename });
    throw new ImportError(`Could not read ${filename}: ${(error as Error).message}.`, { source: filename });
  }

  const text = buffer.toString("utf8");
  const declaredFormat = formatFromPath(filename);
  return {
    text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    label: labelFromPath(filename),
    ...(declaredFormat === undefined ? {} : { declaredFormat }),
  };
}
