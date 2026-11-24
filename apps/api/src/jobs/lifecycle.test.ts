import { expect, it } from "vitest";
import { createLifecycle } from "../lifecycle/runtime.js";
import { runJobLoop } from "./runner.js";
import { ownedJob } from "./lifecycle.js";
it("owns a claim begun before cutoff and keeps active work uncancelled", async () => {
  const runtime = createLifecycle({ publish: async () => {}, exit: () => {} });
  runtime.markRunning();
  let settle!: () => void;
  const claim = new Promise<void>((done) => {
    settle = done;
  });
  let claims = 0;
  const loop = runJobLoop(
    ownedJob(runtime, async () => {
      claims++;
      await claim;
      expect(runtime.forceCancel.aborted).toBe(false);
      return true;
    }),
    runtime.stopAdmission,
  );
  const drain = runtime.shutdown("SIGTERM");
  expect(claims).toBe(1);
  settle();
  await loop;
  expect((await drain).exitCode).toBe(0);
  expect(claims).toBe(1);
});
it("owns digest scheduling settlement and forbids another schedule after cutoff", async () => {
  const { runDigestScheduleLoop } = await import("../digest/runner.js");
  const runtime = createLifecycle({ publish: async () => {}, exit: () => {} });
  runtime.markRunning();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let calls = 0;
  const scheduling = runDigestScheduleLoop(
    ownedJob(runtime, async () => {
      calls++;
      await gate;
      return true;
    }),
    runtime.stopAdmission,
  );
  const draining = runtime.shutdown("SIGTERM");
  expect(calls).toBe(1);
  release();
  await scheduling;
  expect((await draining).exitCode).toBe(0);
  expect(calls).toBe(1);
});
