import type { Dataset } from "../../core/dataset.js";
import type { ImportFormat } from "../types.js";
import { EnvironmentError, FormatError } from "../../errors/index.js";

/** A source that has been resolved to text plus whatever metadata the reader knows. */
export interface ResolvedSource {
  text: string;
  /** Reported format when the source itself declares one (an extension or content type). */
  declaredFormat?: ImportFormat;
  contentType?: string;
  /** Human-readable label used for the dataset name and import report. */
  label: string;
}

const EXTENSION_FORMATS: Record<string, ImportFormat> = {
  csv: "csv",
  tsv: "tsv",
  json: "json",
};

/** Map a filename or URL path to a format, or `undefined` when the extension is unknown. */
export function formatFromPath(pathname: string): ImportFormat | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(pathname);
  if (!match) return undefined;
  return EXTENSION_FORMATS[match[1]!.toLowerCase()];
}

/** Map a `content-type` header to a format, or `undefined` when it is not a supported type. */
export function formatFromContentType(contentType: string): ImportFormat | undefined {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) return "json";
  if (type === "text/tab-separated-values" || type === "application/tsv") return "tsv";
  if (type === "text/csv" || type === "application/csv") return "csv";
  return undefined;
}

/** Strip directories and a trailing extension to produce a dataset name. */
export function labelFromPath(pathname: string): string {
  const file = pathname.split(/[\\/]/).pop() ?? "";
  const base = file.replace(/\.[^.]+$/, "");
  return base === "" ? "Dataset" : base;
}

/** Guard used by browser-safe code paths that cannot touch the filesystem. */
export function assertNotLocalPath(source: string): void {
  if (/^https?:\/\//i.test(source)) return;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) {
    throw new EnvironmentError(
      `Unsupported URL scheme in "${source}". Numiq loads http: and https: URLs; use a Blob or File for local data.`,
    );
  }
  throw new EnvironmentError(
    `Local file paths require the Node.js build of Numiq (received "${source}"). ` +
      "In a browser, pass a File, Blob, or URL instead.",
  );
}

/** Decode bytes as UTF-8. Shared so both environments strip a BOM identically. */
export function decodeBytes(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Resolve a Blob or File into text. Available in both environments. */
export async function resolveBlob(blob: Blob, label?: string): Promise<ResolvedSource> {
  const text = await blob.text();
  const name = label ?? ("name" in blob && typeof blob.name === "string" ? blob.name : "blob");
  const declaredFormat = formatFromPath(name);
  const contentType = blob.type || undefined;
  return {
    text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    ...(declaredFormat === undefined ? {} : { declaredFormat }),
    ...(contentType === undefined ? {} : { contentType }),
    label: labelFromPath(name),
  };
}

/** Resolve an ArrayBuffer or typed array into text. */
export function resolveBytes(input: ArrayBuffer | Uint8Array, label = "buffer"): ResolvedSource {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return { text: decodeBytes(bytes), label };
}

/** Choose a format, or fail with an explicit message listing what was available. */
export function requireFormat(candidates: {
  explicit?: ImportFormat;
  declared?: ImportFormat;
  contentType?: string;
  source: string;
}): ImportFormat {
  if (candidates.explicit) return candidates.explicit;
  if (candidates.declared) return candidates.declared;
  if (candidates.contentType) {
    const fromHeader = formatFromContentType(candidates.contentType);
    if (fromHeader) return fromHeader;
  }
  const seen = [
    candidates.declared === undefined ? null : `extension implies "${candidates.declared}"`,
    candidates.contentType === undefined ? null : `content-type was "${candidates.contentType}"`,
  ].filter((entry): entry is string => entry !== null);
  const detail = seen.length > 0 ? ` (${seen.join("; ")})` : "";
  throw new FormatError(
    `Could not determine the data format of "${candidates.source}"${detail}. ` +
      "Supported formats are csv, tsv, and json; pass { format } to choose one explicitly.",
  );
}

export type { Dataset };
