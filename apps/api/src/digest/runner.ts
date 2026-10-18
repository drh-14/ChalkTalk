function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Reconcile on startup, at midnight UTC, and each minute for recovery. */
export async function runDigestScheduleLoop(
  schedule: () => Promise<unknown>,
  signal: AbortSignal,
  onError: (error: unknown) => void = (error) =>
    console.error("Daily digest scheduling failed", error),
): Promise<void> {
  while (!signal.aborted) {
    try {
      await schedule();
    } catch (error) {
      onError(error);
    }
    if (signal.aborted) return;
    const now = new Date();
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    await pause(Math.min(60_000, midnight - now.getTime()), signal);
  }
}
