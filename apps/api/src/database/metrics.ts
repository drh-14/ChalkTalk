import { Histogram, type Registry } from "@prometheus-io/client";
import type { DatabaseTimingObserver } from "./pool.js";

const buckets = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4,
  12.8, 30,
];

/** Register aggregate, content-free timings in one process's private registry. */
export function registerDatabaseMetrics(
  registry: Registry,
): DatabaseTimingObserver {
  const acquisition = new Histogram({
    name: "chalktalk_db_pool_acquire_duration_seconds",
    help: "Client-observed PostgreSQL pool checkout wait and connection setup",
    labelNames: ["outcome"] as const,
    buckets,
    registers: [registry],
  });
  const query = new Histogram({
    name: "chalktalk_db_query_duration_seconds",
    help: "Client-observed PostgreSQL query time, including transport and server work",
    labelNames: ["outcome"] as const,
    buckets,
    registers: [registry],
  });
  return (kind, outcome, seconds) => {
    (kind === "acquire" ? acquisition : query).observe({ outcome }, seconds);
  };
}
