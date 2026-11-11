import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import request from "supertest";
import { createPool } from "./pool.js";
import {
  createObservability,
  createWorkerMetricsApp,
} from "../observability/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

type Observation = {
  kind: "acquire" | "query";
  outcome: "succeeded" | "failed";
  seconds: number;
};

integration("database latency instrumentation", () => {
  const pools: Pool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it("observes pooled and checked-out queries exactly once", async () => {
    const observations: Observation[] = [];
    const pool = createPool(databaseUrl!, (kind, outcome, seconds) => {
      observations.push({ kind, outcome, seconds });
    });
    pools.push(pool);

    expect(
      (await pool.query<{ value: number }>("SELECT 1 AS value")).rows,
    ).toEqual([{ value: 1 }]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      expect(
        (await client.query<{ value: number }>("SELECT 2 AS value")).rows,
      ).toEqual([{ value: 2 }]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    expect(observations.filter((item) => item.kind === "acquire")).toHaveLength(
      2,
    );
    expect(observations.filter((item) => item.kind === "query")).toHaveLength(
      4,
    );
    expect(observations.every((item) => item.outcome === "succeeded")).toBe(
      true,
    );
    expect(
      observations.every(
        (item) => Number.isFinite(item.seconds) && item.seconds >= 0,
      ),
    ).toBe(true);
  });

  it("preserves callback and config overloads and records failed queries", async () => {
    const observations: Observation[] = [];
    const pool = createPool(databaseUrl!, (kind, outcome, seconds) => {
      observations.push({ kind, outcome, seconds });
    });
    pools.push(pool);

    const pooled = await new Promise<number>((resolve, reject) => {
      pool.query<{ value: number }>(
        "SELECT $1::int AS value",
        [3],
        (error, result) =>
          error ? reject(error) : resolve(result.rows[0]!.value),
      );
    });
    expect(pooled).toBe(3);
    const client = await pool.connect();
    try {
      const checkedOut = await new Promise<number>((resolve, reject) => {
        client.query<{ value: number }>(
          { text: "SELECT $1::int AS value", values: [4] },
          (error, result) =>
            error ? reject(error) : resolve(result.rows[0]!.value),
        );
      });
      expect(checkedOut).toBe(4);
      await expect(
        client.query("SELECT * FROM nonexistent_private_table"),
      ).rejects.toMatchObject({ code: "42P01" });
    } finally {
      client.release();
    }
    expect(observations.filter((item) => item.kind === "acquire")).toHaveLength(
      2,
    );
    expect(
      observations.filter(
        (item) => item.kind === "query" && item.outcome === "succeeded",
      ),
    ).toHaveLength(2);
    expect(
      observations.filter(
        (item) => item.kind === "query" && item.outcome === "failed",
      ),
    ).toHaveLength(1);
  });

  it("measures a contended checkout separately from its query", async () => {
    const observations: Observation[] = [];
    const pool = createPool(databaseUrl!, (kind, outcome, seconds) => {
      observations.push({ kind, outcome, seconds });
    });
    pools.push(pool);
    pool.options.max = 1;

    const first = await pool.connect();
    const pending = pool.query("SELECT 1");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(observations.filter((item) => item.kind === "query")).toHaveLength(
      0,
    );
    first.release();
    await pending;
    expect(
      observations.filter((item) => item.kind === "acquire")[1]!.seconds,
    ).toBeGreaterThanOrEqual(0.03);
    expect(observations.filter((item) => item.kind === "query")).toHaveLength(
      1,
    );
  });

  it("records a failed connection but not a query that never started", async () => {
    const observations: Observation[] = [];
    const pool = createPool(
      "postgres://postgres:test@127.0.0.1:1/chalktalk",
      (kind, outcome, seconds) => {
        observations.push({ kind, outcome, seconds });
      },
    );
    pools.push(pool);
    await expect(pool.query("SELECT 1")).rejects.toThrow();
    expect(observations.map(({ kind, outcome }) => [kind, outcome])).toEqual([
      ["acquire", "failed"],
    ]);
  });

  it("records query timeouts and connection drops as failed queries", async () => {
    const observations: Observation[] = [];
    const pool = createPool(databaseUrl!, (kind, outcome, seconds) => {
      observations.push({ kind, outcome, seconds });
    });
    pools.push(pool);
    await expect(
      pool.query({ text: "SELECT pg_sleep(0.2)", query_timeout: 20 }),
    ).rejects.toThrow();
    expect(
      observations.filter(
        (item) => item.kind === "query" && item.outcome === "failed",
      ),
    ).toHaveLength(1);

    await expect(
      pool.query("SELECT pg_terminate_backend(pg_backend_pid())"),
    ).rejects.toThrow();
    expect(
      observations.filter(
        (item) => item.kind === "query" && item.outcome === "failed",
      ),
    ).toHaveLength(2);
  });

  it("keeps database operations working with disabled or failing telemetry", async () => {
    const plain = createPool(databaseUrl!);
    pools.push(plain);
    expect(
      (await plain.query<{ value: number }>("SELECT 5 AS value")).rows,
    ).toEqual([{ value: 5 }]);

    const pool = createPool(databaseUrl!, () => {
      throw new Error("metrics unavailable");
    });
    pools.push(pool);
    expect(
      (await pool.query<{ value: number }>("SELECT 6 AS value")).rows,
    ).toEqual([{ value: 6 }]);
    await expect(
      pool.query("SELECT * FROM nonexistent_private_table"),
    ).rejects.toMatchObject({ code: "42P01" });
  });

  it("exposes real pooled-query activity only through an authorized worker scrape", async () => {
    const observability = createObservability({
      token: "db-integration-token-long-enough!",
      stdout: () => {},
    });
    const pool = createPool(databaseUrl!, observability.databaseObserver);
    pools.push(pool);
    await pool.query("SELECT 1");
    const app = createWorkerMetricsApp(observability);
    expect((await request(app).get("/metrics")).status).toBe(401);
    const scrape = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer db-integration-token-long-enough!");
    expect(scrape.status).toBe(200);
    expect(scrape.text).toContain(
      'chalktalk_db_pool_acquire_duration_seconds_count{outcome="succeeded"} 1',
    );
    expect(scrape.text).toContain(
      'chalktalk_db_query_duration_seconds_count{outcome="succeeded"} 1',
    );
    await observability.close();
  });
});
