import type { Row, TableOptions } from "../core/types.js";

const DEFAULTS = {
  maxRows: 1000,
  maxColumns: 20,
  maxCellWidth: 28,
  showIndex: true,
  showShape: true,
} as const;

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function clip(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 1))}…`;
}

function validateOptions(options: TableOptions): Required<TableOptions> {
  const maxRows = options.maxRows ?? DEFAULTS.maxRows;
  if (maxRows !== Infinity && (!Number.isInteger(maxRows) || maxRows < 0)) {
    throw new RangeError("maxRows must be a non-negative integer or Infinity.");
  }
  const maxColumns = options.maxColumns ?? DEFAULTS.maxColumns;
  if (!Number.isInteger(maxColumns) || maxColumns < 1) {
    throw new RangeError("maxColumns must be a positive integer.");
  }
  const maxCellWidth = options.maxCellWidth ?? DEFAULTS.maxCellWidth;
  if (!Number.isInteger(maxCellWidth) || maxCellWidth < 1) {
    throw new RangeError("maxCellWidth must be a positive integer.");
  }
  return {
    maxRows,
    maxColumns,
    maxCellWidth,
    showIndex: options.showIndex ?? DEFAULTS.showIndex,
    showShape: options.showShape ?? DEFAULTS.showShape,
  };
}

/**
 * Render rows as a box-drawing table.
 *
 * Only the first `maxRows` rows are formatted, so rendering a large dataset stays
 * proportional to the visible slice rather than to the dataset size.
 */
export function renderTable(rows: readonly Row[], columns: readonly string[], options: TableOptions = {}): string {
  const { maxRows, maxColumns, maxCellWidth, showIndex, showShape } = validateOptions(options);
  const totalRows = rows.length;
  const totalColumns = columns.length;
  const visibleColumns = columns.slice(0, maxColumns);
  const omittedColumns = totalColumns - visibleColumns.length;
  const limit = maxRows === Infinity ? totalRows : Math.min(maxRows, totalRows);

  const header: string[] = [
    ...(showIndex ? ["idx"] : []),
    ...visibleColumns,
    ...(omittedColumns > 0 ? [`… ${omittedColumns} more`] : []),
  ];

  const body: string[][] = [];
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    body.push([
      ...(showIndex ? [String(index)] : []),
      ...visibleColumns.map((column) => clip(renderCell(row?.[column]).replace(/\s+/g, " ").trim(), maxCellWidth)),
      ...(omittedColumns > 0 ? ["…"] : []),
    ]);
  }

  if (totalColumns === 0) {
    const lines = ["(empty dataset: 0 columns)"];
    if (totalRows > 0) lines.push(`${totalRows} rows × 0 columns`);
    return lines.join("\n");
  }

  const widths = header.map((label, columnIndex) =>
    Math.max(label.length, ...body.map((cells) => (cells[columnIndex] ?? "").length), 1),
  );

  const rule = (left: string, middle: string, right: string): string =>
    left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
  const line = (cells: readonly string[]): string =>
    "│" + cells.map((cell, index) => ` ${cell.padEnd(widths[index] ?? 1)} `).join("│") + "│";

  const output = [rule("┌", "┬", "┐"), line(header), rule("├", "┼", "┤")];

  if (totalRows === 0) {
    // The dataset genuinely has no rows; say so rather than showing an empty frame.
    output.push(line(header.map(() => "—")));
    output.push(rule("└", "┴", "┘"));
    output.push("(no rows)");
  } else {
    output.push(...body.map(line), rule("└", "┴", "┘"));
    output.push(`Showing ${limit} of ${totalRows} rows.`);
  }

  if (showShape) output.push(`${totalRows} rows × ${totalColumns} columns`);
  return output.join("\n");
}
