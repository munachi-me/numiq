/**
 * Benchmark harness.
 *
 * Timing rules, chosen so results are comparable between runs on the same machine:
 * warm up first (so the JIT has compiled the hot path), take several samples, and report
 * the median. The median ignores the occasional GC pause that would skew a mean.
 *
 * Data is generated from a seeded PRNG, so every run measures the same rows. A benchmark
 * that changes its input between runs cannot show whether a change helped.
 */

export interface Sample {
  /** Median of the sample durations, in milliseconds. */
  median: number;
  /** Fastest sample, a rough floor for the cost. */
  min: number;
  /** 95th percentile, which shows how much GC or scheduling noise creeps in. */
  p95: number;
  samples: number;
}

/** Mulberry32: small, fast, and stable across Node versions. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = ["north", "south", "east", "west"] as const;
const CHANNELS = ["web", "store", "partner", "phone"] as const;

import type { Row } from "../../src/core/types.js";

/**
 * Build `count` sales-shaped rows.
 *
 * The mix is deliberate: two low-cardinality strings (good grouping keys), integers,
 * floats, and an ISO date string (so type inference has real work to do).
 */
export function makeSalesRows(count: number, seed = 42): Row[] {
  const random = seededRandom(seed);
  const rows: Row[] = new Array(count);
  const base = Date.UTC(2024, 0, 1);
  for (let index = 0; index < count; index += 1) {
    const units = 1 + Math.floor(random() * 20);
    const revenue = Math.round(random() * 100_000) / 100;
    const cost = Math.round(revenue * (0.4 + random() * 0.4) * 100) / 100;
    rows[index] = {
      order_id: index + 1,
      region: REGIONS[Math.floor(random() * REGIONS.length)] as string,
      channel: CHANNELS[Math.floor(random() * CHANNELS.length)] as string,
      units,
      revenue,
      cost,
      margin: Math.round((revenue - cost) * 100) / 100,
      sold_at: new Date(base + Math.floor(random() * 365) * 86_400_000).toISOString().slice(0, 10),
    };
  }
  return rows;
}

/**
 * Rows for a star-schema join: a fact table and a dimension keyed by a unique id.
 *
 * The key must be unique on the dimension side. Joining on a low-cardinality column such
 * as `region` is many-to-many and multiplies rows, which measures row explosion rather
 * than probe cost.
 */
export function makeJoinInputs(factRows: number, dimensionRows = 200): { fact: Row[]; dimension: Row[] } {
  const random = seededRandom(7);
  const fact = makeSalesRows(factRows, 7).map((row) => ({ ...row, rep_id: 1 + Math.floor(random() * dimensionRows) }));
  const dimension: Row[] = new Array(dimensionRows);
  for (let index = 0; index < dimensionRows; index += 1) {
    dimension[index] = {
      rep_id: index + 1,
      region: REGIONS[index % REGIONS.length] as string,
      quota: 10_000 + index * 25,
    };
  }
  return { fact, dimension };
}

export interface TimeOptions {
  /** Runs before sampling, so the JIT has seen the code. */
  warmup?: number;
  /** Timed runs. */
  samples?: number;
}

/** Time `run` and return the median, minimum, and 95th percentile. */
export async function time(run: () => unknown | Promise<unknown>, options: TimeOptions = {}): Promise<Sample> {
  const warmup = options.warmup ?? 3;
  const samples = options.samples ?? 9;
  for (let index = 0; index < warmup; index += 1) await run();

  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = process.hrtime.bigint();
    await run();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    durations.push(elapsed);
  }

  durations.sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 0
      ? ((durations[middle - 1] as number) + (durations[middle] as number)) / 2
      : (durations[middle] as number);
  const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
  return { median, min: durations[0] as number, p95: durations[p95Index] as number, samples };
}

/**
 * Keep a value alive.
 *
 * Without this the engine may discard work whose result is unused, which would time
 * nothing at all.
 */
export const sink: { value: unknown } = { value: null };

export function consume(value: unknown): void {
  sink.value = value;
}

export function formatMs(value: number): string {
  if (value < 1) return `${(value * 1000).toFixed(0)}µs`;
  if (value < 1000) return `${value.toFixed(2)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Heap in use, after a collection when the runtime allows one. */
export function heapUsed(): number {
  const maybeGc = (globalThis as { gc?: () => void }).gc;
  maybeGc?.();
  return process.memoryUsage().heapUsed;
}
