import { readFile } from "node:fs/promises";
import { ImportError } from "../../errors/index.js";
import { formatFromPath, labelFromPath, type ResolvedSource } from "./source.js";

/**
 * Node-only local file reader.
 *
 * Paths are resolved relative to the current working directory and are otherwise
 * unconstrained: Numiq is a library, so it must not dictate where a consumer keeps
 * its data.
 */
export async function readLocalFile(path: string): Promise<ResolvedSource> {
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new ImportError(`File not found: ${path}.`, { source: path });
    if (code === "EACCES") throw new ImportError(`Permission denied reading ${path}.`, { source: path });
    if (code === "EISDIR") throw new ImportError(`${path} is a directory, not a file.`, { source: path });
    throw new ImportError(`Could not read ${path}: ${(error as Error).message}.`, { source: path });
  }

  const text = buffer.toString("utf8");
  const declaredFormat = formatFromPath(path);
  return {
    text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    label: labelFromPath(path),
    ...(declaredFormat === undefined ? {} : { declaredFormat }),
  };
}
