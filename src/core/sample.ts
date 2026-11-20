import { SAMPLE_SALES_CSV } from "../data/sample-sales.js";
import { parseDelimited } from "../io/parsers/csv.js";
import type { Dataset } from "./dataset.js";

/** Name reported by the sample dataset's import report and dataset name. */
export const SAMPLE_DATASET_NAME = "sample-sales";

/**
 * Load the bundled sample sales dataset: 7 columns, 50 rows.
 *
 * The CSV is embedded in the bundle rather than read from disk, so this works in Node,
 * CommonJS, and browser builds alike, and never touches the consumer's `dataset/` folder.
 * Content is fixed, so repeated calls return identical data.
 */
export async function useSampleDataset(): Promise<Dataset> {
  return parseDelimited(SAMPLE_SALES_CSV, {
    format: "csv",
    source: SAMPLE_DATASET_NAME,
    name: SAMPLE_DATASET_NAME,
  });
}
