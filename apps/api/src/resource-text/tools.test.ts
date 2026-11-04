import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize.js";
import { ExtractionFailure, runTool, withTempDirectory } from "./tools.js";

const node = process.execPath;

describe("runTool", () => {
  it("returns stdout, stderr and the exit code without a shell", async () => {
    const result = await runTool(node, [
      "-e",
      "process.stdout.write('a; echo b'); process.stderr.write('warn'); process.exit(3)",
    ]);
    expect(result).toEqual({
      code: 3,
      stdout: Buffer.from("a; echo b"),
      stderr: "warn",
      truncated: false,
    });
  });

  it("kills a tool that exceeds its timeout", async () => {
    const started = Date.now();
    await expect(
      runTool(node, ["-e", "setTimeout(() => {}, 30000)"], { timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: "timeout", permanent: false });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("stops reading and kills the tool at the output cap", async () => {
    const result = await runTool(
      node,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(4096)), 1)"],
      { maxOutputBytes: 10_000, timeoutMs: 10_000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(10_000);
  });

  it("rejects when aborted or when the tool is missing", async () => {
    const controller = new AbortController();
    const running = runTool(node, ["-e", "setTimeout(() => {}, 30000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "aborted" });
    await expect(runTool("chalktalk-no-such-tool", [])).rejects.toBeInstanceOf(
      ExtractionFailure,
    );
  });
});

describe("withTempDirectory", () => {
  it("removes the directory after success and after a throw", async () => {
    let kept = "";
    await withTempDirectory(async (directory) => {
      kept = directory;
      await writeFile(join(directory, "page.png"), "x");
    });
    await expect(access(kept)).rejects.toThrow();
    await expect(
      withTempDirectory(async (directory) => {
        kept = directory;
        await writeFile(join(directory, "page.png"), "x");
        throw new Error("extractor failed");
      }),
    ).rejects.toThrow("extractor failed");
    await expect(access(kept)).rejects.toThrow();
  });
});

describe("normalizeText", () => {
  it("removes control characters and collapses whitespace", () => {
    expect(
      normalizeText(
        "  Title\r\n\r\n\r\n\r\nBody\u0002with\u0003\u0000marks\tand   tabs \fend\u0085\ue000\ue001 ",
      ),
    ).toEqual({
      text: "Title\n\nBody with marks and tabs end",
      truncated: false,
    });
  });

  it("truncates by code points without splitting surrogate pairs", () => {
    const result = normalizeText("ab😀cd", 3);
    expect(result).toEqual({ text: "ab😀", truncated: true });
    expect(normalizeText("abc", 3)).toEqual({ text: "abc", truncated: false });
  });
});
