import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { JobWorker } from "./worker.js";

describe("JobWorker lease identity", () => {
  it("is unique between workers even when process IDs match", () => {
    const pool = {} as Pool;
    const first = new JobWorker(pool);
    const second = new JobWorker(pool);
    const id = (worker: JobWorker) =>
      (worker as unknown as { workerId: string }).workerId;
    expect(id(first)).toMatch(/^worker-[0-9a-f-]{36}$/);
    expect(id(second)).toMatch(/^worker-[0-9a-f-]{36}$/);
    expect(id(first)).not.toBe(id(second));
  });
});
