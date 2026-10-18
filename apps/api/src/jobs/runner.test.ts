import { describe, expect, it, vi } from "vitest";
import { runJobLoop } from "./runner.js";

describe("runJobLoop", () => {
  it("drains a running job and does not claim another after shutdown", async () => {
    const controller = new AbortController();
    let finishJob!: () => void;
    const pendingJob = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    const runOnce = vi.fn(async () => {
      await pendingJob;
      return true;
    });
    const loop = runJobLoop(runOnce, controller.signal, 1);
    expect(runOnce).toHaveBeenCalledTimes(1);
    controller.abort();
    finishJob();
    await loop;
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("retries an idle poll or failure until shutdown", async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    let attempts = 0;
    const runOnce = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return false;
      if (attempts === 2) throw new Error("database unavailable");
      controller.abort();
      return true;
    });
    await runJobLoop(runOnce, controller.signal, 1, onError);
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
