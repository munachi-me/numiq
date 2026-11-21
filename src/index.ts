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
export type {
  DropMissingOptions,
  FillStrategy,
  FillValue,
  ReplaceContext,
  ReplaceRule,
  SampleOptions,
} from "./core/prepare.js";
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
