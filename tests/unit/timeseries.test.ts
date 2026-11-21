import { describe, it, expect } from "vitest";
import { createDataset } from "../../src/core/dataset.js";
import { periodLabel, periodStart, toTime } from "../../src/core/timeseries.js";
import { ColumnNotFoundError } from "../../src/errors/index.js";

const utc = (iso: string) => new Date(iso);

describe("toTime", () => {
  it("accepts a Date", () => {
    expect(toTime(utc("2026-11-16T10:00:00Z"), "test")?.toISOString()).toBe("2026-11-16T10:00:00.000Z");
  });

  it("accepts an ISO date as UTC midnight", () => {
    expect(toTime("2026-11-16", "test")?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("accepts an ISO date-time with a zone", () => {
    expect(toTime("2026-11-16T10:00:00+02:00", "test")?.toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });

  it("returns null for missing values", () => {
    expect(toTime(null, "test")).toBeNull();
    expect(toTime(undefined, "test")).toBeNull();
  });

  it("rejects a value that is present but not a date", () => {
    expect(() => toTime("16/11/2026", "test")).toThrow(/not an ISO date/);
    expect(() => toTime(20261116, "test")).toThrow(/expected a Date or an ISO date string/);
  });

  it("rejects an invalid Date", () => {
    expect(() => toTime(new Date("nope"), "test")).toThrow(/invalid Date/);
  });
});

describe("periodStart", () => {
  it("truncates to the start of each interval in UTC", () => {
    const at = utc("2026-11-18T14:37:12Z");
    expect(periodStart(at, "hour").toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(periodStart(at, "day").toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(periodStart(at, "month").toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(periodStart(at, "quarter").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(periodStart(at, "year").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("starts weeks on Monday", () => {
    // 2026-11-18 is a Wednesday, so the week begins Monday 2026-11-16
    expect(periodStart(utc("2026-11-18T14:37:12Z"), "week").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    // a Sunday belongs to the week that began six days earlier
    expect(periodStart(utc("2026-11-22T23:00:00Z"), "week").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    // the following Monday starts a new week
    expect(periodStart(utc("2026-11-23T00:00:00Z"), "week").toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("does not depend on the host timezone", () => {
    // a UTC instant near midnight must stay on its UTC day regardless of local offset
    const at = utc("2026-11-18T00:30:00Z");
    expect(periodStart(at, "day").toISOString()).toBe("2026-11-18T00:00:00.000Z");
    const late = utc("2026-11-18T23:30:00Z");
    expect(periodStart(late, "day").toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  it("is unaffected by a daylight-saving transition", () => {
    // 2026-03-29 is the European DST switch; UTC bucketing must not shift the day
    expect(periodStart(utc("2026-03-29T01:30:00Z"), "day").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(periodStart(utc("2026-03-29T00:30:00Z"), "hour").toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
});

describe("periodLabel", () => {
  it("labels each interval distinctly", () => {
    const at = utc("2026-11-18T14:00:00Z");
    expect(periodLabel(at, "year")).toBe("2026");
    expect(periodLabel(at, "quarter")).toBe("2026-Q4");
    expect(periodLabel(at, "month")).toBe("2026-11");
    expect(periodLabel(at, "day")).toBe("2026-11-18");
    expect(periodLabel(at, "hour")).toBe("2026-11-18T14:00");
  });

  it("pads month, day and hour", () => {
    const at = utc("2026-01-05T03:00:00Z");
    expect(periodLabel(at, "month")).toBe("2026-01");
    expect(periodLabel(at, "day")).toBe("2026-01-05");
    expect(periodLabel(at, "hour")).toBe("2026-01-05T03:00");
  });
});

describe("sortByTime", () => {
  const events = () => [
    { at: "2026-11-18T10:00:00Z", id: "c" },
    { at: "2026-11-16T09:00:00Z", id: "a" },
    { at: "2026-11-17T12:00:00Z", id: "b" },
  ];

  it("sorts oldest first by default", () => {
    expect(createDataset(events()).sortByTime("at").column("id").values).toEqual(["a", "b", "c"]);
  });

  it("sorts newest first when asked", () => {
    expect(createDataset(events()).sortByTime("at", { direction: "desc" }).column("id").values).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("keeps missing times last in both directions", () => {
    const data = createDataset([
      { at: null, id: "x" },
      { at: "2026-11-16T09:00:00Z", id: "a" },
    ]);
    expect(data.sortByTime("at").column("id").values).toEqual(["a", "x"]);
    expect(data.sortByTime("at", { direction: "desc" }).column("id").values).toEqual(["a", "x"]);
  });

  it("is stable for equal times", () => {
    const data = createDataset([
      { at: "2026-11-16T09:00:00Z", id: "first" },
      { at: "2026-11-16T09:00:00Z", id: "second" },
    ]);
    expect(data.sortByTime("at").column("id").values).toEqual(["first", "second"]);
  });

  it("rejects an unparseable time rather than skipping the row", () => {
    const data = createDataset([{ at: "not a date" }]);
    expect(() => data.sortByTime("at")).toThrow(/not an ISO date/);
  });

  it("rejects an unknown column", () => {
    expect(() => createDataset([{ at: "2026-11-16" }]).sortByTime("nope")).toThrow(ColumnNotFoundError);
  });

  it("rejects an invalid direction", () => {
    const data = createDataset([{ at: "2026-11-16" }]);
    expect(() => data.sortByTime("at", { direction: "up" as never })).toThrow(/direction must be/);
  });
});

describe("extractPeriod", () => {
  const events = () => [
    { at: "2026-11-18T10:00:00Z", amount: 1 },
    { at: "2026-10-02T10:00:00Z", amount: 2 },
    { at: null, amount: 3 },
  ];

  it("labels each row with its bucket", () => {
    expect(createDataset(events()).extractPeriod("month", "at", "month").column("month").values).toEqual([
      "2026-11",
      "2026-10",
      null,
    ]);
  });

  it("leaves a missing time as null rather than inventing a bucket", () => {
    const result = createDataset(events()).extractPeriod("q", "at", "quarter");
    expect(result.column("q").values).toEqual(["2026-Q4", "2026-Q4", null]);
  });

  it("rejects an unknown interval", () => {
    const data = createDataset(events());
    expect(() => data.extractPeriod("p", "at", "fortnight" as never)).toThrow(/interval must be one of/);
  });

  it("rejects a column that already exists", () => {
    const data = createDataset(events());
    expect(() => data.extractPeriod("amount", "at", "month")).toThrow(/already exists/);
  });
});

describe("resample", () => {
  const ticks = () => [
    { at: "2026-11-16T14:10:00Z", amount: 5 },
    { at: "2026-11-16T14:50:00Z", amount: 7 },
    { at: "2026-11-16T15:05:00Z", amount: 11 },
    { at: "2026-11-17T09:00:00Z", amount: 13 },
  ];

  it("groups into hourly buckets", () => {
    const result = createDataset(ticks()).resample({ every: "hour", timeColumn: "at", aggregate: { amount: "sum" } });
    expect(result.data).toEqual([
      { period: "2026-11-16T14:00", amount: 12 },
      { period: "2026-11-16T15:00", amount: 11 },
      { period: "2026-11-17T09:00", amount: 13 },
    ]);
  });

  it("groups into daily buckets", () => {
    const result = createDataset(ticks()).resample({ every: "day", timeColumn: "at", aggregate: { amount: "sum" } });
    expect(result.data).toEqual([
      { period: "2026-11-16", amount: 23 },
      { period: "2026-11-17", amount: 13 },
    ]);
  });

  it("supports every documented aggregation", () => {
    const data = createDataset([
      { at: "2026-11-16T01:00:00Z", v: 1 },
      { at: "2026-11-16T02:00:00Z", v: 3 },
      { at: "2026-11-16T03:00:00Z", v: 8 },
    ]);
    const one = (aggregation: string) =>
      createDataset(data.data).resample({ every: "day", timeColumn: "at", aggregate: { v: aggregation as never } })
        .data[0]?.v;
    expect(one("sum")).toBe(12);
    expect(one("mean")).toBe(4);
    expect(one("median")).toBe(3);
    expect(one("min")).toBe(1);
    expect(one("max")).toBe(8);
    expect(one("count")).toBe(3);
    expect(one("first")).toBe(1);
    expect(one("last")).toBe(8);
  });

  it("orders buckets ascending regardless of input order", () => {
    const data = createDataset([
      { at: "2026-11-17T00:00:00Z", v: 2 },
      { at: "2026-11-16T00:00:00Z", v: 1 },
    ]);
    expect(data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum" } }).column("period").values).toEqual([
      "2026-11-16",
      "2026-11-17",
    ]);
  });

  it("emits no row for an empty bucket", () => {
    const data = createDataset([
      { at: "2026-11-16T00:00:00Z", v: 1 },
      { at: "2026-11-19T00:00:00Z", v: 2 },
    ]);
    const result = data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum" } });
    expect(result.rowCount).toBe(2);
  });

  it("aggregates several columns at once", () => {
    const data = createDataset([
      { at: "2026-11-16T01:00:00Z", v: 1, n: "a" },
      { at: "2026-11-16T02:00:00Z", v: 3, n: "b" },
    ]);
    const result = data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum", n: "count" } });
    expect(result.data).toEqual([{ period: "2026-11-16", v: 4, n: 2 }]);
  });

  it("drops missing times by default and reports how many", () => {
    const data = createDataset([...ticks(), { at: null, amount: 99 }]);
    const { dataset, bucketed, dropped } = data.resampleReport({
      every: "day",
      timeColumn: "at",
      aggregate: { amount: "sum" },
    });
    expect(dropped).toBe(1);
    expect(bucketed).toBe(4);
    expect(dataset.column("amount").values).toEqual([23, 13]);
  });

  it("can reject missing times instead", () => {
    const data = createDataset([{ at: null, amount: 1 }]);
    expect(() =>
      data.resample({ every: "day", timeColumn: "at", aggregate: { amount: "sum" }, onMissingTime: "error" }),
    ).toThrow(/missing value/);
  });

  it("always rejects an invalid time, even when dropping missing", () => {
    const data = createDataset([{ at: "yesterday", amount: 1 }]);
    expect(() => data.resample({ every: "day", timeColumn: "at", aggregate: { amount: "sum" } })).toThrow(
      /not an ISO date/,
    );
  });

  it("requires an interval", () => {
    const data = createDataset(ticks());
    expect(() => data.resample({ timeColumn: "at", aggregate: { amount: "sum" } } as never)).toThrow(
      /interval must be/,
    );
  });

  it("requires at least one aggregate column", () => {
    const data = createDataset(ticks());
    expect(() => data.resample({ every: "day", timeColumn: "at", aggregate: {} })).toThrow(/at least one aggregate/);
  });

  it("rejects an unsupported aggregation", () => {
    const data = createDataset(ticks());
    expect(() => data.resample({ every: "day", timeColumn: "at", aggregate: { amount: "mode" as never } })).toThrow(
      /unsupported aggregation/,
    );
  });

  it("rejects aggregating an unknown column", () => {
    const data = createDataset(ticks());
    expect(() => data.resample({ every: "day", timeColumn: "at", aggregate: { nope: "sum" } })).toThrow(
      ColumnNotFoundError,
    );
  });

  it("accepts a custom label", () => {
    const result = createDataset(ticks()).resample({
      every: "day",
      timeColumn: "at",
      aggregate: { amount: "sum" },
      label: "day",
    });
    expect(result.columns).toEqual(["day", "amount"]);
  });

  it("refuses to overwrite the time column with the label", () => {
    const data = createDataset(ticks());
    expect(() => data.resample({ every: "day", timeColumn: "at", aggregate: { amount: "sum" }, label: "at" })).toThrow(
      /cannot replace the time column/,
    );
  });

  it("accepts ISO date strings without a time component", () => {
    const data = createDataset([
      { at: "2026-11-16", v: 1 },
      { at: "2026-11-16", v: 2 },
    ]);
    expect(data.resample({ every: "day", timeColumn: "at", aggregate: { v: "sum" } }).data).toEqual([
      { period: "2026-11-16", v: 3 },
    ]);
  });
});

describe("periodBuckets", () => {
  it("lists distinct buckets ascending", () => {
    const data = createDataset([
      { at: "2026-11-18T00:00:00Z" },
      { at: "2026-10-02T00:00:00Z" },
      { at: "2026-11-19T00:00:00Z" },
    ]);
    expect(data.periodBuckets("at", "month")).toEqual(["2026-10", "2026-11"]);
  });
});
