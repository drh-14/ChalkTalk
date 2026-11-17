/* global process, URL, fetch, AbortSignal */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { verifyMetrics } = require("../observability/verify-metrics.cjs");

export async function verifyLoadMetrics(
  query,
  runId,
  now = Math.floor(Date.now() / 1000),
  includeK6 = true,
) {
  await verifyMetrics(query, now);
  if (!includeK6) return;
  if (!/^load-[0-9]{8}-[a-z0-9]{8,32}$/.test(runId))
    throw new Error("Invalid run ID");
  for (const metric of [
    "k6_http_reqs_total",
    "k6_http_req_duration_p95",
    "k6_vus",
  ]) {
    const response = await query(`${metric}{testid="${runId}"}`, now);
    if (
      response.status !== "success" ||
      response.data?.resultType !== "matrix" ||
      !response.data.result.some(
        ({ values }) =>
          values.filter(
            ([time, value]) =>
              time >= now - 150 &&
              time <= now + 15 &&
              Number.isFinite(Number(value)),
          ).length >= 2,
      )
    )
      throw new Error(`${metric}: fewer than two fresh k6 samples`);
    process.stdout.write(`${metric}: two fresh samples for ${runId}\n`);
  }
}

export async function queryTunnel(expression, now) {
  const url = new URL("http://127.0.0.1:19090/api/v1/query");
  url.searchParams.set("query", `${expression}[3m]`);
  url.searchParams.set("time", String(now));
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok)
    throw new Error(`Prometheus tunnel returned ${response.status}`);
  return response.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [phase, runId] = process.argv.slice(2);
  if (!["app", "all"].includes(phase))
    throw new Error("Usage: node preflight.mjs app|all <run-id>");
  verifyLoadMetrics(queryTunnel, runId, undefined, phase === "all").catch(
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
