import { Registry } from "@prometheus-io/client";
import { describe, expect, it } from "vitest";
import { registerDatabaseMetrics } from "./metrics.js";

describe("database latency metrics", () => {
  it("records bounded timing series without query content or identities", async () => {
    const registry = new Registry();
    const observe = registerDatabaseMetrics(registry);
    observe("acquire", "succeeded", 0.015);
    observe("query", "succeeded", 0.084);
    observe("query", "failed", 0.31);

    const text = await registry.metrics();
    expect(text).toContain(
      'chalktalk_db_pool_acquire_duration_seconds_count{outcome="succeeded"} 1',
    );
    expect(text).toContain(
      'chalktalk_db_query_duration_seconds_count{outcome="succeeded"} 1',
    );
    expect(text).toContain(
      'chalktalk_db_query_duration_seconds_count{outcome="failed"} 1',
    );
    expect(text).toContain(
      'chalktalk_db_query_duration_seconds_bucket{le="0.1",outcome="succeeded"} 1',
    );
    expect(text).not.toMatch(/query_text|course_id|user_id|sql|secret/);
  });
});
