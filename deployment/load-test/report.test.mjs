import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, queryRunSeries } from "./report.mjs";

const runId = "load-20261117-a1b2c3d4";
const window = { start: "2026-11-17T15:00:00Z", end: "2026-11-17T15:02:00Z" };

test("run-scoped report charts separate latency, request rate, errors and VUs with correct units", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(new URL(url));
    const failureSeries = url.searchParams.get("query").includes("k6_http_req_failed_rate");
    return {
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: {},
              values: [
                [1794927600, failureSeries ? "0" : "0.108"],
                [1794927660, failureSeries ? "100" : "0.250"],
              ],
            },
          ],
        },
      }),
    };
  };
  const data = await queryRunSeries(runId, window, fakeFetch);
  assert.ok(calls.length >= 6);
  for (const call of calls) {
    assert.equal(call.hostname, "127.0.0.1");
    assert.equal(call.pathname, "/api/v1/query_range");
    assert.match(
      call.searchParams.get("query"),
      /testid="load-20261117-a1b2c3d4"/,
    );
    assert.equal(call.searchParams.get("step"), "15");
  }
  const html = buildReport(runId, window, data, {
    metrics: { http_reqs: { values: { count: 10 } } },
  });
  assert.match(html, /Completed requests: 10/);
  assert.match(html, /Mean of tagged expected-response latency percentiles \(ms\)/);
  for (const percentile of [50, 90, 95, 99]) {
    assert.match(html, new RegExp(`Mean tagged P${percentile}: 250 ms`));
  }
  assert.doesNotMatch(html, /<h2>Client latency \(ms\)<\/h2>/);
  assert.match(html, /Request rate \(req\/s\)/);
  assert.match(html, /Maximum tagged HTTP failure fraction \(%\)/);
  assert.match(html, /Maximum tagged failure fraction: 100 %/);
  assert.equal(
    calls.find((call) => call.searchParams.get("query")?.includes("k6_http_req_failed_rate"))
      ?.searchParams.get("query"),
    `100 * max(k6_http_req_failed_rate{testid="${runId}"})`,
  );
  assert.match(html, /Active users \(VUs\)/);
  assert.match(html, /250(?:\.0+)? ms/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /multiple y.ax/i);
});

test("missing required series or unbounded results fail rather than displaying zero", async () => {
  const missing = async () => ({
    ok: true,
    json: async () => ({
      status: "success",
      data: { resultType: "matrix", result: [] },
    }),
  });
  await assert.rejects(queryRunSeries(runId, window, missing), /missing/i);
  const excessive = async () => ({
    ok: true,
    json: async () => ({
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: {},
            values: Array.from({ length: 1000 }, (_, i) => [
              1794927600 + i,
              "1",
            ]),
          },
        ],
      },
    }),
  });
  await assert.rejects(queryRunSeries(runId, window, excessive), /bounded/i);
});
