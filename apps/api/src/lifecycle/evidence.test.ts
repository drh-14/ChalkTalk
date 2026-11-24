import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createEvidence } from "./evidence.js";
import type { DrainResult } from "./types.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});
const result: DrainResult = {
  trigger: "SIGTERM",
  result: "success",
  exitCode: 0,
  deadlineMs: 120000,
  elapsedMs: 12,
  cutoffAt: "2026-11-23T00:00:01.000Z",
  completedAt: "2026-11-23T00:00:02.000Z",
  remaining: {
    startup: 0,
    handler: 0,
    admission: 0,
    store: 0,
    job: 0,
    heartbeat: 0,
    child: 0,
    listener: 0,
  },
  failures: [],
};
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "chalktalk-evidence-"));
  directories.push(directory);
  const evidence = createEvidence({
    evidenceDirectory: directory,
    requestDirectory: directory,
    role: "api",
    releaseId: "a".repeat(40),
    imageDigest: `sha256:${"b".repeat(64)}`,
  });
  await evidence.publishBoot();
  const descriptor = JSON.parse(
    await readFile(
      join(directory, `${evidence.identity.bootId}.boot.json`),
      "utf8",
    ),
  );
  const requestPath = join(directory, `${evidence.identity.bootId}.json`);
  const request = {
    ...evidence.identity,
    schemaVersion: 1,
    operationId: randomUUID(),
    requestNonce: randomUUID(),
  };
  return { evidence, descriptor, requestPath, request, directory };
}
describe("durable boot-bound evidence", () => {
  it("publishes restrictive immutable boot and ordinary unbound receipt", async () => {
    const { evidence, descriptor, directory } = await setup();
    expect(descriptor).toMatchObject({
      schemaVersion: 1,
      role: "api",
      bootId: evidence.identity.bootId,
    });
    await evidence.readRequest();
    await evidence.publishTerminal(result);
    const path = join(directory, `${evidence.identity.bootId}.terminal.json`);
    const receipt = JSON.parse(await readFile(path, "utf8"));
    expect(receipt).toMatchObject({
      operationId: null,
      requestNonce: null,
      result: "success",
      exitCode: 0,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(evidence.publishTerminal(result)).rejects.toThrow();
  });
  it("reads exact binding once; cannot relabel a missing request later", async () => {
    const { evidence, requestPath, request, directory } = await setup();
    await evidence.readRequest();
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
    await evidence.readRequest();
    await evidence.publishTerminal(result);
    const receipt = JSON.parse(
      await readFile(
        join(directory, `${evidence.identity.bootId}.terminal.json`),
        "utf8",
      ),
    );
    expect(receipt.operationId).toBeNull();
  });
  it("echoes a matching exact boot/release/image/nonce tuple", async () => {
    const { evidence, requestPath, request, directory } = await setup();
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
    await evidence.readRequest();
    await evidence.publishTerminal(result);
    expect(
      JSON.parse(
        await readFile(
          join(directory, `${evidence.identity.bootId}.terminal.json`),
          "utf8",
        ),
      ),
    ).toMatchObject(request);
  });
  it.each([
    "bootId",
    "role",
    "releaseId",
    "imageDigest",
    "operationId",
    "requestNonce",
    "extra",
    "oversize",
  ])("rejects invalid %s without binding", async (field) => {
    const { evidence, requestPath, request } = await setup();
    const bad = { ...request, [field]: "invalid" };
    await writeFile(
      requestPath,
      field === "oversize" ? "x".repeat(8193) : JSON.stringify(bad),
      { mode: 0o600 },
    );
    await expect(evidence.readRequest()).rejects.toThrow(
      "Invalid lifecycle request",
    );
    await expect(evidence.readRequest()).rejects.toThrow(
      "Invalid lifecycle request",
    );
    await expect(evidence.publishTerminal(result)).rejects.toThrow();
  });
  it("rejects a symlink instead of following it", async () => {
    const { evidence, requestPath, request, directory } = await setup();
    const target = join(directory, "target");
    await writeFile(target, JSON.stringify(request), { mode: 0o600 });
    await symlink(target, requestPath);
    await expect(evidence.readRequest()).rejects.toThrow(
      "Invalid lifecycle request",
    );
  });
});

it("does not serialize a success claim with remaining work", async () => {
  const { evidence } = await setup();
  await evidence.readRequest();
  await expect(
    evidence.publishTerminal({
      ...result,
      remaining: { ...result.remaining, handler: 1 },
    }),
  ).rejects.toThrow();
});

it.each(["{", "null", "[]", '"scalar"'])(
  "rejects malformed/partial request %s",
  async (contents) => {
    const { evidence, requestPath } = await setup();
    await writeFile(requestPath, contents, { mode: 0o600 });
    await expect(evidence.readRequest()).rejects.toThrow(
      "Invalid lifecycle request",
    );
  },
);

it("rejects a symlinked request directory", async () => {
  const { directory } = await setup();
  const link = join(directory, "requests");
  await symlink(directory, link);
  const evidence = createEvidence({
    evidenceDirectory: directory,
    requestDirectory: link,
    role: "api",
    releaseId: "a".repeat(40),
    imageDigest: `sha256:${"b".repeat(64)}`,
  });
  await evidence.publishBoot();
  await expect(evidence.readRequest()).rejects.toThrow(
    "Invalid lifecycle request",
  );
});
it("serializes elapsed milliseconds as an integer without weakening the precise deadline check", async () => {
  const { evidence, directory } = await setup();
  await evidence.readRequest();
  await evidence.publishTerminal({ ...result, elapsedMs: 12.75 });
  const receipt = JSON.parse(
    await readFile(
      join(directory, `${evidence.identity.bootId}.terminal.json`),
      "utf8",
    ),
  );
  expect(receipt.elapsedMs).toBe(12);
  const second = await setup();
  await second.evidence.readRequest();
  await expect(
    second.evidence.publishTerminal({ ...result, elapsedMs: 120000.1 }),
  ).rejects.toThrow("Invalid lifecycle success evidence");
});
