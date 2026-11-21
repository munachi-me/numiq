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
  useSampleDataset,
  type SortDirection,
  ValidationError,
  ColumnNotFoundError,
  type DropMissingOptions,
  type FillStrategy,
  type ReplaceRule,
  type SampleOptions,
  Query,
  type QueryOperator,
  type ComparisonOperator,
  type QueryDirection,
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

// v0.3.0 preparation methods return a Dataset so they chain.
expectType<Dataset>(fromRecords.drop(["a"]));
expectType<Dataset>(fromRecords.drop("a"));
expectType<Dataset>(fromRecords.rename({ a: "b" }));
expectType<Dataset>(fromRecords.dropMissing());
expectType<Dataset>(fromRecords.dropMissing({ how: "all" }));
expectType<Dataset>(fromRecords.fillMissing({ a: 0 }));
expectType<Dataset>(fromRecords.fillMissing({ a: "mean" }));
expectType<Dataset>(fromRecords.fillMissing(0));
expectType<Dataset>(fromRecords.replace({ a: { from: 1, to: 2 } }));
expectType<Dataset>(fromRecords.replace({ a: { from: [1, 2], to: 0 } }));
expectType<Dataset>(fromRecords.replace({ a: { match: (value) => value === 1, to: 0 } }));
expectType<Dataset>(fromRecords.replace({ a: (value) => value }));
expectType<Dataset>(fromRecords.map("a", (value) => value));
expectType<Dataset>(fromRecords.addColumn("b", (row) => row.a));
expectType<Dataset>(fromRecords.addColumn("b", [1]));
expectType<Dataset>(fromRecords.cast({ a: "number" }));
expectType<Dataset>(fromRecords.cast({ a: { type: "date" } }));
expectType<Dataset>(fromRecords.dropDuplicates());
expectType<Dataset>(fromRecords.dropDuplicates(["a"]));
expectType<Dataset>(fromRecords.dropDuplicates("a"));
expectType<Dataset>(fromRecords.sample(1));
expectType<Dataset>(fromRecords.sample(1, { seed: 1, replace: true }));

// The documented option shapes are exported.
expectType<DropMissingOptions>({ columns: ["a"], how: "any" });
expectType<FillStrategy>("median");
expectType<ReplaceRule>({ from: 1, to: 2 });
expectType<SampleOptions>({ seed: 42 });

// Preparation methods compose with the existing transformations.
expectType<Dataset>(
  fromRecords
    .drop(["a"])
    .rename({ a: "b" })
    .fillMissing({ a: 0 })
    .dropDuplicates(["a"])
    .addColumn("c", (row) => row.a)
    .sort("c", "desc")
    .select(["a"])
    .limit(1),
);

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

// ------------------------------------------------------------------ v0.2.0 contract

// The sample helper is async and resolves to a Dataset.
expectType<Promise<Dataset>>(useSampleDataset());
expectType<Promise<Dataset>>(Numiq.useSampleDataset());

// Every transformation returns a Dataset, so chains stay type-safe.
expectType<Dataset>(fromRecords.filter((row) => Number(row.a) > 0));
expectType<Dataset>(fromRecords.sort("a"));
expectType<Dataset>(fromRecords.sort("a", "desc"));
expectType<Dataset>(fromRecords.select(["a"]));
expectType<Dataset>(fromRecords.limit(1));
expectType<Dataset>(
  fromRecords
    .filter((row) => row.a !== null)
    .sort("a")
    .select(["a"])
    .limit(1),
);

// The predicate receives the row and its index.
fromRecords.filter((row, index) => {
  expectType<Row>(row);
  expectType<number>(index);
  return true;
});

// sort accepts only the two documented directions.
const direction: SortDirection = "desc";
expectType<SortDirection>(direction);

// datasetDir is a typed option on every loader.
loadCSV("sales.csv", { datasetDir: "/tmp/project" });

// @ts-expect-error sort direction is a closed union
fromRecords.sort("a", "ascending");
// @ts-expect-error select takes column names, not a bare string
fromRecords.select("a");
// @ts-expect-error limit takes a number
fromRecords.limit("1");
// @ts-expect-error filter requires a predicate
fromRecords.filter("a");
// @ts-expect-error datasetDir must be a string
loadCSV("sales.csv", { datasetDir: 42 });

// ---------------------------------------------------------------- query engine

const queryable = createDataset([{ a: 1, b: "x" }]);

// execute() returns the same dataset type the builder was created from.
expectType<Dataset>(queryable.query().execute());
expectType<Dataset>(queryable.query().where("a", ">", 1).execute());

// Every builder step returns a Query, so chains keep their type.
expectType<Query<Dataset>>(queryable.query().where("a", "=", 1));
expectType<Query<Dataset>>(queryable.query().where("a", "=", 1).and("b", "=", "x"));
expectType<Query<Dataset>>(queryable.query().where("a", "=", 1).or("b", "=", "x"));
expectType<Query<Dataset>>(queryable.query().orderBy("a", "desc").limit(2).select(["a"]));

// Operators are a closed set of string literals.
const operator: QueryOperator = "between";
expectType<QueryOperator>(operator);
const comparison: ComparisonOperator = ">=";
expectType<ComparisonOperator>(comparison);
const direction2: QueryDirection = "asc";
expectType<QueryDirection>(direction2);

// Null operators take no value.
queryable.query().where("a", "isNull");
queryable.query().where("a", "isNotNull");

// Set operators take an array, including a readonly one.
queryable.query().where("b", "in", ["x", "y"]);
queryable.query().where("b", "notIn", ["x"] as const);

// between takes a two-element pair.
queryable.query().where("a", "between", [1, 2]);

// ignoreCase is a typed option on value operators.
queryable.query().where("b", "contains", "x", { ignoreCase: true });

// Groups receive a Query and must return one.
queryable.query().andGroup((group) => group.where("a", "=", 1).or("b", "=", "x"));
queryable.query().orGroup((group) => group.where("a", "=", 1));

// @ts-expect-error unknown operators are rejected at compile time
queryable.query().where("a", "~", 1);
// @ts-expect-error sort directions are a closed union
queryable.query().orderBy("a", "ascending");
// @ts-expect-error limit takes a number
queryable.query().limit("2");
// @ts-expect-error select takes column names, not a bare string
queryable.query().select("a");
// @ts-expect-error isNull takes no value
queryable.query().where("a", "isNull", 1);
// @ts-expect-error ignoreCase must be a boolean
queryable.query().where("b", "=", "x", { ignoreCase: "yes" });
