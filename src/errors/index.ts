/** Stable, machine-readable failure categories. */
export type NumiqErrorCode =
  "VALIDATION_ERROR" | "IMPORT_ERROR" | "FORMAT_ERROR" | "ENVIRONMENT_ERROR" | "COLUMN_NOT_FOUND";

/** Base class for every error Numiq throws. */
export class NumiqError extends Error {
  readonly code: NumiqErrorCode;

  constructor(message: string, code: NumiqErrorCode) {
    super(message);
    this.name = "NumiqError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid arguments, unsupported inputs, or malformed row shapes. */
export class ValidationError extends NumiqError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/** A source could not be reached or read: network failure, HTTP status, unreadable body. */
export class ImportError extends NumiqError {
  readonly status: number | undefined;
  readonly source: string | undefined;

  constructor(message: string, details: { status?: number; source?: string } = {}) {
    super(message, "IMPORT_ERROR");
    this.name = "ImportError";
    this.status = details.status;
    this.source = details.source;
  }
}

/** The format could not be detected, is unsupported, or the text does not conform to it. */
export class FormatError extends NumiqError {
  constructor(message: string) {
    super(message, "FORMAT_ERROR");
    this.name = "FormatError";
  }
}

/** An API was used outside the environment that provides it. */
export class EnvironmentError extends NumiqError {
  constructor(message: string) {
    super(message, "ENVIRONMENT_ERROR");
    this.name = "EnvironmentError";
  }
}

/** A referenced column does not exist on the dataset. */
export class ColumnNotFoundError extends NumiqError {
  readonly column: string;
  readonly available: readonly string[];

  constructor(column: string, available: readonly string[]) {
    const known = available.length ? available.join(", ") : "(none)";
    super(`Unknown column: "${column}". Available columns: ${known}.`, "COLUMN_NOT_FOUND");
    this.name = "ColumnNotFoundError";
    this.column = column;
    this.available = available;
  }
}
