/**
 * Compile-time contract for the published types.
 *
 * This file is never executed; `tsc --noEmit` fails the build if a documented shape
 * regresses. It imports from `src` so it exercises the same declarations consumers get.
 */
import Numiq, {
  addConditionalColumn,
  joinTables,
  pivotRows,
  rowNumber,
  rank,
  denseRank,
  lag,
  lead,
  cumSum,
  rollingStd,
  resample,
  sortByTime,
  extractPeriod,
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
  type JoinHow,
  DatasetDescription,
  type ColumnProfile,
  type ColumnKind,
  type DescribeOptions,
  type Quartiles,
  type Extremes,
  type AdvancedOptions,
  type CorrelationResult,
  type CorrelationMatrix,
  type CorrelationCell,
  Metric,
  createMetric,
  isAggregationOp,
  analyze,
  resolveInsightOptions,
  type MetricSpec,
  type MetricResult,
  type MetricFormat,
  type MetricContext,
  type MetricComparison,
  type GroupedMetricResult,
  type Insight,
  type InsightReport,
  type InsightOptions,
  type InsightKind,
  type InsightSeverity,
  type SkippedInsight,
  type ResolvedInsightOptions,
  type FiveNumberSummary,
  type OutlierResult,
  type Outlier,
  type OutlierOptions,
  type OutlierMethod,
  type ZScoreResult,
  type NormalizeOptions,
  type NormalizationMethod,
  covariance,
  pearsonCorrelation,
  spearmanCorrelation,
  correlationMatrix,
  zScores,
  standardize,
  normalize,
  percentileRank,
  skewness,
  kurtosis,
  fiveNumberSummary,
  detectOutliers,
  quantile,
  percentile,
  quartiles,
  iqr,
  mode,
  range,
  extremes,
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
  GroupedDataset,
  sum,
  mean,
  median,
  variance,
  std,
  min,
  max,
  first,
  last,
  nunique,
  type AggregateSpec,
  type AggregationEntry,
  type AggregationFn,
  type GroupAggregationFn,
  type AggregationOp,
  type AggregationContext,
  type DispersionOptions,
  type CustomAggregation,
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

// ---------------------------------------------------------------- grouping (v0.5.0)

// groupBy returns a GroupedDataset whose aggregate() is a Dataset.
const grouped = queryable.groupBy("a");
const aggregated = grouped.aggregate({ n: { op: "count" } });
expectType<Dataset>(aggregated);
expectType<readonly Row[]>(aggregated.data);

// Grouping metadata is typed.
expectType<readonly string[]>(grouped.columns);
expectType<number>(grouped.groupCount);
expectType<readonly number[]>(grouped.sizes);
expectType<readonly Readonly<Record<string, unknown>>[]>(grouped.keys);

// Several columns, as varargs or an array.
queryable.groupBy("a", "b");
queryable.groupBy(["a", "b"] as const);

// Every operation is accepted.
grouped.aggregate({ x: { column: "a", op: "count" } });
grouped.aggregate({ x: { column: "a", op: "sum" } });
grouped.aggregate({ x: { column: "a", op: "mean" } });
grouped.aggregate({ x: { column: "a", op: "min" } });
grouped.aggregate({ x: { column: "a", op: "max" } });
grouped.aggregate({ x: { column: "a", op: "median" } });
grouped.aggregate({ x: { column: "a", op: "first" } });
grouped.aggregate({ x: { column: "a", op: "last" } });
grouped.aggregate({ x: { column: "a", op: "nunique" } });
grouped.aggregate({ x: { column: "a", op: "std" } });
grouped.aggregate({ x: { column: "a", op: "variance" } });

// count may omit its column.
grouped.aggregate({ rows: { op: "count" } });

// Dispersion options are typed.
grouped.aggregate({ x: { column: "a", op: "std", ddof: 0 } });
grouped.aggregate({ x: { column: "a", op: "variance", ddof: 1 } });

// Custom aggregators: a bare callback gets rows, a column-bound one gets values.
grouped.aggregate({ x: (rows) => rows.length });
// A bare callback sees Row objects, so it can read a column without a cast.
grouped.aggregate({ x: (rows) => rows[0]?.a });
expectType<GroupAggregationFn>((rows) => rows[0]?.a);
grouped.aggregate({ x: (rows, context) => `${String(context.column)}:${rows.length}` });
grouped.aggregate({ x: { column: "a", fn: (values) => values.length } });
grouped.aggregate({ x: { column: "a", fn: (_values, context) => context.rows.length } });

// The aggregated result composes with the rest of the API.
aggregated.groupBy("n").aggregate({ total: { op: "count" } });
aggregated.query().where("n", ">", 0).execute();

// toDataset and mapGroups return datasets.
expectType<Dataset>(grouped.toDataset());
expectType<Dataset>(grouped.mapGroups((rows, key) => [{ a: key.a, n: rows.length }]));

// @ts-expect-error operations are a closed union
grouped.aggregate({ x: { column: "a", op: "mode" } });
// @ts-expect-error an aggregation needs an op
grouped.aggregate({ x: { column: "a" } });
// @ts-expect-error ddof must be a number
grouped.aggregate({ x: { column: "a", op: "std", ddof: "0" } });
// @ts-expect-error column must be a string
grouped.aggregate({ x: { column: 1, op: "sum" } });
// @ts-expect-error aggregate takes a spec object, not a bare string
grouped.aggregate("a");
// @ts-expect-error groupBy takes column names
queryable.groupBy(1);
// @ts-expect-error mapGroups must return rows
grouped.mapGroups(() => "nope");

// Standalone aggregation helpers are exported with narrow signatures.
expectType<number>(sum([1, 2, 3]));
expectType<number | null>(mean([1, 2, 3]));
expectType<number | null>(median([1, 2, 3]));
expectType<number | null>(variance([1, 2, 3]));
expectType<number | null>(variance([1, 2, 3], { ddof: 0 }));
expectType<number | null>(std([1, 2, 3]));
expectType<unknown>(min([1, 2, 3]));
expectType<unknown>(max([1, 2, 3]));
expectType<unknown>(first([1, 2, 3]));
expectType<unknown>(last([1, 2, 3]));
expectType<number>(nunique([1, 1, 2]));
// @ts-expect-error sum takes numbers, not strings
sum(["1"]);

// The published grouping types are importable and shaped as documented.
expectType<AggregationOp>("sum");
const entry: AggregationEntry = { column: "a", op: "median" };
const fnEntry: AggregationFn = (values) => values.length;
const custom: CustomAggregation = { column: "a", fn: (values) => values.length };
expectType<DispersionOptions>({ ddof: 0 });
expectType<(context: AggregationContext) => readonly Row[]>((context) => context.rows);
const spec: AggregateSpec = { x: entry, y: fnEntry, z: custom };
grouped.aggregate(spec);
expectType<GroupedDataset<Dataset>>(grouped);
expectType<readonly string[]>(grouped.columns);

// @ts-expect-error AggregationOp is a closed union
expectType<AggregationOp>("mode");

// ---------------------------------------------------------------- describe (v0.6.0)

const described: Dataset = createDataset([{ a: 1 }, { a: 2 }]);

// The overloads are the contract: no argument gives a description, a column gives a profile.
expectType<DatasetDescription<Dataset>>(described.describe());
expectType<DatasetDescription<Dataset>>(described.describe({ ddof: 0 }));
expectType<DatasetDescription<Dataset>>(described.describe({ percentiles: [90] }));
expectType<ColumnProfile>(described.describe("a"));
expectType<ColumnProfile>(described.describe("a", { ddof: 0 }));
expectType<ColumnProfile>(described.describe("a", { percentiles: [90] }));

// A profile exposes every documented statistic with a stable type.
const profile = described.describe("a");
expectType<string>(profile.name);
expectType<DType>(profile.type);
expectType<ColumnKind>(profile.kind);
expectType<number>(profile.count);
expectType<number>(profile.missing);
expectType<number>(profile.total);
expectType<number>(profile.unique);
expectType<number | null>(profile.sum);
expectType<number | null>(profile.mean);
expectType<number | null>(profile.median);
expectType<unknown>(profile.mode);
expectType<unknown>(profile.min);
expectType<unknown>(profile.max);
expectType<number | null>(profile.range);
expectType<number | null>(profile.variance);
expectType<number | null>(profile.std);
expectType<number | null>(profile.q1);
expectType<number | null>(profile.q3);
expectType<number | null>(profile.iqr);
expectType<Readonly<Record<string, number | null>>>(profile.percentiles);
expectType<number>(profile.ddof);

// The description holds profiles and converts back to a Dataset of the same type.
const description = described.describe();
expectType<number>(description.rowCount);
expectType<number>(description.columnCount);
expectType<readonly ColumnProfile[]>(description.profiles);
expectType<readonly string[]>(description.columns);
expectType<ColumnProfile>(description.get("a"));
expectType<string>(description.table());
expectType<Dataset>(description.toDataset());

expectType<DescribeOptions>({ ddof: 0, percentiles: [25, 75] });
expectType<ColumnKind>("numeric");

// Standalone statistics.
expectType<number | null>(quantile([1, 2, 3], 0.5));
expectType<number | null>(percentile([1, 2, 3], 90));
expectType<Quartiles | null>(quartiles([1, 2, 3]));
expectType<number | null>(iqr([1, 2, 3]));
expectType<unknown>(mode([1, 1, 2]));
expectType<number | null>(range([1, 2, 3]));
expectType<Extremes | null>(extremes([1, 2, 3]));

// Advanced statistics.
expectType<number | null>(covariance([1, 2], [3, 4]));
expectType<CorrelationResult>(pearsonCorrelation([1, 2], [3, 4]));
expectType<CorrelationResult>(spearmanCorrelation([1, 2], [3, 4]));
expectType<CorrelationMatrix>(correlationMatrix({ columns: [{ name: "a", values: [1] }] }));
expectType<CorrelationCell>(correlationMatrix({ columns: [{ name: "a", values: [1] }] }).get("a", "a"));
expectType<ZScoreResult>(zScores([1, 2, 3]));
expectType<(number | null)[]>(standardize([1, 2, 3]));
expectType<(number | null)[]>(normalize([1, 2, 3]));
expectType<number | null>(percentileRank([1, 2], 1));
expectType<number | null>(skewness([1, 2, 3]));
expectType<number | null>(kurtosis([1, 2, 3, 4]));
expectType<FiveNumberSummary>(fiveNumberSummary([1, 2, 3]));
expectType<OutlierResult>(detectOutliers([1, 2, 3]));
expectType<Outlier["side"]>("low");
expectType<OutlierMethod>("iqr");
expectType<NormalizationMethod>("minmax");
expectType<AdvancedOptions>({ ddof: 0 });
expectType<OutlierOptions>({ method: "zscore", threshold: 2 });
expectType<NormalizeOptions>({ method: "maxabs" });

// Dataset methods.
expectType<number | null>(described.covariance("a", "a"));
expectType<CorrelationResult>(described.correlation("a", "a"));
expectType<CorrelationResult>(described.rankCorrelation("a", "a"));
expectType<CorrelationMatrix>(described.correlationMatrix());
expectType<ZScoreResult>(described.zScores("a"));
expectType<Dataset>(described.withZScores("a"));
expectType<number | null>(described.skewness("a"));
expectType<number | null>(described.kurtosis("a"));
expectType<FiveNumberSummary>(described.fiveNumberSummary("a"));
expectType<OutlierResult>(described.outliers("a"));
expectType<number | null>(described.percentileRank("a", 1));

// @ts-expect-error a profile is not a Dataset; the distinction is deliberate
void described.describe("a").rowCount;
// @ts-expect-error quantile takes numbers
quantile(["1"], 0.5);
// @ts-expect-error ddof must be a number
described.describe("a", { ddof: "1" });
// @ts-expect-error ColumnKind is a closed union
expectType<ColumnKind>("ordinal");
// @ts-expect-error OutlierMethod is a closed union
expectType<OutlierMethod>("mad");
// @ts-expect-error correlationMatrix needs column objects, not bare arrays
correlationMatrix({ columns: [["a", [1, 2]]] });
// @ts-expect-error the correlation result carries no significance claim
void pearsonCorrelation([1, 2], [3, 4]).pValue;

// ------------------------------------------------------------------ v0.8.0 metrics

expectType<Metric>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }));
expectType<unknown>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).value);
expectType<MetricResult>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).metric);
expectType<MetricFormat>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).format);
expectType<GroupedMetricResult>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).byGroup());
expectType<MetricComparison>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).compare({ to: 1 }));
expectType<Metric>(described.createMetric({ name: "n", column: "a", aggregation: "sum" }).recalculate([]));
expectType<Metric>(createMetric({ name: "n", aggregation: "count" }, [], ["a"]));
const metricSpec: MetricSpec = { name: "n", column: "a", aggregation: "sum" };
expectType<MetricSpec>(metricSpec);
const insightOptions: InsightOptions = { strongCorrelation: 0.8 };
expectType<InsightOptions>(insightOptions);
expectType<boolean>(isAggregationOp("sum"));

// A custom metric callback sees its context, so the parameter types must line up.
described.createMetric({
  name: "n",
  column: "a",
  fn: (values, context) => {
    expectType<readonly unknown[]>(values);
    expectType<MetricContext>(context);
    expectType<string | null>(context.column);
    return values.length;
  },
});
described.createMetric({
  name: "n",
  fn: (rows, context) => {
    expectType<readonly Readonly<Row>[]>(rows);
    expectType<MetricContext>(context);
    return rows.length;
  },
});

// ----------------------------------------------------------------- v0.8.0 insights

expectType<InsightReport>(described.insights());
expectType<InsightReport>(described.insights({ strongCorrelation: 0.8 }));
expectType<ResolvedInsightOptions>(resolveInsightOptions());
expectType<InsightReport>(analyze({ rows: [], columns: [], schema: {} }));
expectType<readonly Insight[]>(described.insights().insights);
expectType<readonly SkippedInsight[]>(described.insights().skipped);
expectType<number>(described.insights().truncated);
expectType<InsightKind>(described.insights().insights[0]!.kind);
expectType<InsightSeverity>(described.insights().insights[0]!.severity);
expectType<readonly string[]>(described.insights().insights[0]!.columns);

// @ts-expect-error an insight kind is a closed union
expectType<InsightKind>("anomaly");
// @ts-expect-error a metric needs exactly one calculation, so aggregation and fn cannot pair
described.createMetric({ name: "n", column: "a", aggregation: "sum", fn: () => 1 });
// @ts-expect-error an unknown aggregation is not assignable
described.createMetric({ name: "n", column: "a", aggregation: "total" });
// @ts-expect-error insight thresholds are numbers
described.insights({ strongCorrelation: "0.8" });
// @ts-expect-error a metric is not a Dataset, so it has no row accessor by that name
void described.createMetric({ name: "n", aggregation: "count" }).rows();
// @ts-expect-error metrics expose no significance claim
void described.createMetric({ name: "n", column: "a", aggregation: "sum" }).pValue;

// v0.9.0: conditional columns, joins, and reshaping.

expectType<Dataset>(described.addConditionalColumn("band", [{ when: () => true, then: "x" }]));
expectType<Dataset>(
  described.addConditionalColumn("band", [{ when: (row) => row.a === 1, then: (row) => row.a }], {
    else: "other",
  }),
);
expectType<readonly number[]>(
  described.addConditionalColumnReport("band", [{ when: () => true, then: 1 }]).report.matched,
);
expectType<number>(described.addConditionalColumnReport("band", [{ when: () => true, then: 1 }]).report.unmatched);
// @ts-expect-error a rule requires a when predicate
described.addConditionalColumn("band", [{ then: "x" }]);
// @ts-expect-error a rule requires a then value; use null for a deliberate empty
described.addConditionalColumn("band", [{ when: () => true }]);
// @ts-expect-error a when predicate returns a boolean, not a string
described.addConditionalColumn("band", [{ when: () => "yes", then: 1 }]);

expectType<Dataset>(described.join(described, { on: "a" }));
expectType<Dataset>(described.join(described, { leftOn: "a", rightOn: "b", how: "full" }));
expectType<JoinHow>("inner");
// @ts-expect-error join strategies are a closed union
described.join(described, { on: "a", how: "cross" });
// @ts-expect-error suffixes are a pair
described.join(described, { on: "a", suffixes: ["_x"] });

expectType<Dataset>(described.pivot({ columns: "a", values: "b" }));
expectType<readonly string[]>(described.pivotReport({ columns: "a", values: "b" }).pivoted);
expectType<Dataset>(described.melt({ idVars: "a" }));
expectType<Dataset>(described.concat(described));
expectType<Dataset>(described.concat([described, described], { columns: "strict" }));
// @ts-expect-error a pivot needs both a column source and a value source
described.pivot({ columns: "a" });

// Window and time-series signatures.
expectType<Dataset>(described.rowNumber("n", { orderBy: "a" }));
expectType<Dataset>(described.rank("r", { partitionBy: ["a"], orderBy: { column: "a", direction: "desc" } }));
expectType<Dataset>(described.denseRank("d", { orderBy: "a" }));
expectType<Dataset>(described.lag("p", "a", { orderBy: "a", offset: 2, fill: 0 }));
expectType<Dataset>(described.lead("n", "a", { orderBy: "a" }));
expectType<Dataset>(described.cumSum("c", "a", { orderBy: "a", ignoreMissing: true }));
expectType<Dataset>(described.rollingMean("r", "a", { orderBy: "a", window: 3, minPeriods: 1 }));
expectType<Dataset>(described.rollingStd("s", "a", { orderBy: "a", window: 3 }));
expectType<Dataset>(described.sortByTime("a", { direction: "desc" }));
expectType<Dataset>(described.extractPeriod("p", "a", "month"));
expectType<Dataset>(described.resample({ every: "day", timeColumn: "a", aggregate: { a: "sum" } }));
expectType<string[]>(described.periodBuckets("a", "year"));
// @ts-expect-error an interval must be one of the documented names
described.extractPeriod("p", "a", "fortnight");
// @ts-expect-error a rolling window is required
described.rollingSum("r", "a", { orderBy: "a" });

// The default namespace must expose the same constructors as the named exports.
expectType<typeof Metric>(Numiq.Metric);
expectType<typeof analyze>(Numiq.analyze);
expectType<typeof joinTables>(Numiq.joinTables);
expectType<typeof pivotRows>(Numiq.pivotRows);
expectType<typeof addConditionalColumn>(Numiq.addConditionalColumn);
expectType<typeof rowNumber>(Numiq.rowNumber);
expectType<typeof rank>(Numiq.rank);
expectType<typeof denseRank>(Numiq.denseRank);
expectType<typeof lag>(Numiq.lag);
expectType<typeof lead>(Numiq.lead);
expectType<typeof cumSum>(Numiq.cumSum);
expectType<typeof rollingStd>(Numiq.rollingStd);
expectType<typeof resample>(Numiq.resample);
expectType<typeof sortByTime>(Numiq.sortByTime);
expectType<typeof extractPeriod>(Numiq.extractPeriod);
