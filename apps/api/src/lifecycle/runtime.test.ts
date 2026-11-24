import { describe, expect, it } from "vitest";
import { createLifecycle } from "./runtime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("application lifecycle", () => {
  it("cuts off startup synchronously, owns late startup, then closes before publishing", async () => {
    const events: string[] = [];
    const startup = deferred();
    const runtime = createLifecycle({
      publish: async (result) => {
        events.push(`receipt:${result.exitCode}`);
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });
    const release = runtime.admit("startup")!;
    const pending = startup.promise.then(() => {
      runtime.closeResource("transport", async () => {
        events.push("listener");
      });
      expect(runtime.markRunning()).toBe(false);
      release();
    });
    runtime.closeResource("dependency", async () => {
      events.push("pool");
    });
    const shutdown = runtime.shutdown("SIGTERM");
    expect(runtime.state).toBe("DRAINING");
    expect(runtime.ready).toBe(false);
    expect(runtime.admit("handler")).toBeUndefined();
    expect(runtime.stopAdmission.aborted).toBe(true);
    expect(runtime.forceCancel.aborted).toBe(false);
    expect(events).toEqual([]);
    startup.resolve();
    await pending;
    await shutdown;
    expect(events).toEqual(["listener", "pool", "receipt:0", "exit:0"]);
    expect(runtime.state).toBe("STOPPED");
  });
});

it("shares one promise even when cutoff reenters and release is repeated", async () => {
  const exits: number[] = [];
  const runtime = createLifecycle({
    publish: async () => {},
    exit: (code) => {
      exits.push(code);
    },
  });
  runtime.markRunning();
  const release = runtime.admit("job")!;
  let reentrant: ReturnType<typeof runtime.shutdown> | undefined;
  runtime.onCutoff(() => {
    reentrant = runtime.shutdown("SIGINT");
  });
  const first = runtime.shutdown("SIGTERM");
  expect(reentrant).toBe(first);
  release();
  release();
  expect((await first).deadlineMs).toBe(120000);
  expect(exits).toEqual([0]);
});

it("latches timeout and cannot become success when forced cancellation settles its owner", async () => {
  const exits: number[] = [];
  let publications = 0;
  const runtime = createLifecycle({
    deadlineMs: 10,
    publish: async () => {
      publications++;
    },
    exit: (code) => {
      exits.push(code);
    },
  });
  runtime.markRunning();
  const release = runtime.admit("child")!;
  runtime.forceCancel.addEventListener("abort", release);
  const result = await runtime.shutdown("SIGTERM");
  await Promise.resolve();
  expect(result.result).toBe("timeout");
  expect(runtime.state).toBe("FAILED");
  expect(publications).toBe(0);
  expect(exits).toEqual([2]);
});
