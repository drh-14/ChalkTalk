import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);

test("preflight requires two fresh samples and reports missing series", async () => {
  const { queryPrometheus, verifyMetrics } = require("../../observability/verify-metrics.cjs");
  const now = 1_700_000_000;
  const result = (values) => ({
    status: "success",
    data: { resultType: "matrix", result: [{ metric: {}, values }] },
  });
  const good = async (expression) =>
    expression.startsWith("up{")
      ? result([
          [now - 60, "1"],
          [now, "1"],
        ])
      : result([
          [now - 60, "10"],
          [now, "11"],
        ]);
  await assert.doesNotReject(verifyMetrics(good, now));
  const oneScrape = async (expression) =>
    expression.includes("node_memory_MemAvailable_bytes")
      ? result([[now, "10"]])
      : good(expression);
  await assert.rejects(
    verifyMetrics(oneScrape, now),
    /host memory.*fresh samples/i,
  );
  const stale = async (expression) =>
    expression.includes("node_memory_MemAvailable_bytes")
      ? result([
          [now - 240, "10"],
          [now - 180, "11"],
        ])
      : good(expression);
  await assert.rejects(
    verifyMetrics(stale, now),
    /host memory.*fresh samples/i,
  );
  const down = async (expression) =>
    expression.includes("chalktalk-vm")
      ? result([
          [now - 60, "0"],
          [now, "0"],
        ])
      : good(expression);
  await assert.rejects(verifyMetrics(down, now), /chalktalk-vm.*up=1/i);
  const networkDown = async (expression) =>
    expression === 'up{job="chalktalk-vm-network"}'
      ? result([[now - 60, "0"], [now, "0"]])
      : good(expression);
  await assert.rejects(verifyMetrics(networkDown, now), /chalktalk-vm-network.*up=1/i);
  for (const [label, expression] of [
    ["host CPU", 'node_cpu_seconds_total{job="chalktalk-vm",mode="idle"}'],
    ["host memory available", 'node_memory_MemAvailable_bytes{job="chalktalk-vm"}'],
    ["host memory total", 'node_memory_MemTotal_bytes{job="chalktalk-vm"}'],
    ["host network receive", 'node_network_receive_bytes_total{job="chalktalk-vm-network",device!~"lo|veth.*"}'],
    ["host network transmit", 'node_network_transmit_bytes_total{job="chalktalk-vm-network",device!~"lo|veth.*"}'],
    ["host disk read", 'node_disk_read_bytes_total{job="chalktalk-vm",device!~"loop.*|ram.*"}'],
    ["host disk write", 'node_disk_written_bytes_total{job="chalktalk-vm",device!~"loop.*|ram.*"}'],
    ["host filesystem available", 'node_filesystem_avail_bytes{job="chalktalk-vm",fstype!~"tmpfs|overlay|squashfs",mountpoint!~"/run.*|/host_mnt.*|/oldroot.*|/var/lib/docker/.+"}'],
  ]) {
    const missing = async (requested) =>
      requested === expression ? result([]) : good(requested);
    await assert.rejects(verifyMetrics(missing, now), (error) => {
      assert.match(error.message, new RegExp(`^${label}: fewer than two fresh samples$`));
      return true;
    });
  }

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url));
    return { ok: true, json: async () => result([[now, "1"]]) };
  };
  try {
    await queryPrometheus('up{job="chalktalk-vm"}', now);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/api/v1/query");
  assert.equal(requests[0].searchParams.get("query"), 'up{job="chalktalk-vm"}[3m]');
  assert.equal(requests[0].searchParams.get("time"), String(now));
});
