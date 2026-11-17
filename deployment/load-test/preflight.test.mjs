import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLoadMetrics, waitForScrapeTargets } from "./preflight.mjs";

const now = 1_700_000_000;
const sample = (value = "1", at = now) => ({
  status: "success",
  data: {
    resultType: "matrix",
    result: [
      {
        metric: {},
        values: [
          [at - 60, value],
          [at, value],
        ],
      },
    ],
  },
});

test("preflight requires fresh app, DB, VM, and k6 samples for the exact run", async () => {
  const expressions = [];
  await verifyLoadMetrics(
    async (expr) => {
      expressions.push(expr);
      return sample();
    },
    "load-20261117-a1b2c3d4",
    now,
    true,
  );
  assert.ok(
    expressions.some((e) =>
      e.includes('k6_http_reqs_total{testid="load-20261117-a1b2c3d4"}'),
    ),
  );
  assert.ok(
    expressions.some((e) =>
      e.includes("chalktalk_db_pool_acquire_duration_seconds_bucket"),
    ),
  );
  assert.ok(
    expressions.some((e) => e.includes("node_memory_MemAvailable_bytes")),
  );
  await assert.rejects(
    verifyLoadMetrics(
      async (expr) =>
        expr.startsWith("k6_")
          ? { status: "success", data: { resultType: "matrix", result: [] } }
          : sample(),
      "load-20261117-a1b2c3d4",
      now,
      true,
    ),
    /k6.*fresh/i,
  );
});

test("an idle API with healthy scrapes is ready before HTTP or DB histogram samples exist", async () => {
  const expressions = [];
  await waitForScrapeTargets(
    async (expression) => {
      expressions.push(expression);
      return sample("1", Math.floor(Date.now() / 1000));
    },
    { timeoutMs: 0, pollIntervalMs: 0 },
  );
  assert.deepEqual(expressions, [
    'up{job="chalktalk-api"}',
    'up{job="chalktalk-worker"}',
    'up{job="chalktalk-collaboration"}',
    'up{job="chalktalk-vm"}',
    'up{job="chalktalk-vm-network"}',
  ]);
});

test("recently restarted Prometheus waits for a second fresh successful scrape", async () => {
  let apiQueries = 0;
  await waitForScrapeTargets(
    async (expression) => {
      if (expression === 'up{job="chalktalk-api"}') {
        apiQueries++;
        if (apiQueries === 1)
          return {
            status: "success",
            data: {
              resultType: "matrix",
              result: [
                {
                  values: [[Math.floor(Date.now() / 1000), "1"]],
                },
              ],
            },
          };
      }
      return sample("1", Math.floor(Date.now() / 1000));
    },
    { timeoutMs: 100, pollIntervalMs: 0 },
  );
  assert.equal(apiQueries, 2);
});

test("an unhealthy target times out with its name and never passes readiness", async () => {
  await assert.rejects(
    waitForScrapeTargets(
      async (expression) =>
        expression === 'up{job="chalktalk-worker"}'
          ? sample("0", Math.floor(Date.now() / 1000))
          : sample("1", Math.floor(Date.now() / 1000)),
      { timeoutMs: 0, pollIntervalMs: 0 },
    ),
    /Scrape readiness timed out: chalktalk-worker: up=1 not observed with fresh samples/,
  );
});

test("a recovery needs two successful scrapes, not one down and one up", async () => {
  await assert.rejects(
    waitForScrapeTargets(
      async (expression) =>
        expression === 'up{job="chalktalk-api"}'
          ? {
              status: "success",
              data: {
                resultType: "matrix",
                result: [
                  {
                    values: [
                      [Math.floor(Date.now() / 1000) - 60, "0"],
                      [Math.floor(Date.now() / 1000), "1"],
                    ],
                  },
                ],
              },
            }
          : sample("1", Math.floor(Date.now() / 1000)),
      { timeoutMs: 0, pollIntervalMs: 0 },
    ),
    /chalktalk-api: up=1 not observed with fresh samples/,
  );
});

test("post-smoke verification rejects missing HTTP and DB-client latency series", async () => {
  for (const missing of [
    "chalktalk_http_request_duration_seconds_bucket",
    "chalktalk_db_query_duration_seconds_bucket",
    "chalktalk_db_pool_acquire_duration_seconds_bucket",
  ]) {
    await assert.rejects(
      verifyLoadMetrics(
        async (expression) =>
          expression.startsWith(missing)
            ? { status: "success", data: { resultType: "matrix", result: [] } }
            : sample(),
        "load-20261117-a1b2c3d4",
        now,
      ),
      /fewer than two fresh samples/,
      missing,
    );
  }
});
