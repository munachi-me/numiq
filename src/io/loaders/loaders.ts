import type { Dataset } from "../../core/dataset.js";
import type { CsvOptions, FormatOptions, ImportFormat, JsonOptions, LoadOptions, Source } from "../types.js";
import { EnvironmentError, FormatError, ImportError, ValidationError } from "../../errors/index.js";
import { parseDelimited } from "../parsers/csv.js";
import { parseJSON } from "../parsers/json.js";
import {
  assertNotLocalPath,
  formatFromPath,
  labelFromPath,
  requireFormat,
  resolveBlob,
  resolveBytes,
  type ResolvedSource,
} from "./source.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Reads a filename from the project's `dataset/` folder.
 *
 * Supplied by the Node entry point only. The browser entry never imports it, so a bundler
 * targeting the browser cannot reach `node:fs` through the loaders.
 */
export type LocalFileReader = (filename: string, datasetDir?: string) => Promise<ResolvedSource>;

/** The three loaders that can read a local filename. */
export interface FileLoaders {
  loadCSV(source: Source, options?: LoadOptions & CsvOptions): Promise<Dataset>;
  loadTSV(source: Source, options?: LoadOptions & CsvOptions): Promise<Dataset>;
  loadJSON(source: Source, options?: LoadOptions & JsonOptions): Promise<Dataset>;
}

/**
 * Build the file loaders around a reader supplied by the entry point.
 *
 * The reader is captured in a closure rather than held in module-level state. Both entry
 * points resolve to this same module instance, so shared mutable state would let the Node
 * entry grant filesystem access to `@munachi-me/numiq/core` merely by being imported
 * first — turning a documented guarantee into a function of import order.
 *
 * `getReader` is called per load rather than once at construction so the entry point keeps
 * control of when a reader exists.
 */
export function createFileLoaders(getReader: () => LocalFileReader | null): FileLoaders {
  return {
    loadCSV: (source, options = {}) => loadWith("csv", source, options, getReader),
    loadTSV: (source, options = {}) => loadWith("tsv", source, options, getReader),
    loadJSON: (source, options = {}) => loadWith("json", source, options, getReader),
  };
}

/**
 * Load a URL, detecting the format from `format`, then the URL path, then `content-type`.
 *
 * Numiq never guesses between formats: when detection is ambiguous the call fails with a
 * `FormatError` that names what was found, so a mislabelled response cannot be silently
 * interpreted as the wrong format.
 */
export async function loadURL(
  url: string | URL,
  options: LoadOptions & FormatOptions & CsvOptions & JsonOptions = {},
): Promise<Dataset> {
  const href = url instanceof URL ? url.toString() : url;
  if (typeof href !== "string" || href.trim() === "") {
    throw new ValidationError("loadURL expects an http(s) URL.");
  }
  if (!/^https?:\/\//i.test(href)) {
    throw new ValidationError(`loadURL only supports http: and https: URLs (received "${href}").`);
  }

  const resolved = await fetchSource(href, options);
  const format = requireFormat({
    ...(options.format === undefined ? {} : { explicit: options.format }),
    ...(formatFromPath(safePathname(href)) === undefined ? {} : { declared: formatFromPath(safePathname(href))! }),
    ...(resolved.contentType === undefined ? {} : { contentType: resolved.contentType }),
    source: href,
  });

  return parseResolved(format, resolved.text, resolved, options);
}

async function loadWith(
  format: ImportFormat,
  source: Source,
  options: LoadOptions & CsvOptions & JsonOptions & FormatOptions,
  getReader: () => LocalFileReader | null,
): Promise<Dataset> {
  const resolved = await resolveSource(source, options, getReader);
  assertFormatMatches(format, resolved);
  return parseResolved(format, resolved.text, resolved, options);
}

/**
 * A format-specific loader refuses a source that declares a different format.
 *
 * `loadCSV("users.json")` must not quietly parse JSON: a caller who typed `loadCSV`
 * would otherwise receive data shaped by a format they did not ask for.
 */
function assertFormatMatches(requested: ImportFormat, resolved: ResolvedSource): void {
  const declared = resolved.declaredFormat;
  if (declared !== undefined && declared !== requested) {
    throw new FormatError(
      `load${requested.toUpperCase()} received a source that declares "${declared}" ` +
        `(${resolved.label}). Use load${declared.toUpperCase()} or pass an explicit format.`,
    );
  }
}

function parseResolved(
  format: ImportFormat,
  text: string,
  resolved: ResolvedSource,
  options: LoadOptions & CsvOptions & JsonOptions,
): Dataset {
  const shared = {
    ...options,
    source: resolved.label,
    name: options.name ?? resolved.label,
  };
  const contentType = resolved.contentType;
  if (format === "json") return parseJSON(text, { ...shared, ...(contentType === undefined ? {} : { contentType }) });
  return parseDelimited(text, {
    ...shared,
    format,
    ...(format === "tsv" && options.delimiter === undefined ? { delimiter: "\t" } : {}),
    ...(contentType === undefined ? {} : { contentType }),
  });
}

async function resolveSource(
  source: Source,
  options: LoadOptions,
  getReader: () => LocalFileReader | null,
): Promise<ResolvedSource> {
  if (source instanceof URL) {
    if (!/^https?:/i.test(source.protocol)) {
      throw new ValidationError(`Only http: and https: URLs are supported (received "${source.protocol}").`);
    }
    return fetchSource(source.toString(), options);
  }

  if (typeof source === "string") {
    if (/^https?:\/\//i.test(source)) return fetchSource(source, options);
    const reader = getReader();
    if (reader === null) assertNotLocalPath(source);
    return reader!(source, options.datasetDir);
  }

  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    return resolveBytes(source, options.name ?? "buffer");
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return resolveBlob(source, options.name);
  }

  throw new ValidationError(
    "Unsupported source. Pass a file path, an http(s) URL, a Blob or File, an ArrayBuffer, or a Uint8Array.",
  );
}

async function fetchSource(url: string, options: LoadOptions): Promise<ResolvedSource> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ValidationError("timeoutMs must be a positive number of milliseconds.");
  }

  const external = options.signal;
  // Abort before starting: a listener alone would never fire for a signal that is
  // already aborted, leaving the request to run to completion.
  if (external?.aborted) throw external.reason ?? new Error("The operation was aborted.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = (): void => controller.abort(external?.reason);
  external?.addEventListener("abort", onAbort, { once: true });

  const isTimeout = (): boolean => {
    const reason = controller.signal.reason;
    return reason instanceof Error && reason.message === "timeout";
  };

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      });
    } catch (error) {
      if (external?.aborted) throw error;
      throw new ImportError(
        isTimeout()
          ? `Request to ${url} timed out after ${timeoutMs} ms.`
          : `Could not load ${url}: ${describe(error)}.`,
        { source: url },
      );
    }

    if (!response.ok) {
      throw new ImportError(`Could not load ${url}: HTTP ${response.status} ${response.statusText}.`, {
        status: response.status,
        source: url,
      });
    }

    // The body is streamed after the headers arrive, so the timer and abort wiring must
    // stay live until `text()` settles. Clearing them on the header response would let a
    // server that stalls mid-body hang the call past the configured timeout.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (external?.aborted) throw error;
      throw new ImportError(
        isTimeout()
          ? `Reading the response body from ${url} timed out after ${timeoutMs} ms.`
          : `Could not read the response body from ${url}: ${describe(error)}.`,
        { source: url },
      );
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
      label: labelFromPath(safePathname(url)),
      ...(contentType === undefined ? {} : { contentType }),
    };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { EnvironmentError, FormatError };
