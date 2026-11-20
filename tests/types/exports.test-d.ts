/**
 * Compile-time contract for the published types.
 *
 * This file is never executed; `tsc --noEmit` fails the build if a documented shape
 * regresses. It imports from `src` so it exercises the same declarations consumers get.
 */
import Numiq, {
  createDataset,
  loadCSV,
  Dataset,
  type Row,
  type DType,
  type TableOptions,
  type ImportReport,
  type ColumnSchema,
  type NormalizationPolicy,
  type DatasetOptions,
  type CsvOptions,
  type JsonOptions,
  ValidationError,
  ColumnNotFoundError,
} from "../../src/index.js";

declare function expectType<T>(value: T): void;

// createDataset accepts records, column-oriented data, and a Dataset.
const fromRecords: Dataset = createDataset([{ a: 1 }]);
const fromColumns: Dataset = createDataset({ a: [1, 2] });
const fromDataset: Dataset = createDataset(fromRecords);
expectType<Dataset>(fromRecords);
expectType<Dataset>(fromColumns);
expectType<Dataset>(fromDataset);

// Documented Dataset members.
expectType<readonly string[]>(fromRecords.columns);
expectType<readonly [number, number]>(fromRecords.shape);
expectType<readonly Row[]>(fromRecords.data);
expectType<number>(fromRecords.rowCount);
expectType<number>(fromRecords.columnCount);
expectType<number>(fromRecords.length);
expectType<boolean>(fromRecords.empty);
expectType<string>(fromRecords.table());
expectType<string>(fromRecords.table({ maxRows: 10 }));
expectType<string>(fromRecords.toTable());
expectType<Dataset>(fromRecords.display());
expectType<Dataset>(fromRecords.head());
expectType<Dataset>(fromRecords.tail(2));
expectType<Readonly<Record<string, DType>>>(fromRecords.dtypes);
expectType<Readonly<Record<string, ColumnSchema>>>(fromRecords.schema);
expectType<ImportReport | null>(fromRecords.importReport);
expectType<number>(fromRecords.unique("a"));
expectType<unknown[]>(fromRecords.distinct("a"));

// Loaders are async and accept the documented sources.
expectType<Promise<Dataset>>(loadCSV("a.csv"));
expectType<Promise<Dataset>>(loadCSV(new Blob(["a\n1"])));
expectType<Promise<Dataset>>(loadCSV(new Uint8Array([97])));
expectType<Promise<Dataset>>(Numiq.loadURL("https://example.com/a.csv"));
expectType<Dataset>(Numiq.parseDelimited("a\n1", { format: "csv" }));
expectType<Dataset>(Numiq.parseJSON('[{"a":1}]'));

// Option bags are structural and all-optional.
const tableOptions: TableOptions = { maxRows: 5, maxColumns: 3, maxCellWidth: 10, showIndex: false, showShape: false };
const datasetOptions: DatasetOptions = { columns: ["a"], name: "n", metadata: { k: 1 } };
const csvOptions: CsvOptions = { delimiter: ",", header: true, skipRows: 0, onInvalid: "null", onRaggedRow: "pad" };
const jsonOptions: JsonOptions = { columns: ["a"], skipRows: 1 };
const policy: Partial<NormalizationPolicy> = { trimStrings: true, nullValues: ["", "NA"] };
expectType<TableOptions>(tableOptions);
expectType<DatasetOptions>(datasetOptions);
expectType<CsvOptions>(csvOptions);
expectType<JsonOptions>(jsonOptions);
expectType<Partial<NormalizationPolicy>>(policy);

// Schema entries accept a bare type or a descriptor.
createDataset([{ a: "1" }], { normalization: policy });
Numiq.parseDelimited("a\n1", { format: "csv", schema: { a: "integer" } });
Numiq.parseDelimited("a\n1", { format: "csv", schema: { a: { type: "date", format: "YYYY-MM-DD" } } });

// Errors are catchable by class and expose their code.
try {
  fromRecords.column("missing");
} catch (error) {
  if (error instanceof ColumnNotFoundError) expectType<string>(error.column);
  if (error instanceof ValidationError) expectType<"VALIDATION_ERROR">(error.code as "VALIDATION_ERROR");
}

// @ts-expect-error a bare array is not a valid source
loadCSV([1, 2, 3]);
// @ts-expect-error columns must be strings
createDataset([{ a: 1 }], { columns: [1] });
// @ts-expect-error head takes a number
fromRecords.head("two");
// @ts-expect-error maxRows must be numeric
fromRecords.table({ maxRows: "10" });
