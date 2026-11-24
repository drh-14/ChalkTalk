import type { Lifecycle } from "../lifecycle/runtime.js";

/** Claim ownership starts before the claim query, not when it returns a row. */
export function ownedJob(lifecycle: Lifecycle, run: () => Promise<boolean>) {
  return async () => {
    const release = lifecycle.admit("job");
    if (!release) return false;
    try {
      return await run();
    } catch (error) {
      lifecycle.fail("owner_failed");
      throw error;
    } finally {
      release();
    }
  };
}
