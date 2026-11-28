/**
 * Chunked reading of delimited text.
 *
 * `parseDelimited()` wants the whole file in memory, which is fine for a few megabytes and
 * wrong for a few hundred. This module walks the text record by record and parses one batch
 * at a time, so peak memory tracks the batch size rather than the file size.
 *
 * Records come from `tokenizeRecords()`, a generator that carries quoting state across the
 * whole input. A newline inside a quoted field is data, so the record boundary cannot be
 * found by splitting the raw text on `\n` — that is the classic way a streaming CSV reader
 * corrupts a file containing addresses. Quoting is honoured during the walk, so the records
 * are correct and only the current chunk is held.
 *
 * The input is a string, so the source text is in memory either way. What this avoids is a
 * second full representation: the tokenized array of every record in the file.
 */
import { ValidationError } from "../errors/index.js";
import { Dataset, createDataset } from "../core/dataset.js";
import type { CsvOptions, DelimitedFormat } from "./types.js";
import { parseDelimited } from "./parsers/csv.js";
import { detectDelimiter, tokenizeRecords } from "./parsers/csv-tokenizer.js";

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
 * Non-blank records after the skipped preamble, optionally dropping the header record.
 *
 * Blank lines are not rows, and `parseDelimited()` drops them before applying `skipRows`, so
 * doing anything else here would give a chunked read different columns and fewer rows than a
 * whole-file read of the same text. `skipRows` counts non-blank records, matching the parser.
 */
function* recordsAfter(
  text: string,
  delimiter: string,
  skipRows: number,
  dropHeader: boolean,
): Generator<string[], void, undefined> {
  let skipped = 0;
  let headerPending = dropHeader;
  for (const record of tokenizeRecords(text, delimiter)) {
    if (!record.some((cell) => cell.trim() !== "")) continue;
    if (skipped < skipRows) {
      skipped += 1;
      continue;
    }
    if (headerPending) {
      headerPending = false;
      continue;
    }
    yield record;
  }
}

/**
 * Split delimited text into chunks, each parsed into a `Dataset`.
 *
 * The header row is parsed once and applied to every chunk, so each chunk is a complete,
 * independently usable dataset with the same columns. Chunks are returned lazily through a
 * generator: nothing is parsed until the caller asks for it.
 *
 * Tokenizing is incremental: records are pulled from `tokenizeRecords()` one at a time and
 * only `chunkSize` of them are held before a chunk is emitted, so peak memory tracks the
 * chunk size rather than the file size. The input string itself is already in memory — this
 * is not a streaming reader for a file or a socket, and callers should not read it as one.
 *
 * `header: false` is the one non-incremental case: naming the columns needs the widest
 * record in the file (that is how `parseDelimited()` names them), so the width is measured
 * in a first pass. That pass retains no records, so memory still tracks the chunk size.
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

  const { skipRows: _skip, chunkSize: _size, onProgress, signal, columns, ...parseOptions } = options;
  const hasHeader = options.header !== false;

  let header: string[];
  if (hasHeader) {
    const first = recordsAfter(body, delimiter, skipRows, false)[Symbol.iterator]().next();
    if (first.done === true) return;
    header = first.value;
  } else {
    let width = 0;
    for (const record of recordsAfter(body, delimiter, skipRows, false)) width = Math.max(width, record.length);
    if (columns !== undefined && columns.length !== width) {
      throw new ValidationError(
        `header is false and ${width} columns of data were found, but ${columns.length} column names were supplied.`,
      );
    }
    header = columns !== undefined ? [...columns] : Array.from({ length: width }, (_, index) => `column_${index + 1}`);
  }

  // Each chunk is rebuilt as header-then-rows so `parseDelimited` applies the same
  // normalization, casting, and type inference as a whole-file load. `rowOffset` keeps
  // error row numbers referring to the source file rather than restarting per chunk.
  const build = (records: readonly (readonly string[])[], rowOffset: number): Dataset => {
    const chunkText = [header, ...records].map((record) => requoteRecord(record, delimiter)).join("\n");
    return parseDelimited(chunkText, {
      ...parseOptions,
      // `columns` is already resolved into the synthetic header, and `parseDelimited` rejects
      // it alongside `header: true`. Forward it only for a real header, where it should throw.
      ...(hasHeader && columns !== undefined ? { columns } : {}),
      format,
      delimiter,
      header: true,
      skipRows: 0,
      rowOffset,
    });
  };

  let delivered = 0;
  let chunkIndex = 0;
  let lastRecord = -1;
  let pending: string[][] = [];

  for (const record of recordsAfter(body, delimiter, skipRows, hasHeader)) {
    if (signal?.aborted === true) return;
    pending.push(record);
    lastRecord += 1;
    if (pending.length < chunkSize) continue;
    const dataset = build(pending, lastRecord - pending.length + 1);
    pending = [];
    delivered += dataset.rowCount;
    const stop = onProgress?.({ chunk: chunkIndex, rows: dataset.rowCount, delivered, lastRecord }) === false;
    yield dataset;
    chunkIndex += 1;
    if (stop) return;
  }

  if (pending.length > 0) {
    const dataset = build(pending, lastRecord - pending.length + 1);
    delivered += dataset.rowCount;
    onProgress?.({ chunk: chunkIndex, rows: dataset.rowCount, delivered, lastRecord });
    yield dataset;
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
    // No data records, so the generator yields nothing and the header never reaches a
    // chunk. The header still defines the columns, and a whole-file parse reports them, so
    // delegate rather than return a columnless dataset.
    const { chunkSize: _size, onProgress: _progress, signal: _signal, ...parseOptions } = options;
    return parseDelimited(text, { ...parseOptions, format });
  }
  const first = chunks[0] as Dataset;
  const rows = chunks.flatMap((chunk) => chunk.data);
  return createDataset(rows, { columns: [...first.columns], name: first.name });
}
