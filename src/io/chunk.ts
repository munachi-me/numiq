/**
 * Chunked reading of delimited text.
 *
 * `parseDelimited()` wants the whole file in memory, which is fine for a few megabytes and
 * wrong for a few hundred. This module splits the text on record boundaries and parses one
 * batch at a time, so peak memory tracks the batch size rather than the file size.
 *
 * Splitting happens *after* tokenizing, not before. A newline inside a quoted field is
 * data, and splitting the raw text on `\n` would cut such a record in half — the classic
 * way a streaming CSV reader corrupts a file containing addresses. Tokenizing first is
 * slower per byte but cannot be wrong, and correctness is not negotiable here.
 *
 * This is a distinct API from ordinary in-memory loading on purpose: a caller who streams
 * should know they are streaming, because the chunks arrive in order and only the current
 * one is held.
 */
import { ValidationError } from "../errors/index.js";
import { Dataset, createDataset } from "../core/dataset.js";
import type { CsvOptions, DelimitedFormat } from "./types.js";
import { parseDelimited } from "./parsers/csv.js";
import { detectDelimiter, tokenize } from "./parsers/csv-tokenizer.js";

/** Options for `chunkDelimited()`. */
export interface ChunkOptions extends CsvOptions {
  /** Records per chunk. Defaults to 10,000. */
  readonly chunkSize?: number;
  /** Called after each chunk. Return `false` to stop before the next one. */
  readonly onProgress?: (progress: ChunkProgress) => void | boolean;
  /** Return `false` from `onProgress` to stop early. */
  readonly signal?: AbortSignal;
}

/** Progress reported after each chunk. */
export interface ChunkProgress {
  /** Zero-based chunk index. */
  readonly chunk: number;
  /** Rows in this chunk, excluding the header. */
  readonly rows: number;
  /** Rows delivered so far, excluding headers. */
  readonly delivered: number;
  /** Zero-based index of the last source record read, so 0 after the first record. */
  readonly lastRecord: number;
}

/**
 * Re-quote one field so the rebuilt chunk text tokenizes back to the same cell.
 *
 * `tokenize()` has already removed the original quoting, so a field holding a delimiter,
 * a quote, or a newline must be quoted again on the way out. Joining raw cells would split
 * a multi-line record across two lines and corrupt the chunk.
 */
function requoteField(cell: string, delimiter: string): string {
  if (cell.includes(delimiter) || cell.includes('"') || cell.includes("\n") || cell.includes("\r")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function requoteRecord(record: readonly string[], delimiter: string): string {
  return record.map((cell) => requoteField(cell, delimiter)).join(delimiter);
}

/**
 * Split delimited text into chunks, each parsed into a `Dataset`.
 *
 * The header row is parsed once and applied to every chunk, so each chunk is a complete,
 * independently usable dataset with the same columns. Chunks are returned lazily through a
 * generator: nothing is parsed until the caller asks for it.
 */
export function* chunkDelimited(
  text: string,
  format: DelimitedFormat,
  options: ChunkOptions = {},
): Generator<Dataset, void, undefined> {
  if (typeof text !== "string") throw new ValidationError("chunkDelimited() needs CSV text.");
  if (format !== "csv" && format !== "tsv") {
    throw new ValidationError(`chunkDelimited() format must be "csv" or "tsv", received ${JSON.stringify(format)}.`);
  }
  const chunkSize = options.chunkSize ?? 10_000;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new ValidationError("chunkDelimited() chunkSize must be a positive integer.");
  }

  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const skipRows = options.skipRows ?? 0;
  const delimiter = options.delimiter ?? detectDelimiter(body, 10, skipRows);
  // Blank lines are not rows. `parseDelimited()` drops them before applying `skipRows`, so
  // doing anything else here would give a chunked read different columns and fewer rows
  // than a whole-file read of the same text.
  const records = tokenize(body, delimiter).filter((record) => record.some((cell) => cell.trim() !== ""));
  if (skipRows >= records.length) return;

  const { skipRows: _skip, chunkSize: _size, onProgress, signal, columns, ...parseOptions } = options;
  const hasHeader = options.header !== false;

  // Each chunk is rebuilt as header-then-rows so `parseDelimited` applies one code path.
  // Headerless input therefore needs a synthetic header: the real first record is data and
  // must not be consumed as names.
  let header: string[];
  let data: readonly (readonly string[])[];
  if (hasHeader) {
    header = records[skipRows] as string[];
    data = records.slice(skipRows + 1);
  } else {
    data = records.slice(skipRows);
    const width = data.reduce((max, record) => Math.max(max, record.length), 0);
    if (columns !== undefined && columns.length !== width) {
      throw new ValidationError(
        `header is false and ${width} columns of data were found, but ${columns.length} column names were supplied.`,
      );
    }
    header = columns !== undefined ? [...columns] : Array.from({ length: width }, (_, index) => `column_${index + 1}`);
  }

  let delivered = 0;
  let chunkIndex = 0;
  for (let start = 0; start < data.length; start += chunkSize) {
    if (signal?.aborted === true) return;
    const slice = data.slice(start, start + chunkSize);
    // Rebuild the text for this chunk with the shared header so `parseDelimited` applies
    // the same normalization, casting, and type inference as a whole-file load.
    const chunkText = [header, ...slice].map((record) => requoteRecord(record, delimiter)).join("\n");
    const dataset = parseDelimited(chunkText, {
      ...parseOptions,
      // `columns` is already resolved into the synthetic header, and `parseDelimited` rejects
      // it alongside `header: true`. Forward it only for a real header, where it should throw.
      ...(hasHeader && columns !== undefined ? { columns } : {}),
      format,
      delimiter,
      header: true,
      skipRows: 0,
    });
    const rows = dataset.rowCount;
    delivered += rows;
    if (onProgress !== undefined) {
      const progress: ChunkProgress = {
        chunk: chunkIndex,
        rows,
        delivered,
        lastRecord: start + slice.length - 1,
      };
      if (onProgress(progress) === false) {
        yield dataset;
        return;
      }
    }
    yield dataset;
    chunkIndex += 1;
  }
}

/**
 * Fold every chunk into a single value without holding the file.
 *
 * `reduce` is where incremental aggregation belongs: a running total over a million rows
 * needs the total, not the million rows. Each chunk is offered to `step` and then dropped.
 */
export function reduceChunks<T>(
  text: string,
  format: DelimitedFormat,
  step: (accumulator: T, chunk: Dataset, progress: ChunkProgress) => T,
  initial: T,
  options: ChunkOptions = {},
): T {
  let accumulator = initial;
  let progress: ChunkProgress | undefined;
  const forward = options.onProgress;
  const chunks = chunkDelimited(text, format, {
    ...options,
    // Take progress from the generator rather than recomputing it, so `step` sees the same
    // record positions as an `onProgress` callback would.
    onProgress: (current) => {
      progress = current;
      return forward?.(current);
    },
  });
  for (const chunk of chunks) {
    if (progress === undefined) continue;
    accumulator = step(accumulator, chunk, progress);
  }
  return accumulator;
}

/**
 * Concatenate every chunk into one dataset.
 *
 * The convenience case: streaming bought nothing but the caller wanted one result anyway.
 * Prefer `chunkDelimited()` or `reduceChunks()` when the file is genuinely large, because
 * this holds the whole result in memory by definition.
 */
export function collectChunks(text: string, format: DelimitedFormat, options: ChunkOptions = {}): Dataset {
  const chunks = [...chunkDelimited(text, format, options)];
  if (chunks.length === 0) {
    return createDataset([], { name: "Dataset" });
  }
  const first = chunks[0] as Dataset;
  const rows = chunks.flatMap((chunk) => chunk.data);
  return createDataset(rows, { columns: [...first.columns], name: first.name });
}
