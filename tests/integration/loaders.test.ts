import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCSV, loadJSON, loadTSV, loadURL } from "../../src/node.js";
import { FormatError, ImportError, ValidationError } from "../../src/errors/index.js";

let server: Server;
let baseUrl: string;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "numiq-"));
  await mkdir(path.join(workDir, "dataset"), { recursive: true });
  await writeFile(path.join(workDir, "dataset", "sales.csv"), "product,amount\nMouse,25\nKeyboard,75\n");
  await writeFile(path.join(workDir, "dataset", "sales.tsv"), "product\tamount\nMouse\t25\nKeyboard\t75\n");
  await writeFile(path.join(workDir, "dataset", "users.json"), '[{"name":"Ada"},{"name":"Lin"}]');

  server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/data.csv") {
      response.writeHead(200, { "content-type": "text/csv" });
      response.end("a,b\n1,2\n");
    } else if (url === "/data.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('[{"a":1}]');
    } else if (url === "/data.tsv") {
      response.writeHead(200, { "content-type": "text/tab-separated-values" });
      response.end("a\tb\n1\t2\n");
    } else if (url === "/no-extension") {
      response.writeHead(200, { "content-type": "text/csv" });
      response.end("a,b\n1,2\n");
    } else if (url === "/unknown-type") {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end("a,b\n1,2\n");
    } else if (url === "/lying-extension.csv") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('[{"a":1}]');
    } else if (url === "/missing") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    } else if (url === "/boom") {
      response.writeHead(500);
      response.end("error");
    } else if (url === "/slow-body") {
      // Headers arrive immediately, then the body stalls forever. A timeout that is
      // cleared when the response object resolves would never fire here.
      response.writeHead(200, { "content-type": "text/csv" });
      response.write("a,b\n");
    } else if (url === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/csv" });
        response.end("a,b\n1,2\n");
      }, 5000);
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
});

describe("local files", () => {
  it("loads CSV, TSV, and JSON by filename from the dataset folder", async () => {
    const csv = await loadCSV("sales.csv", { datasetDir: workDir });
    expect(csv.shape).toEqual([2, 2]);
    expect(csv.data[0]).toEqual({ product: "Mouse", amount: 25 });
    expect(csv.importReport!.source).toBe("sales");

    const tsv = await loadTSV("sales.tsv", { datasetDir: workDir });
    expect(tsv.data).toEqual(csv.data);

    const json = await loadJSON("users.json", { datasetDir: workDir });
    expect(json.data).toEqual([{ name: "Ada" }, { name: "Lin" }]);
  });

  it("resolves filenames against <datasetDir>/dataset", async () => {
    const previous = process.cwd();
    process.chdir(workDir);
    try {
      const data = await loadCSV("sales.csv");
      expect(data.rowCount).toBe(2);
    } finally {
      process.chdir(previous);
    }
  });

  it("refuses to read outside the dataset folder", async () => {
    await writeFile(path.join(workDir, "outside.csv"), "a\n1\n");
    await expect(loadCSV("outside.csv", { datasetDir: workDir })).rejects.toThrow(ImportError);
    await expect(loadCSV("../outside.csv", { datasetDir: workDir })).rejects.toThrow(ValidationError);
  });

  // Security: the local-file sandbox. Each case below is a way out of dataset/ that the
  // loader must refuse, so the guarantee is pinned rather than assumed.
  it("refuses an absolute path", async () => {
    const absolute = path.join(workDir, "dataset", "sales.csv");
    await expect(loadCSV(absolute, { datasetDir: workDir })).rejects.toThrow(ValidationError);
  });

  it("refuses a Windows-style absolute path", async () => {
    await expect(loadCSV("C:\\Windows\\system.ini", { datasetDir: workDir })).rejects.toThrow(ValidationError);
  });

  it("refuses a nested path even when the file exists", async () => {
    await mkdir(path.join(workDir, "dataset", "nested"), { recursive: true });
    await writeFile(path.join(workDir, "dataset", "nested", "inner.csv"), "a\n1\n");
    await expect(loadCSV("nested/inner.csv", { datasetDir: workDir })).rejects.toThrow(ValidationError);
    await expect(loadCSV("nested\\inner.csv", { datasetDir: workDir })).rejects.toThrow(ValidationError);
  });

  it("refuses a null byte in the filename", async () => {
    await expect(loadCSV("sales.csv\u0000.txt", { datasetDir: workDir })).rejects.toThrow(ValidationError);
  });

  it("refuses a symlink that resolves outside the dataset folder", async () => {
    // The filename is bare and the link lives inside dataset/, so only realpath-based
    // containment stops this read.
    await writeFile(path.join(workDir, "secret.csv"), "secret\n1\n");
    await symlink(path.join(workDir, "secret.csv"), path.join(workDir, "dataset", "link.csv"));
    await expect(loadCSV("link.csv", { datasetDir: workDir })).rejects.toThrow(ImportError);
  });

  it("allows a symlink that stays inside the dataset folder", async () => {
    await symlink(path.join(workDir, "dataset", "sales.csv"), path.join(workDir, "dataset", "alias.csv"));
    const data = await loadCSV("alias.csv", { datasetDir: workDir });
    expect(data.rowCount).toBe(2);
  });

  it("reports a missing file as an ImportError", async () => {
    await expect(loadCSV("nope.csv", { datasetDir: workDir })).rejects.toThrow(ImportError);
  });

  it("reports a directory as an ImportError", async () => {
    await mkdir(path.join(workDir, "dataset", "folder.csv"), { recursive: true });
    await expect(loadCSV("folder.csv", { datasetDir: workDir })).rejects.toThrow(ImportError);
  });
});

describe("format-specific loaders do not guess", () => {
  it("refuses to parse a JSON file as CSV", async () => {
    await expect(loadCSV("users.json", { datasetDir: workDir })).rejects.toThrow(FormatError);
  });

  it("refuses to parse a CSV file as JSON", async () => {
    await expect(loadJSON("sales.csv", { datasetDir: workDir })).rejects.toThrow(FormatError);
  });
});

describe("Blob and byte sources", () => {
  it("loads from a Blob", async () => {
    const blob = new Blob(["a,b\n1,2\n"], { type: "text/csv" });
    const data = await loadCSV(blob);
    expect(data.data).toEqual([{ a: 1, b: 2 }]);
  });

  it("loads from a Uint8Array", async () => {
    const data = await loadCSV(new TextEncoder().encode("a\n1\n"));
    expect(data.data).toEqual([{ a: 1 }]);
  });

  it("loads from an ArrayBuffer", async () => {
    const bytes = new TextEncoder().encode("a\n1\n");
    const data = await loadCSV(bytes.buffer.slice(0) as ArrayBuffer);
    expect(data.data).toEqual([{ a: 1 }]);
  });

  it("rejects unsupported sources", async () => {
    await expect(loadCSV(42 as never)).rejects.toThrow(ValidationError);
  });
});

describe("loadURL", () => {
  it("loads each supported format", async () => {
    expect((await loadURL(`${baseUrl}/data.csv`)).data).toEqual([{ a: 1, b: 2 }]);
    expect((await loadURL(`${baseUrl}/data.json`)).data).toEqual([{ a: 1 }]);
    expect((await loadURL(`${baseUrl}/data.tsv`)).data).toEqual([{ a: 1, b: 2 }]);
  });

  it("falls back to content-type when there is no extension", async () => {
    expect((await loadURL(`${baseUrl}/no-extension`)).data).toEqual([{ a: 1, b: 2 }]);
  });

  it("prefers an explicit format over the extension", async () => {
    const data = await loadURL(`${baseUrl}/lying-extension.csv`, { format: "json" });
    expect(data.data).toEqual([{ a: 1 }]);
  });

  it("fails rather than guessing an unknown content type", async () => {
    await expect(loadURL(`${baseUrl}/unknown-type`)).rejects.toThrow(FormatError);
  });

  it("maps HTTP failures to ImportError with a status", async () => {
    await expect(loadURL(`${baseUrl}/missing`)).rejects.toMatchObject({ status: 404 });
    await expect(loadURL(`${baseUrl}/boom`)).rejects.toMatchObject({ status: 500 });
  });

  it("times out", async () => {
    await expect(loadURL(`${baseUrl}/slow`, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });

  it("keeps the timeout active while the response body streams", async () => {
    const started = Date.now();
    await expect(loadURL(`${baseUrl}/slow-body`, { timeoutMs: 300 })).rejects.toBeInstanceOf(ImportError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(4000);
  });

  it("honours an abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadURL(`${baseUrl}/slow`, { signal: controller.signal })).rejects.toThrow();
  });

  it("records the content type in the report", async () => {
    expect((await loadURL(`${baseUrl}/data.csv`)).importReport!.contentType).toBe("text/csv");
  });

  it("rejects non-http URLs", async () => {
    await expect(loadURL("ftp://example.com/a.csv")).rejects.toThrow(ValidationError);
  });

  it("rejects a connection failure as ImportError", async () => {
    await expect(loadURL("http://127.0.0.1:1/none.csv")).rejects.toThrow(ImportError);
  });
});

describe("environment split", () => {
  // The browser entry must be exercised in a process that never imports the Node entry,
  // because importing `node.ts` installs its file reader for the whole module graph.
  beforeAll(() => {
    // These assertions run against the shipped artifact, so it must exist first.
    const built = spawnSync(process.execPath, ["scripts/build.mjs"], {
      cwd: path.resolve(here, "../.."),
      encoding: "utf8",
    });
    if (built.status !== 0) throw new Error(`build failed: ${built.stderr}`);
  });

  const runIsolated = (source: string): { code: number; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: path.resolve(here, "../.."),
      encoding: "utf8",
    });
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  };

  it("refuses local file paths with an EnvironmentError", () => {
    const result = runIsolated(`
      import { loadCSV, EnvironmentError } from "./dist/esm/index.js";
      try {
        await loadCSV("data/sales.csv");
        console.log("NO_THROW");
      } catch (error) {
        console.log(error instanceof EnvironmentError ? "ENVIRONMENT_ERROR" : "WRONG:" + error.name);
      }
    `);
    expect(result.stderr).not.toContain("Error:");
    expect(result.stdout.trim()).toBe("ENVIRONMENT_ERROR");
  });

  it("still loads a Blob", () => {
    const csv = JSON.stringify("a,b\n1,2\n");
    const result = runIsolated(`
      import { loadCSV } from "./dist/esm/index.js";
      const data = await loadCSV(new Blob([${csv}]));
      console.log(JSON.stringify(data.data));
    `);
    expect(result.stdout.trim()).toBe('[{"a":1,"b":2}]');
  });

  it("imports without touching any node: built-in", async () => {
    const source = await readFile(path.resolve(here, "../../dist/esm/index.js"), "utf8");
    const builtins = [...source.matchAll(/from\s*"node:[^"]+"/g)].map((match) => match[0]);
    expect(builtins).toEqual([]);
  });
});
