const pause = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export async function runJobLoop(
  runOnce: () => Promise<boolean>,
  signal: AbortSignal,
  pollIntervalMs = 1_000,
  onError: (error: unknown) => void = (error) =>
    console.error("Background job poll failed", error),
): Promise<void> {
  while (!signal.aborted) {
    let processed = false;
    try {
      processed = await runOnce();
    } catch (error) {
      onError(error);
    }
    if (!processed && !signal.aborted) await pause(pollIntervalMs, signal);
  }
}
