import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createProcessLifecycle } from "./process.js";
const cleanup: (() => void)[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) stop();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it("requires complete trusted production identity and paths without changing settings", () => {
  expect(() =>
    createProcessLifecycle("api", { NODE_ENV: "production" }, () => {}),
  ).toThrow("Lifecycle evidence configuration");
});
it("publishes boot before startup and does not run late startup after cutoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chalktalk-startup-"));
  dirs.push(directory);
  const process = createProcessLifecycle(
    "api",
    {
      NODE_ENV: "test",
      LIFECYCLE_EVIDENCE_DIRECTORY: directory,
      LIFECYCLE_REQUEST_DIRECTORY: directory,
      LIFECYCLE_RELEASE_ID: "release-1",
      LIFECYCLE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
    },
    () => {},
  );
  cleanup.push(process.dispose);
  let started = false;
  const startup = process.start(async () => {
    started = true;
  });
  const drain = process.runtime.shutdown("SIGTERM");
  await startup;
  expect(started).toBe(false);
  expect((await drain).exitCode).toBe(0);
  expect(
    (await readdir(directory)).filter((name) => name.endsWith(".boot.json")),
  ).toHaveLength(1);
});
