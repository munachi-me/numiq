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

/** Load a CSV file or URL into a dataset. */
export function loadCSV(source: Source, options: LoadOptions & CsvOptions = {}): Promise<Dataset> {
  return loadWith("csv", source, options);
}

/** Load a TSV file or URL into a dataset. */
export function loadTSV(source: Source, options: LoadOptions & CsvOptions = {}): Promise<Dataset> {
  return loadWith("tsv", source, options);
}

/** Load a JSON file or URL into a dataset. */
export function loadJSON(source: Source, options: LoadOptions & JsonOptions = {}): Promise<Dataset> {
  return loadWith("json", source, options);
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
): Promise<Dataset> {
  const resolved = await resolveSource(source, options);
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

async function resolveSource(source: Source, options: LoadOptions): Promise<ResolvedSource> {
  if (source instanceof URL) {
    if (!/^https?:/i.test(source.protocol)) {
      throw new ValidationError(`Only http: and https: URLs are supported (received "${source.protocol}").`);
    }
    return fetchSource(source.toString(), options);
  }

  if (typeof source === "string") {
    if (/^https?:\/\//i.test(source)) return fetchSource(source, options);
    return readLocalFile(source);
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

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    });
  } catch (error) {
    if (external?.aborted) throw error;
    const reason = controller.signal.reason;
    const timedOut = reason instanceof Error && reason.message === "timeout";
    throw new ImportError(
      timedOut ? `Request to ${url} timed out after ${timeoutMs} ms.` : `Could not load ${url}: ${describe(error)}.`,
      { source: url },
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    throw new ImportError(`Could not load ${url}: HTTP ${response.status} ${response.statusText}.`, {
      status: response.status,
      source: url,
    });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ImportError(`Could not read the response body from ${url}: ${describe(error)}.`, { source: url });
  }

  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    label: labelFromPath(safePathname(url)),
    ...(contentType === undefined ? {} : { contentType }),
  };
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

/**
 * Local file access is injected by the Node entry point.
 *
 * The browser entry leaves this unset, so `loadCSV("data.csv")` fails with an actionable
 * `EnvironmentError` instead of a bundler error or a silent failure.
 */
export type LocalFileReader = (path: string) => Promise<ResolvedSource>;

let localFileReader: LocalFileReader | null = null;

/** @internal Used by the Node entry point to enable filesystem loading. */
export function setLocalFileReader(reader: LocalFileReader): void {
  localFileReader = reader;
}

async function readLocalFile(path: string): Promise<ResolvedSource> {
  if (localFileReader === null) assertNotLocalPath(path);
  return localFileReader!(path);
}

export { EnvironmentError, FormatError };
