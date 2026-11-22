import type { Row } from "./types.js";
import type { ValidationReport, ValidationSchema } from "./validation.js";
import { validateRows } from "./validation.js";
import { Dataset, createDataset } from "./dataset.js";
import { NumiqError, ValidationError } from "../errors/index.js";
import { cloneValue, isThenable } from "../utils/values.js";

/**
 * How a step's behaviour is described for reproducibility.
 *
 * A step built from a callback cannot be serialised: a function has no portable text form,
 * and inventing one would mean either `eval` (which this package will not do) or a lie.
 * So each step declares what it actually is, and `describe()` reports it honestly.
 */
export type StepKind = "load" | "transform" | "validate" | "tap";

/** Whether a step returned its result synchronously or as a promise. */
export type StepTiming = "sync" | "async";

/** What a step receives when it runs. */
export interface StepContext {
  /** Zero-based position of the step in the pipeline. */
  index: number;
  /** The step's name. */
  name: string;
  /** Number of steps in the pipeline. */
  total: number;
  /** The dataset the step is about to receive. Absent for the load step. */
  input?: Dataset;
}

/** A load step produces the first dataset from nothing. */
export type LoadStep = (context: Omit<StepContext, "input">) => unknown;

/** A transform step receives a dataset and returns a replacement. */
export type TransformStep = (input: Dataset, context: StepContext) => unknown;

/** A validation step receives a dataset and returns the schema to check it against. */
export type ValidateStep = (input: Dataset, context: StepContext) => ValidationSchema;

/** A tap step observes a dataset without replacing it. */
export type TapStep = (input: Dataset, context: StepContext) => unknown;

interface StepRecord {
  kind: StepKind;
  name: string;
  run: (input: Dataset | null, context: StepContext) => unknown;
  /** The schema, when it is data rather than a callback. */
  schema?: ValidationSchema;
  /** True when the step holds a caller-supplied callback, so it cannot be serialised. */
  custom: boolean;
}

/** One entry in the execution report. */
export interface StepReport {
  index: number;
  name: string;
  kind: StepKind;
  /** Whether the step returned a promise. Observed, not assumed. */
  timing: StepTiming;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Row and column counts after the step finished. */
  rows: number;
  columns: number;
  /** Present for validate steps that ran far enough to produce a report. */
  validation?: ValidationReport;
  /** True when the step holds a caller-supplied callback. */
  custom: boolean;
  /** The step's error, when it threw. */
  error?: { name: string; message: string; code?: string };
}

/** A lineage entry: what each step did to the table. */
export interface LineageEntry {
  index: number;
  name: string;
  kind: StepKind;
  /** Columns after the step. */
  columns: readonly string[];
  rows: number;
  /** Columns added by this step, relative to the previous step. */
  addedColumns: readonly string[];
  /** Columns removed by this step. */
  removedColumns: readonly string[];
}

/** Everything a caller learns from one run. */
export interface PipelineResult {
  /** The dataset the pipeline produced. `null` when a step failed. */
  dataset: Dataset | null;
  /** True when every step completed. */
  ok: boolean;
  /** Per-step reports in execution order, including the failing step. */
  steps: readonly StepReport[];
  /** Source-to-result lineage. Stops at the last step that completed. */
  lineage: readonly LineageEntry[];
  /** Name of the step that failed, when one did. */
  failedStep?: string;
  /** Index of the failing step, when one did. */
  failedIndex?: number;
  /** Total wall-clock duration in milliseconds. */
  durationMs: number;
  /** Number of steps attempted, including a failing one. */
  executed: number;
  /** Number of steps defined. */
  total: number;
}

/** A pipeline definition rendered as data, so it can be reviewed or stored. */
export interface PipelineDescription {
  name: string;
  steps: readonly {
    index: number;
    name: string;
    kind: StepKind;
    /** `true` when the step cannot be serialised because it holds a function. */
    custom: boolean;
    /** The schema, when it is data rather than a callback. */
    schema?: ValidationSchema;
  }[];
  /** `true` when every step is pure data and could be rebuilt elsewhere. */
  reproducible: boolean;
  /** Steps whose behaviour depends on something outside the definition. */
  nonDeterministic: readonly string[];
  /** `true` once `build()` has sealed the definition. */
  built: boolean;
}

/** Options for a pipeline. */
export interface PipelineOptions {
  /** Name used in reports and error messages. */
  name?: string;
}

/** Options for `run()`. */
export interface RunOptions {
  /** Throw a `PipelineError` on failure instead of returning `ok: false`. */
  throwOnError?: boolean;
}

/**
 * Thrown when a pipeline step fails.
 *
 * Carries the failing step's name, index, and kind so a caller can point at the step
 * rather than at the pipeline as a whole. The original error is preserved as `cause`.
 */
export class PipelineError extends NumiqError {
  readonly step: string;
  readonly stepIndex: number;
  readonly stepKind: StepKind;
  readonly original: unknown;

  constructor(message: string, details: { step: string; stepIndex: number; stepKind: StepKind; cause?: unknown }) {
    super(message, "PIPELINE_ERROR");
    this.name = "PipelineError";
    this.step = details.step;
    this.stepIndex = details.stepIndex;
    this.stepKind = details.stepKind;
    this.original = details.cause;
    if (details.cause !== undefined) (this as { cause?: unknown }).cause = details.cause;
  }
}

const defaultStepName = (kind: StepKind, index: number): string => `${kind}-${index + 1}`;

/** Columns present in `next` but not in `previous`. */
function addedColumns(previous: readonly string[], next: readonly string[]): string[] {
  const before = new Set(previous);
  return next.filter((column) => !before.has(column));
}

/** Columns present in `previous` but not in `next`. */
function removedColumns(previous: readonly string[], next: readonly string[]): string[] {
  const after = new Set(next);
  return previous.filter((column) => !after.has(column));
}

/** Describe an unexpected value for an error message. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/** Accept a Dataset, an array of rows, or a column-oriented object. */
function toDataset(value: unknown, stepName: string): Dataset {
  if (value instanceof Dataset) return value;
  try {
    return createDataset(value as readonly Row[]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Step "${stepName}" did not produce a usable dataset: ${reason}`);
  }
}

/**
 * A reusable data workflow.
 *
 * A pipeline is a *definition*: building one runs nothing. `run()` executes it. That split
 * is what makes a pipeline reusable and inspectable — the same object can be run many
 * times, described without running it, and passed to another function as data.
 *
 * Steps are synchronous or asynchronous depending on what their callback returns. Both are
 * awaited uniformly, so a caller has one shape to handle and adding an async step later
 * does not change the calling code.
 */
export class Pipeline {
  readonly #steps: StepRecord[] = [];
  readonly #name: string;
  #lastLineage: readonly LineageEntry[] = [];
  #sealed = false;

  constructor(options: PipelineOptions = {}) {
    this.#name = options.name ?? "Pipeline";
  }

  /** The pipeline's name, used in reports and error messages. */
  get name(): string {
    return this.#name;
  }

  /** Number of steps defined. */
  get length(): number {
    return this.#steps.length;
  }

  /** Step names in order, for a quick look at the shape of the pipeline. */
  get stepNames(): readonly string[] {
    return this.#steps.map((step) => step.name);
  }

  /**
   * Lineage from the most recent successful run.
   *
   * Empty until the pipeline has run: lineage describes an execution, and a definition
   * that has not executed has no history to report.
   */
  get lineage(): readonly LineageEntry[] {
    return this.#lastLineage.map((entry) => ({
      ...entry,
      columns: [...entry.columns],
      addedColumns: [...entry.addedColumns],
      removedColumns: [...entry.removedColumns],
    }));
  }

  #resolveName(name: string | undefined, kind: StepKind): string {
    if (name === undefined) return defaultStepName(kind, this.#steps.length);
    if (typeof name !== "string" || name.trim() === "") {
      throw new ValidationError("A step name must be a non-empty string.");
    }
    if (this.#steps.some((step) => step.name === name)) {
      throw new ValidationError(`Duplicate step name: "${name}". Step names must be unique.`);
    }
    return name;
  }

  #assertNotSealed(): void {
    if (this.#sealed) {
      throw new ValidationError(
        "This pipeline is sealed: build() was called, so no further steps may be added. " +
          "Create a new pipeline to change the definition.",
      );
    }
  }

  #assertHasLoad(): void {
    if (this.#steps.length === 0) {
      throw new ValidationError("A pipeline must start with a load step.");
    }
  }

  /**
   * Add the step that produces the first dataset.
   *
   * Only one load step may exist, and it must come first: a transform needs an input, so
   * a pipeline without a load step cannot run.
   */
  load(loader: LoadStep, options: { name?: string } = {}): this {
    this.#assertNotSealed();
    if (this.#steps.length > 0) {
      throw new ValidationError("A load step must be the first step in a pipeline.");
    }
    if (typeof loader !== "function") {
      throw new ValidationError("load expects a function returning a dataset or row array.");
    }
    const name = this.#resolveName(options.name, "load");
    this.#steps.push({
      kind: "load",
      name,
      custom: true,
      run: (_input, context) => loader({ index: context.index, name: context.name, total: context.total }),
    });
    return this;
  }

  /** Add a transformation step. Returns the replacement dataset. */
  transform(transformer: TransformStep, options: { name?: string } = {}): this {
    this.#assertNotSealed();
    if (typeof transformer !== "function") {
      throw new ValidationError("transform expects a function receiving a dataset.");
    }
    this.#assertHasLoad();
    const name = this.#resolveName(options.name, "transform");
    this.#steps.push({
      kind: "transform",
      name,
      custom: true,
      run: (input, context) => transformer(input as Dataset, context),
    });
    return this;
  }

  /**
   * Add a validation step.
   *
   * The schema may be given directly, in which case it is pure data and the step is
   * reproducible, or computed from the incoming dataset, in which case it is a callback.
   * The stored schema is cloned, so later mutation by the caller cannot change a pipeline
   * that has already been defined.
   */
  validate(schema: ValidationSchema | ValidateStep, options: { name?: string } = {}): this {
    this.#assertNotSealed();
    const isSchema = typeof schema === "object" && schema !== null && !Array.isArray(schema);
    if (!isSchema && typeof schema !== "function") {
      throw new ValidationError("validate expects a schema object or a function returning one.");
    }
    this.#assertHasLoad();
    const name = this.#resolveName(options.name, "validate");
    const stored = isSchema ? cloneValue(schema as ValidationSchema) : undefined;
    this.#steps.push({
      kind: "validate",
      name,
      custom: !isSchema,
      ...(stored === undefined ? {} : { schema: stored }),
      run: (input, context) => stored ?? (schema as ValidateStep)(input as Dataset, context),
    });
    return this;
  }

  /** Add a step that observes the dataset without changing it. */
  tap(observer: TapStep, options: { name?: string } = {}): this {
    this.#assertNotSealed();
    if (typeof observer !== "function") {
      throw new ValidationError("tap expects a function receiving a dataset.");
    }
    this.#assertHasLoad();
    const name = this.#resolveName(options.name, "tap");
    this.#steps.push({
      kind: "tap",
      name,
      custom: true,
      run: (input, context) => observer(input as Dataset, context),
    });
    return this;
  }

  /**
   * Finalize the definition and return the executable pipeline.
   *
   * Building validates the definition and seals it, so a pipeline that has been built
   * cannot gain another step. That is the point: the object you run is the object you
   * reviewed, and a definition cannot change between inspection and execution.
   *
   * Calling `build()` more than once is allowed and changes nothing.
   *
   * `run()` does not require `build()`; an unbuilt pipeline still runs, so the two styles
   * are interchangeable. Use `build()` when you want to freeze the definition at a known
   * point, for example at module load.
   */
  build(): this {
    if (this.#steps.length === 0) {
      throw new ValidationError("A pipeline must have at least one step before it can be built.");
    }
    this.#sealed = true;
    return this;
  }

  /** True once `build()` has been called. */
  get built(): boolean {
    return this.#sealed;
  }

  /**
   * Run the pipeline.
   *
   * Always asynchronous, even when every step is synchronous, so the calling code has one
   * shape to handle and adding an async step later does not change the caller.
   *
   * By default a failing step is recorded in the report and returned with `ok: false`,
   * because a caller often wants the full report. With `throwOnError: true` it throws a
   * `PipelineError` naming the step instead.
   */
  async run(options: RunOptions = {}): Promise<PipelineResult> {
    const started = Date.now();
    const reports: StepReport[] = [];
    const lineage: LineageEntry[] = [];
    const total = this.#steps.length;

    if (total === 0) {
      return { dataset: null, ok: false, steps: [], lineage: [], durationMs: 0, executed: 0, total: 0 };
    }
    if (this.#steps[0]?.kind !== "load") {
      throw new ValidationError("Pipeline cannot run: the first step must be a load step.");
    }

    let current: Dataset | null = null;
    let previousColumns: readonly string[] = [];
    let executed = 0;

    for (let index = 0; index < total; index += 1) {
      const step = this.#steps[index] as StepRecord;
      const context: StepContext = {
        index,
        name: step.name,
        total,
        ...(current === null ? {} : { input: current }),
      };
      const stepStart = Date.now();
      executed += 1;
      let timing: StepTiming = "sync";
      let validation: ValidationReport | undefined;

      try {
        const outcome = step.kind === "load" ? step.run(null, context) : step.run(current, context);
        // Recorded before awaiting: a promise means the step is asynchronous even if it
        // later rejects, which is exactly the case a report is most useful for.
        if (isThenable(outcome)) timing = "async";
        const resolved = isThenable(outcome) ? await outcome : outcome;

        let next: Dataset;
        if (step.kind === "tap") {
          if (current === null) throw new ValidationError(`Step "${step.name}" received no dataset.`);
          next = current;
        } else if (step.kind === "validate") {
          if (current === null) throw new ValidationError(`Step "${step.name}" received no dataset.`);
          validation = validateRows(current.data, current.columns, resolved as ValidationSchema);
          if (!validation.valid) {
            const first = validation.issues[0];
            throw new ValidationError(
              `Step "${step.name}" failed validation: ${validation.issueCount} issue(s) across ` +
                `${validation.invalidRows} row(s).${first === undefined ? "" : ` First issue: ${first.message}`}`,
            );
          }
          next = current;
        } else if (step.kind === "load") {
          next = toDataset(resolved, step.name);
        } else if (resolved instanceof Dataset) {
          next = resolved;
        } else if (Array.isArray(resolved)) {
          next = toDataset(resolved, step.name);
        } else {
          throw new ValidationError(
            `Step "${step.name}" must return a Dataset or an array of rows, received ${describeValue(resolved)}.`,
          );
        }

        const columns = next.columns;
        lineage.push({
          index,
          name: step.name,
          kind: step.kind,
          columns: [...columns],
          rows: next.rowCount,
          addedColumns: addedColumns(previousColumns, columns),
          removedColumns: removedColumns(previousColumns, columns),
        });
        previousColumns = columns;
        current = next;

        reports.push({
          index,
          name: step.name,
          kind: step.kind,
          timing,
          durationMs: Date.now() - stepStart,
          rows: next.rowCount,
          columns: columns.length,
          custom: step.custom,
          ...(validation === undefined ? {} : { validation }),
        });
      } catch (error) {
        const details = {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof NumiqError ? { code: error.code } : {}),
        };
        reports.push({
          index,
          name: step.name,
          kind: step.kind,
          timing,
          durationMs: Date.now() - stepStart,
          rows: current?.rowCount ?? 0,
          columns: current?.columnCount ?? 0,
          custom: step.custom,
          error: details,
          ...(validation === undefined ? {} : { validation }),
        });
        if (options.throwOnError === true) {
          throw new PipelineError(
            `Pipeline "${this.#name}" failed at step ${index + 1} of ${total} ` +
              `("${step.name}", ${step.kind}): ${details.message}`,
            { step: step.name, stepIndex: index, stepKind: step.kind, cause: error },
          );
        }
        return {
          dataset: null,
          ok: false,
          steps: reports,
          lineage,
          failedStep: step.name,
          failedIndex: index,
          durationMs: Date.now() - started,
          executed,
          total,
        };
      }
    }

    this.#lastLineage = lineage;
    return { dataset: current, ok: true, steps: reports, lineage, durationMs: Date.now() - started, executed, total };
  }

  /**
   * Describe the pipeline without running it.
   *
   * Reports which steps are pure data and which hold callbacks, so a caller can see what
   * could be stored and replayed and what cannot.
   */
  describe(): PipelineDescription {
    const steps = this.#steps.map((step, index) => {
      const entry: PipelineDescription["steps"][number] = {
        index,
        name: step.name,
        kind: step.kind,
        custom: step.custom,
      };
      if (step.schema !== undefined) entry.schema = step.schema;
      return entry;
    });

    const nonDeterministic = this.#steps.filter((step) => step.custom).map((step) => step.name);

    return {
      name: this.#name,
      steps,
      reproducible: nonDeterministic.length === 0,
      nonDeterministic,
      built: this.#sealed,
    };
  }
}

/** Create a pipeline. Building one runs nothing. */
export function pipeline(options: PipelineOptions = {}): Pipeline {
  return new Pipeline(options);
}
