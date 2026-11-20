import { FormatError } from "../../errors/index.js";

/** Candidate field separators, in the order used to break ties. */
const DELIMITERS = [",", "\t", ";", "|"] as const;

/** Characters considered whitespace between a closing quote and the next delimiter. */
const TRAILING_SPACE = /[ \t]/;

/**
 * Split text into records of raw string cells.
 *
 * Quoting follows RFC 4180: a field is quoted when its first character is a double quote,
 * inner quotes are escaped by doubling, and delimiters/newlines inside quotes are literal.
 * A `\r\n` sequence inside a quoted field is normalized to `\n` so CRLF and LF sources
 * produce identical cell values.
 *
 * A stray double quote inside an unquoted field is treated as a literal character rather
 * than an error: real exports routinely contain values such as `Monitor 5" wide`, and
 * aborting the whole import over one of them is not useful.
 */
export function tokenize(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let index = 0;
  let quoted = false;

  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      if (char === "\r" && text[index + 1] === "\n") {
        field += "\n";
        index += 2;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRecord();
      index += 1;
      continue;
    }
    if (char === "\r") {
      endRecord();
      index += text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (quoted) throw new FormatError("CSV contains an unterminated quoted field.");

  // A trailing newline produces an empty tail record; drop it rather than emit a blank row.
  if (field !== "" || record.length > 0) endRecord();

  return records;
}

/**
 * Choose a delimiter by counting candidates outside quotes.
 *
 * Detection inspects several non-blank lines rather than only the first, so a preamble
 * line (a report title, for example) cannot decide the delimiter for the whole file.
 */
export function detectDelimiter(text: string, sampleLines = 10): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== "")
    .slice(0, sampleLines);
  if (lines.length === 0) return ",";

  let best: { delimiter: string; score: number } = { delimiter: ",", score: 0 };

  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const positive = counts.filter((count) => count > 0);
    if (positive.length === 0) continue;

    // Prefer a delimiter that appears the same number of times on every sampled line:
    // that consistency is what distinguishes real columns from incidental punctuation.
    const frequency = new Map<number, number>();
    for (const count of positive) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    let modalCount = 0;
    let modalLines = 0;
    for (const [count, occurrences] of frequency) {
      if (occurrences > modalLines || (occurrences === modalLines && count > modalCount)) {
        modalCount = count;
        modalLines = occurrences;
      }
    }

    const score = modalLines * 1000 + modalCount;
    if (score > best.score) best = { delimiter, score };
  }

  return best.delimiter;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

export { TRAILING_SPACE };
