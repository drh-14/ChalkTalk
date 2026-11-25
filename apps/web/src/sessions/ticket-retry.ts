import { ApiError } from "../auth/client.js";

/** Retry fresh requests, never a previously consumed ticket. View disposal owns cancellation. */
export async function retryFreshTicket<T>(
  request: () => Promise<T>,
  signal: AbortSignal,
  onTransient: () => void,
  initialDelayMs = 1000,
): Promise<T> {
  let delay = initialDelayMs;
  for (;;) {
    signal.throwIfAborted();
    try {
      const ticket = await request();
      signal.throwIfAborted();
      return ticket;
    } catch (error) {
      signal.throwIfAborted();
      if (!(
        error instanceof TypeError ||
        (error instanceof ApiError && error.status === 503)
      ))
        throw error;
      onTransient();
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", cancel);
          resolve();
        }, delay);
        signal.addEventListener("abort", cancel, { once: true });
      });
      delay = Math.min(delay * 2, 5000);
    }
  }
}
