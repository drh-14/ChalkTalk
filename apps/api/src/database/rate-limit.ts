import type { Pool, PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";

/**
 * Counts one request in a fixed window and throws `429 rate_limited`, with
 * `retryAfter` for the Retry-After header, once the window holds more than
 * `limit`. In a transaction, a rejected request's count rolls back with it.
 */
export async function consumeRateLimit(
  db: Pool | PoolClient,
  action: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const windowStartedAt = new Date(
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
  );
  const result = await db.query<{ request_count: number }>(
    `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (bucket_key) DO UPDATE SET request_count = rate_limit_buckets.request_count + 1, updated_at = now()
     RETURNING request_count`,
    [`${action}:${subject}:${windowStartedAt.toISOString()}`, windowStartedAt],
  );
  if (result.rows[0]!.request_count <= limit) return;
  const error = new AuthError(429, "rate_limited", "Too many requests");
  Object.assign(error, {
    retryAfter: Math.max(
      1,
      Math.ceil(
        (windowStartedAt.getTime() + windowSeconds * 1000 - Date.now()) / 1000,
      ),
    ),
  });
  throw error;
}
