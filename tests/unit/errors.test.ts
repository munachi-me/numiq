import { describe, it, expect } from "vitest";
import {
  NumiqError,
  ValidationError,
  ImportError,
  FormatError,
  EnvironmentError,
  ColumnNotFoundError,
} from "../../src/errors/index.js";

describe("error taxonomy", () => {
  it("every error extends NumiqError and Error", () => {
    const errors = [
      new ValidationError("bad"),
      new ImportError("bad"),
      new FormatError("bad"),
      new EnvironmentError("bad"),
      new ColumnNotFoundError("x", ["y"]),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(NumiqError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("carries a stable machine-readable code", () => {
    expect(new ValidationError("m").code).toBe("VALIDATION_ERROR");
    expect(new ImportError("m").code).toBe("IMPORT_ERROR");
    expect(new FormatError("m").code).toBe("FORMAT_ERROR");
    expect(new EnvironmentError("m").code).toBe("ENVIRONMENT_ERROR");
    expect(new ColumnNotFoundError("x", []).code).toBe("COLUMN_NOT_FOUND");
  });

  it("sets a distinct name for each subclass", () => {
    expect(new ValidationError("m").name).toBe("ValidationError");
    expect(new ImportError("m").name).toBe("ImportError");
    expect(new FormatError("m").name).toBe("FormatError");
    expect(new EnvironmentError("m").name).toBe("EnvironmentError");
    expect(new ColumnNotFoundError("x", []).name).toBe("ColumnNotFoundError");
  });

  it("survives instanceof after a subclass extends it", () => {
    class Custom extends ValidationError {}
    const error = new Custom("m");
    expect(error).toBeInstanceOf(Custom);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(NumiqError);
  });

  it("ImportError keeps HTTP status and source", () => {
    const error = new ImportError("m", { status: 404, source: "http://x/y" });
    expect(error.status).toBe(404);
    expect(error.source).toBe("http://x/y");
    expect(new ImportError("m").status).toBeUndefined();
  });

  it("ColumnNotFoundError lists the available columns", () => {
    const error = new ColumnNotFoundError("age", ["name", "score"]);
    expect(error.column).toBe("age");
    expect(error.available).toEqual(["name", "score"]);
    expect(error.message).toContain('"age"');
    expect(error.message).toContain("name, score");
  });

  it("ColumnNotFoundError handles a dataset with no columns", () => {
    expect(new ColumnNotFoundError("x", []).message).toContain("(none)");
  });
});
