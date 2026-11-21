import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";

/**
 * A deterministic two-store daily series: 6 days per store, one gap for the south store,
 * and an even value in the north store so ties are exercised.
 */
const orders = () => [
  { store: "north", at: "2026-11-01T09:00:00Z", units: 4 },
  { store: "north", at: "2026-11-02T09:00:00Z", units: 4 },
  { store: "north", at: "2026-11-03T09:00:00Z", units: 6 },
  { store: "north", at: "2026-11-04T09:00:00Z", units: 8 },
  { store: "south", at: "2026-11-01T10:00:00Z", units: 10 },
  { store: "south", at: "2026-11-03T10:00:00Z", units: 20 },
  { store: "south", at: "2026-11-04T10:00:00Z", units: 30 },
];

describe("v0.10.0 window and time-series integration", () => {
  it("computes a per-store running total in time order", () => {
    const result = createDataset(orders()).cumSum("running", "units", { partitionBy: "store", orderBy: "at" });
    expect(result.column("running").values).toEqual([4, 8, 14, 22, 10, 30, 60]);
  });

  it("chains sort, rank and rolling mean", () => {
    const result = createDataset(orders())
      .sortByTime("at")
      .rank("rank", { partitionBy: "store", orderBy: { column: "units", direction: "desc" } })
      .rollingMean("avg2", "units", { partitionBy: "store", orderBy: "at", window: 2 });

    // sortByTime puts north/south side by side by timestamp; windows still stay per store
    expect(result.column("rank").values).toEqual([3, 3, 3, 2, 2, 1, 1]);
    expect(result.column("avg2").values).toEqual([null, null, 4, 5, 15, 7, 25]);
  });

  it("differences a series with lag and checks the total reconciles", () => {
    const data = createDataset(orders()).sortByTime("at");
    const withDelta = data.lag("prev", "units", { partitionBy: "store", orderBy: "at" });
    const deltas = withDelta.column("prev").values;
    expect(deltas).toEqual([null, null, 4, 4, 10, 6, 20]);
  });

  it("resamples to daily totals and keeps stores separate after grouping", () => {
    const result = createDataset(orders()).resample({ every: "day", timeColumn: "at", aggregate: { units: "sum" } });
    expect(result.data).toEqual([
      { period: "2026-11-01", units: 14 },
      { period: "2026-11-02", units: 4 },
      { period: "2026-11-03", units: 26 },
      { period: "2026-11-04", units: 38 },
    ]);
  });

  it("extracts a period then groups on it", () => {
    const data = createDataset(orders())
      .extractPeriod("week", "at", "week")
      .groupBy("week")
      .aggregate({ units_sum: { column: "units", op: "sum" } });

    const rows = data.data as Record<string, unknown>[];
    // 2026-11-01 is a Sunday, so it belongs to the week that began Monday 2026-10-26;
    // the remaining orders fall in the week beginning 2026-11-02
    expect(rows.map((row) => row.week)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(rows.map((row) => row.units_sum)).toEqual([14, 68]);
  });

  it("keeps the original dataset unchanged through a pipeline", () => {
    const data = createDataset(orders());
    const before = data.data;
    data
      .sortByTime("at")
      .cumSum("c", "units", { partitionBy: "store", orderBy: "at" })
      .rollingMean("r", "units", { partitionBy: "store", orderBy: "at", window: 3 })
      .resample({ every: "day", timeColumn: "at", aggregate: { units: "mean" } });
    expect(data.data).toEqual(before);
  });

  it("handles an empty dataset without inventing rows", () => {
    const empty = createDataset([], { columns: ["store", "at", "units"] });
    expect(empty.rowNumber("n", { orderBy: "at" }).rowCount).toBe(0);
    expect(empty.resample({ every: "day", timeColumn: "at", aggregate: { units: "sum" } }).rowCount).toBe(0);
  });

  it("works with a single-row dataset", () => {
    const one = createDataset([{ at: "2026-11-01T00:00:00Z", v: 5 }]);
    expect(one.rollingSum("r", "v", { orderBy: "at", window: 3 }).column("r").values).toEqual([null]);
    expect(one.rollingSum("r", "v", { orderBy: "at", window: 3, minPeriods: 1 }).column("r").values).toEqual([5]);
    expect(one.lag("p", "v", { orderBy: "at" }).column("p").values).toEqual([null]);
  });

  it("orders Date instances as well as ISO strings", () => {
    const data = createDataset([
      { at: new Date("2026-11-03T00:00:00Z"), v: 3 },
      { at: new Date("2026-11-01T00:00:00Z"), v: 1 },
    ]);
    expect(data.sortByTime("at").column("v").values).toEqual([1, 3]);
    expect(data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum" } }).column("period").values).toEqual([
      "2026-11-01",
      "2026-11-03",
    ]);
  });

  it("treats a Date and its ISO string as the same bucket", () => {
    const data = createDataset([
      { at: new Date("2026-11-01T00:00:00Z"), v: 1 },
      { at: "2026-11-01T12:00:00Z", v: 2 },
    ]);
    expect(data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum" } }).data).toEqual([
      { period: "2026-11-01", v: 3 },
    ]);
  });
});
