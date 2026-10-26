import { Worker } from "node:worker_threads";

/** A wall-clock deadline terminates CPU work, not just the waiting promise. */
export function renderEquation(
  source: string,
  display: boolean,
): Promise<Buffer | undefined> {
  if (!source.trim() || Buffer.byteLength(source) > 2048)
    return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const path = new URL(
      import.meta.url.endsWith(".ts") ? "./math.worker.ts" : "./math.worker.js",
      import.meta.url,
    );
    let worker: Worker;
    try {
      worker = new Worker(path, {
        workerData: { source, display },
        resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 2 },
        execArgv: [],
      });
    } catch {
      resolve(undefined);
      return;
    }
    let finished = false;
    const finish = (value?: Uint8Array) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      resolve(value ? Buffer.from(value) : undefined);
    };
    const timeout = setTimeout(() => finish(), 2000);
    worker.once("message", (value: Uint8Array | null) =>
      finish(value ?? undefined),
    );
    worker.once("error", () => finish());
    worker.once("exit", () => finish());
  });
}
