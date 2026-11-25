import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { DrainResult } from "./types.js";
const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
});
async function start(mode: string, directory?: string) {
  const child = fork(
    fileURLToPath(
      new URL(
        "../../../../tests/fixtures/lifecycle-process.ts",
        import.meta.url,
      ),
    ),
    [mode],
    {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, LIFECYCLE_TEST_DIRECTORY: directory },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.push(child);
  const messages: Record<string, unknown>[] = [];
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += String(data);
  });
  const waiters = new Map<string, (() => void)[]>();
  child.on("message", (message: Record<string, unknown>) => {
    messages.push(message);
    for (const key of Object.keys(message))
      for (const waiter of waiters.get(key) ?? []) waiter();
  });
  const wait = (key: string) =>
    messages.some((message) => key in message)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
        });
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  await Promise.race([
    wait("started"),
    exited.then((code) => {
      throw new Error(`Early exit ${code}: ${stderr}`);
    }),
  ]);
  return { child, wait, exited, messages };
}
describe("real process lifecycle signals", () => {
  it("settles startup after repeated signals without becoming ready", async () => {
    const process = await start("normal");
    process.child.kill("SIGTERM");
    await process.wait("cutoff");
    process.child.kill("SIGINT");
    process.child.send("release");
    expect(await process.exited).toBe(0);
    expect(process.messages.filter((message) => message.cutoff)).toHaveLength(
      1,
    );
    expect(
      process.messages.find((message) => "lateRunning" in message),
    ).toEqual({ lateRunning: false });
    const receipts = process.messages.filter((message) => message.receipt);
    expect(receipts).toHaveLength(1);
    expect((receipts[0]!.receipt as DrainResult).result).toBe("success");
  });
  it("exits 2 at the original deadline with an uncompleted owner", async () => {
    const process = await start("timeout");
    process.child.kill("SIGTERM");
    await process.wait("cutoff");
    process.child.kill("SIGINT");
    expect(await process.exited).toBe(2);
    expect(process.messages.some((message) => message.receipt)).toBe(false);
  });
  it("fatal rejection cannot become success after startup settles", async () => {
    const process = await start("normal");
    process.child.send("fatal");
    await process.wait("cutoff");
    process.child.send("release");
    expect(await process.exited).toBe(1);
    expect(
      (
        process.messages.find((message) => message.receipt)!
          .receipt as DrainResult
      ).failures,
    ).toEqual(["fatal"]);
  });
  it("required dependency close error prevents a clean exit", async () => {
    const process = await start("close-error");
    process.child.kill("SIGTERM");
    await process.wait("cutoff");
    process.child.send("release");
    expect(await process.exited).toBe(1);
    expect(
      (
        process.messages.find((message) => message.receipt)!
          .receipt as DrainResult
      ).failures,
    ).toEqual(["closure_failed"]);
  });
  it("hung evidence does not extend the process deadline", async () => {
    const process = await start("evidence-hang");
    process.child.kill("SIGTERM");
    await process.wait("cutoff");
    process.child.send("release");
    expect(await process.exited).toBe(2);
  });
});

it.each(["normal", "directory-sync-error"])(
  "checks real disk receipt against observed child exit: %s",
  async (mode) => {
    const directory = await mkdtemp(
      join(tmpdir(), "chalktalk-process-evidence-"),
    );
    directories.push(directory);
    const child = await start(mode, directory);
    const identity = child.messages.find((message) => message.started)!
      .identity as Record<string, string>;
    const operationId = randomUUID();
    const requestNonce = randomUUID();
    await writeFile(
      join(directory, `${identity.bootId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        ...identity,
        operationId,
        requestNonce,
      }),
      { mode: 0o600 },
    );
    child.child.kill("SIGTERM");
    await child.wait("cutoff");
    child.child.send("release");
    expect(await child.exited).toBe(mode === "normal" ? 0 : 1);
    const receipt = JSON.parse(
      await readFile(
        join(directory, `${identity.bootId}.terminal.json`),
        "utf8",
      ),
    );
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      ...identity,
      operationId,
      requestNonce,
      result: "success",
      exitCode: 0,
    });
    // directory-sync-error deliberately leaves a visible success file but exit 1:
    // no downstream consumer may use that file alone as replacement proof.
  },
);

it("hard exits 2 when the actual evidence file write never settles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chalktalk-hung-write-"));
  directories.push(directory);
  const child = await start("evidence-write-hang", directory);
  child.child.kill("SIGTERM");
  await child.wait("cutoff");
  child.child.send("release");
  expect(await child.exited).toBe(2);
  expect(child.messages.some((message) => message.receipt)).toBe(false);
});
