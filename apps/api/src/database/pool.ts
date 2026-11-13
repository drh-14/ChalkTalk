import { Pool, type PoolClient } from "pg";
import {
  captureRequestDatabaseTiming,
  recordRequestDatabaseTiming,
} from "./request-timing.js";

export type DatabaseTimingObserver = (
  kind: "acquire" | "query",
  outcome: "succeeded" | "failed",
  seconds: number,
) => void;
const instrumentedPools = new WeakMap<
  Pool,
  { observer: DatabaseTimingObserver }
>();

function elapsedSeconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1e9;
}

export function createPool(
  databaseUrl: string,
  observer?: DatabaseTimingObserver,
): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  return observer ? instrumentPool(pool, observer) : pool;
}

/** Attach or replace a process-local observer without altering Pool's public API. */
export function instrumentPool(
  pool: Pool,
  observer: DatabaseTimingObserver,
): Pool {
  const existing = instrumentedPools.get(pool);
  if (existing) {
    existing.observer = observer;
    return pool;
  }
  const state = { observer };
  instrumentedPools.set(pool, state);

  const observe = (
    kind: "acquire" | "query",
    outcome: "succeeded" | "failed",
    started: bigint,
    requestTiming: ReturnType<typeof captureRequestDatabaseTiming>,
  ) => {
    try {
      const seconds = elapsedSeconds(started);
      recordRequestDatabaseTiming(requestTiming, kind, seconds);
      state.observer(kind, outcome, seconds);
    } catch {
      // Telemetry must not change a database operation's result or error.
    }
  };
  const instrumentedClients = new WeakSet<PoolClient>();
  const instrumentClient = (client: PoolClient): PoolClient => {
    if (instrumentedClients.has(client)) return client;
    instrumentedClients.add(client);
    const originalQuery = client.query.bind(client) as (
      ...args: unknown[]
    ) => unknown;
    client.query = ((...args: unknown[]) => {
      const started = process.hrtime.bigint();
      const requestTiming = captureRequestDatabaseTiming();
      let recorded = false;
      const record = (outcome: "succeeded" | "failed") => {
        if (recorded) return;
        recorded = true;
        observe("query", outcome, started, requestTiming);
      };
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      if (typeof callback === "function") {
        args[callbackIndex] = (...callbackArgs: unknown[]) => {
          record(callbackArgs[0] ? "failed" : "succeeded");
          return (callback as (...values: unknown[]) => unknown)(
            ...callbackArgs,
          );
        };
      }
      try {
        const result = originalQuery(...args);
        if (
          typeof callback !== "function" &&
          result &&
          typeof (result as PromiseLike<unknown>).then === "function"
        ) {
          return Promise.resolve(result).then(
            (value) => {
              record("succeeded");
              return value;
            },
            (error) => {
              record("failed");
              throw error;
            },
          );
        }
        return result;
      } catch (error) {
        record("failed");
        throw error;
      }
    }) as PoolClient["query"];
    return client;
  };

  const originalConnect = pool.connect.bind(pool) as (
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      release: (error?: Error) => void,
    ) => void,
  ) => Promise<PoolClient> | void;
  pool.connect = ((
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      release: (error?: Error) => void,
    ) => void,
  ) => {
    const started = process.hrtime.bigint();
    const requestTiming = captureRequestDatabaseTiming();
    if (callback) {
      return originalConnect((error, client, release) => {
        observe(
          "acquire",
          error ? "failed" : "succeeded",
          started,
          requestTiming,
        );
        if (client) instrumentClient(client);
        callback(error, client, release);
      });
    }
    return (originalConnect() as Promise<PoolClient>).then(
      (client) => {
        observe("acquire", "succeeded", started, requestTiming);
        return instrumentClient(client);
      },
      (error) => {
        observe("acquire", "failed", started, requestTiming);
        throw error;
      },
    );
  }) as Pool["connect"];
  return pool;
}
