import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLoadMetrics } from "./preflight.mjs";

const now = 1_700_000_000;
const sample = (value = "1") => ({
  status: "success",
  data: {
    resultType: "matrix",
    result: [
      {
        metric: {},
        values: [
          [now - 60, value],
          [now, value],
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
