import type { ImportReport, ImportWarning, NormalizationPolicy, Row } from "../../core/types.js";
import { deepFreeze } from "../../utils/values.js";

/** Mutable accumulator used while a parser walks its input. */
export class ReportBuilder {
  readonly warnings: ImportWarning[] = [];
  rowsRead = 0;

  constructor(
    readonly format: ImportReport["format"],
    readonly source: string,
    readonly policy: NormalizationPolicy,
  ) {}

  warn(code: string, message: string, location: { row?: number; column?: string } = {}): void {
    const warning: ImportWarning = { code, message };
    if (location.row !== undefined) warning.row = location.row;
    if (location.column !== undefined) warning.column = location.column;
    this.warnings.push(warning);
  }

  build(
    rows: readonly Row[],
    columns: readonly string[],
    extra: { delimiter?: string; contentType?: string } = {},
  ): ImportReport {
    const missingByColumn: Record<string, number> = {};
    for (const column of columns) {
      let missing = 0;
      for (const row of rows) if (row[column] === null || row[column] === undefined) missing += 1;
      missingByColumn[column] = missing;
    }

    const report: ImportReport = {
      format: this.format,
      source: this.source,
      rowsRead: this.rowsRead,
      rowsImported: rows.length,
      columns: [...columns],
      missingByColumn,
      warnings: this.warnings,
      normalization: this.policy,
      ...(extra.delimiter === undefined ? {} : { delimiter: extra.delimiter }),
      ...(extra.contentType === undefined ? {} : { contentType: extra.contentType }),
    };
    return deepFreeze(report);
  }
}
