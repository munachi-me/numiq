/**
 * Numiq default entry point.
 *
 * This module must stay free of Node.js built-ins so it can be bundled for browsers.
 * Filesystem loading lives in `node.ts`, which installs a reader into the loader module.
 */
export { Dataset, createDataset } from "./core/dataset.js";
export type { SortDirection } from "./core/dataset.js";
export { Query } from "./core/query.js";
export { GroupedDataset } from "./core/group.js";
export type { GroupSource } from "./core/group.js";
export { sum, mean, median, variance, std, min, max, first, last, nunique } from "./core/aggregate.js";
export { DatasetDescription, profileColumn, columnKind, validateDescribeOptions } from "./analytics/describe.js";
export type { ColumnKind, ColumnProfile, DescribeOptions, DescriptionBuilder } from "./analytics/describe.js";
export { quantile, percentile, quartiles, iqr, mode, range, extremes } from "./analytics/stats.js";
export type { Quartiles, Extremes } from "./analytics/stats.js";
export {
  correlationMatrix,
  covariance,
  detectOutliers,
  fiveNumberSummary,
  kurtosis,
  normalize,
  pearsonCorrelation,
  percentileRank,
  skewness,
  spearmanCorrelation,
  standardize,
  zScores,
} from "./analytics/advanced.js";
export type {
  AdvancedOptions,
  CorrelationCell,
  CorrelationInput,
  CorrelationMatrix,
  CorrelationResult,
  FiveNumberSummary,
  NormalizationMethod,
  NormalizeOptions,
  Outlier,
  OutlierMethod,
  OutlierOptions,
  OutlierResult,
  ZScoreResult,
} from "./analytics/advanced.js";
export type {
  AggregateSpec,
  AggregationContext,
  AggregationEntry,
  AggregationFn,
  GroupAggregationFn,
  AggregationOp,
  AggregationSpec,
  CustomAggregation,
  DispersionOptions,
} from "./core/aggregate.js";
export type {
  CellShape,
  ComparisonOperator,
  NullOperator,
  QueryDirection,
  QueryOperator,
  QuerySource,
  RangeOperator,
  SetOperator,
  StringOperator,
  WhereOptions,
} from "./core/query.js";
export { addConditionalColumn } from "./core/conditional.js";
export { joinTables } from "./core/join.js";
export type { JoinHow, JoinOptions, JoinReport, JoinResult } from "./core/join.js";
export { concatRows, meltRows, pivotRows } from "./core/reshape.js";
export type { ConcatOptions, MeltOptions, PivotAggregation, PivotOptions, PivotResult } from "./core/reshape.js";
export {
  cumMean,
  cumSum,
  denseRank,
  lag,
  lead,
  rank,
  rankRows,
  rollingMax,
  rollingMean,
  rollingMin,
  rollingStd,
  rollingSum,
  rowNumber,
  windowColumn,
} from "./core/window.js";
export type {
  CumulativeOptions,
  OffsetOptions,
  RankedRow,
  RollingOptions,
  WindowColumnOptions,
  WindowDirection,
  WindowFn,
  WindowOptions,
  WindowOrderKey,
  WindowRowContext,
} from "./core/window.js";
export {
  extractPeriod,
  periodBuckets,
  periodLabel,
  periodStart,
  resample,
  sortByTime,
  toTime,
} from "./core/timeseries.js";
export type {
  ResampleAggregation,
  ResampleOptions,
  ResampleResult,
  SortByTimeOptions,
  TimeInterval,
} from "./core/timeseries.js";
export { inferSchema, validateRows } from "./core/validation.js";
export type {
  ColumnRules,
  ValidateOptions,
  ValidationIssue,
  ValidationReport,
  ValidationSchema,
} from "./core/validation.js";
export { Pipeline, PipelineError, pipeline } from "./core/pipeline.js";
export type {
  LineageEntry,
  LoadStep,
  PipelineDescription,
  PipelineOptions,
  PipelineResult,
  RunOptions,
  StepContext,
  StepKind,
  StepReport,
  StepTiming,
  TapStep,
  TransformStep,
  ValidateStep,
} from "./core/pipeline.js";
export type {
  ConditionalColumnOptions,
  ConditionalColumnReport,
  ConditionalColumnResult,
  ConditionalRule,
  ConditionalRuleContext,
  ConditionalThen,
} from "./core/conditional.js";
export type {
  DropMissingOptions,
  FillStrategy,
  FillValue,
  ReplaceContext,
  ReplaceRule,
  SampleOptions,
} from "./core/prepare.js";
export { Metric, createMetric, isAggregationOp } from "./metrics/metric.js";
export type {
  GroupedMetricResult,
  MetricCompareOptions,
  MetricComparison,
  MetricComparisonReason,
  MetricContext,
  MetricFormat,
  MetricGroupValue,
  MetricMetadata,
  MetricReason,
  MetricResult,
  MetricSpec,
} from "./metrics/metric.js";
export { analyze, resolveInsightOptions } from "./insights/insights.js";
export type {
  Insight,
  InsightEvidence,
  InsightInput,
  InsightKind,
  InsightOptions,
  InsightReport,
  InsightSeverity,
  ResolvedInsightOptions,
  SkippedInsight,
} from "./insights/insights.js";
export { useSampleDataset } from "./core/sample.js";
export { renderTable } from "./display/table.js";
export { loadCSV, loadJSON, loadTSV, loadURL } from "./io/loaders/loaders.js";
export { parseDelimited } from "./io/parsers/csv.js";
export { parseJSON } from "./io/parsers/json.js";
export { detectDelimiter, tokenize } from "./io/parsers/csv-tokenizer.js";
export { DEFAULT_NORMALIZATION, resolveNormalization } from "./io/normalization/policy.js";
export { normalizeCell } from "./io/normalization/values.js";

export {
  NumiqError,
  ValidationError,
  ImportError,
  FormatError,
  EnvironmentError,
  ColumnNotFoundError,
} from "./errors/index.js";

export type {
  ColumnSchema,
  ColumnType,
  ColumnTypeSpec,
  ColumnView,
  DatasetInfo,
  DatasetOptions,
  DType,
  ImportReport,
  ImportWarning,
  NormalizationPolicy,
  Row,
  TableOptions,
} from "./core/types.js";
export type { CsvOptions, FormatOptions, ImportFormat, JsonOptions, LoadOptions, Source } from "./io/types.js";
export type { NumiqErrorCode } from "./errors/index.js";
export type { ColumnCast } from "./io/normalization/schema.js";
export type { NormalizedCell } from "./io/normalization/values.js";
export type { ResolvedSource } from "./io/loaders/source.js";

import { Dataset, createDataset } from "./core/dataset.js";
import { Query } from "./core/query.js";
import { GroupedDataset } from "./core/group.js";
import { first, last, max, mean, median, min, nunique, std, sum, variance } from "./core/aggregate.js";
import { DatasetDescription, columnKind, profileColumn, validateDescribeOptions } from "./analytics/describe.js";
import { extremes, iqr, mode, percentile, quantile, quartiles, range } from "./analytics/stats.js";
import {
  correlationMatrix,
  covariance,
  detectOutliers,
  fiveNumberSummary,
  kurtosis,
  normalize,
  pearsonCorrelation,
  percentileRank,
  skewness,
  spearmanCorrelation,
  standardize,
  zScores,
} from "./analytics/advanced.js";
import { addConditionalColumn } from "./core/conditional.js";
import { joinTables } from "./core/join.js";
import { concatRows, meltRows, pivotRows } from "./core/reshape.js";
import {
  cumMean,
  cumSum,
  denseRank,
  lag,
  lead,
  rank,
  rankRows,
  rollingMax,
  rollingMean,
  rollingMin,
  rollingStd,
  rollingSum,
  rowNumber,
  windowColumn,
} from "./core/window.js";
import {
  extractPeriod,
  periodBuckets,
  periodLabel,
  periodStart,
  resample,
  sortByTime,
  toTime,
} from "./core/timeseries.js";
import { inferSchema, validateRows } from "./core/validation.js";
import { Pipeline, PipelineError, pipeline } from "./core/pipeline.js";
import { Metric, createMetric, isAggregationOp } from "./metrics/metric.js";
import { analyze, resolveInsightOptions } from "./insights/insights.js";
import { useSampleDataset } from "./core/sample.js";
import { renderTable } from "./display/table.js";
import { loadCSV, loadJSON, loadTSV, loadURL } from "./io/loaders/loaders.js";
import { parseDelimited } from "./io/parsers/csv.js";
import { parseJSON } from "./io/parsers/json.js";
import { detectDelimiter, tokenize } from "./io/parsers/csv-tokenizer.js";
import { DEFAULT_NORMALIZATION, resolveNormalization } from "./io/normalization/policy.js";
import { normalizeCell } from "./io/normalization/values.js";
import {
  NumiqError,
  ValidationError,
  ImportError,
  FormatError,
  EnvironmentError,
  ColumnNotFoundError,
} from "./errors/index.js";

/**
 * Default namespace export.
 *
 * Every member is the same object as its named export, so `Numiq.createDataset` and
 * `createDataset` can never diverge. A test asserts the two stay identical.
 */
const Numiq = {
  Dataset,
  Query,
  GroupedDataset,
  createDataset,
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
  DatasetDescription,
  profileColumn,
  columnKind,
  validateDescribeOptions,
  quantile,
  percentile,
  quartiles,
  iqr,
  mode,
  range,
  extremes,
  correlationMatrix,
  covariance,
  detectOutliers,
  fiveNumberSummary,
  kurtosis,
  normalize,
  pearsonCorrelation,
  percentileRank,
  skewness,
  spearmanCorrelation,
  standardize,
  zScores,
  addConditionalColumn,
  joinTables,
  pivotRows,
  meltRows,
  concatRows,
  windowColumn,
  rowNumber,
  rank,
  denseRank,
  rankRows,
  lag,
  lead,
  cumSum,
  cumMean,
  rollingSum,
  rollingMean,
  rollingMin,
  rollingMax,
  rollingStd,
  sortByTime,
  extractPeriod,
  resample,
  periodBuckets,
  periodLabel,
  periodStart,
  toTime,
  validateRows,
  inferSchema,
  pipeline,
  Pipeline,
  PipelineError,
  Metric,
  createMetric,
  isAggregationOp,
  analyze,
  resolveInsightOptions,
  useSampleDataset,
  renderTable,
  loadCSV,
  loadJSON,
  loadTSV,
  loadURL,
  parseDelimited,
  parseJSON,
  detectDelimiter,
  tokenize,
  DEFAULT_NORMALIZATION,
  resolveNormalization,
  normalizeCell,
  NumiqError,
  ValidationError,
  ImportError,
  FormatError,
  EnvironmentError,
  ColumnNotFoundError,
} as const;

export default Numiq;
