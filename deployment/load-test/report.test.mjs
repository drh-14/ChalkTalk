import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, queryRunSeries } from "./report.mjs";

const runId = "load-20261117-a1b2c3d4";
const window = { start: "2026-11-17T15:00:00Z", end: "2026-11-17T15:02:00Z" };

test("run-scoped report charts separate latency, request rate, errors and VUs with correct units", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(new URL(url));
    const expression = url.searchParams.get("query");
    const failureSeries = expression.includes("k6_http_req_failed_rate");
    const dbValue = expression.includes("chalktalk_db_")
      ? expression.includes("pool_acquire")
        ? expression.includes("0.95")
          ? "0.04"
          : "0.02"
        : expression.includes("0.95")
          ? "0.03"
          : "0.01"
      : null;
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
                [1794927600, failureSeries ? "0" : (dbValue ?? "0.108")],
                [1794927660, failureSeries ? "100" : (dbValue ?? "0.250")],
              ],
            },
          ],
        },
      }),
    };
  };
  const data = await queryRunSeries(runId, window, fakeFetch);
  assert.equal(calls.length, 11);
  const expressions = calls.map((call) => call.searchParams.get("query"));
  for (const [quantile, histogram] of [
    ["0.5", "chalktalk_db_query_duration_seconds_bucket"],
    ["0.95", "chalktalk_db_query_duration_seconds_bucket"],
    ["0.5", "chalktalk_db_pool_acquire_duration_seconds_bucket"],
    ["0.95", "chalktalk_db_pool_acquire_duration_seconds_bucket"],
  ]) {
    assert.ok(
      expressions.includes(
        `histogram_quantile(${quantile}, sum by (le) (rate(${histogram}{job="chalktalk-api"}[5m])))`,
      ),
    );
  }
  for (const call of calls) {
    assert.equal(call.hostname, "127.0.0.1");
    assert.equal(call.pathname, "/api/v1/query_range");
    if (call.searchParams.get("query").includes("k6_")) {
      assert.match(
        call.searchParams.get("query"),
        /testid="load-20261117-a1b2c3d4"/,
      );
    } else {
      assert.match(call.searchParams.get("query"), /job="chalktalk-api"/);
      assert.doesNotMatch(call.searchParams.get("query"), /testid=/);
      assert.match(call.searchParams.get("query"), /\[5m\]/);
    }
    assert.equal(call.searchParams.get("step"), "15");
  }
  const html = buildReport(runId, window, data, {
    metrics: { http_reqs: { values: { count: 10 } } },
  });
  assert.match(html, /Completed requests: <strong>10<\/strong>/);
  assert.match(
    html,
    /Average of tagged expected-response latency percentiles \(ms\)/,
  );
  for (const percentile of [50, 90, 95, 99]) {
    assert.match(
      html,
      new RegExp(`Average tagged P${percentile}<\\/span><\\/li>`),
    );
  }
  assert.doesNotMatch(html, /<h2>Client latency \(ms\)<\/h2>/);
  assert.match(html, /Request rate \(req\/s\)/);
  assert.match(html, /Maximum tagged HTTP failure fraction \(%\)/);
  assert.match(html, /Maximum tagged failure fraction<\/span><\/li>/);
  assert.equal(
    calls
      .find((call) =>
        call.searchParams.get("query")?.includes("k6_http_req_failed_rate"),
      )
      ?.searchParams.get("query"),
    `100 * max(k6_http_req_failed_rate{testid="${runId}"})`,
  );
  assert.match(html, /Active users \(VUs\)/);
  for (const percentile of [50, 95]) {
    const chart = html.match(
      new RegExp(
        `<article class="chart-card"><h3>P${percentile} database latency \\(ms\\)<\\/h3>([\\s\\S]*?)<\\/article>`,
      ),
    )?.[1];
    assert.ok(chart, `P${percentile} database chart exists`);
    assert.equal((chart.match(/<polyline /g) ?? []).length, 2);
    assert.equal((chart.match(/<li>/g) ?? []).length, 2);
    assert.equal((chart.match(/class="hover-target"/g) ?? []).length, 4);
    assert.match(chart, /Database query time<\/span><\/li>/);
    assert.match(chart, /Pool acquire time<\/span><\/li>/);
    assert.match(
      chart,
      new RegExp(
        `rx="3.5" ry="5" fill="transparent" pointer-events="all"><title>15:01:00 UTC · Pool acquire time: ${percentile === 50 ? 20 : 40} ms<\\/title><\\/ellipse>`,
      ),
    );
  }
  assert.doesNotMatch(html, /Pool wait latency/);
  assert.match(html, /Production-wide API metrics/i);
  assert.doesNotMatch(html, /class="scope"/);
  assert.match(html, /class="hover-target"/);
  assert.doesNotMatch(html, /class="legend-value"/);
  assert.doesNotMatch(html, /class="legend-heading"/);
  assert.doesNotMatch(html, /Source:/);
  assert.match(html, /Overview/);
  assert.match(html, /Timings/);
  assert.doesNotMatch(html, /Mean/);
  assert.doesNotMatch(html, /VM (?:CPU|memory|resources)/i);
  assert.match(html, /250(?:\.0+)? ms/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /multiple y.ax/i);
});

test("coincident point hover lists every series with second-level UTC time", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: {},
            values: [
              [1794927615, "0.01"],
              [1794927630, "0.02"],
            ],
          },
        ],
      },
    }),
  });
  const data = await queryRunSeries(runId, window, fetcher);
  const html = buildReport(runId, window, data, {});
  const databaseChart = html.match(
    /<h3>P50 database latency \(ms\)<\/h3>([\s\S]*?)<\/article>/,
  )?.[1];
  assert.ok(databaseChart);
  assert.equal((databaseChart.match(/class="hover-target"/g) ?? []).length, 2);
  assert.match(
    databaseChart,
    /<title>15:00:15 UTC · Database query time: 10 ms · Pool acquire time: 10 ms<\/title>/,
  );
  const latencyChart = html.match(
    /<h3>Average of tagged expected-response latency percentiles \(ms\)<\/h3>([\s\S]*?)<\/article>/,
  )?.[1];
  assert.ok(latencyChart);
  assert.equal((latencyChart.match(/class="hover-target"/g) ?? []).length, 2);
  assert.match(
    latencyChart,
    /<title>15:00:15 UTC · Average tagged P50: 10 ms · Average tagged P90: 10 ms · Average tagged P95: 10 ms · Average tagged P99: 10 ms<\/title>/,
  );
  assert.match(html, /<title>15:00:15 UTC · Requests: 0.01 req\/s<\/title>/);
});

test("near-coincident point targets expose both values without crossing timestamps", () => {
  const first = 1794927615;
  const second = first + 15;
  const points = [
    [first, 10],
    [second, 20],
  ];
  const keys = [
    "p50",
    "p90",
    "p95",
    "p99",
    "rate",
    "errors",
    "vus",
    "dbQueryP50",
    "dbQueryP95",
    "poolAcquireP50",
    "poolAcquireP95",
  ];
  const data = Object.fromEntries(keys.map((key) => [key, points]));
  data.p50 = [
    [first, 100],
    [second, 110],
  ];
  data.p90 = [
    [first, 101],
    [second, 111],
  ];
  data.dbQueryP50 = [
    [first, 100],
    [second, 110],
  ];
  data.poolAcquireP50 = [
    [first, 101],
    [second, 111],
  ];
  data.dbQueryP95 = [
    [first, 120],
    [second, 130],
  ];
  data.poolAcquireP95 = [
    [first, 121],
    [second, 131],
  ];
  const html = buildReport(
    runId,
    { start: window.start, end: "2026-11-17T15:15:00Z" },
    data,
    {},
  );
  for (const [percentile, query, pool] of [
    [50, 100, 101],
    [95, 120, 121],
  ]) {
    const chart = html.match(
      new RegExp(
        `<h3>P${percentile} database latency \\(ms\\)<\\/h3>([\\s\\S]*?)<\\/article>`,
      ),
    )?.[1];
    assert.ok(chart);
    const hits = [
      ...chart.matchAll(
        /<ellipse cx="([^"]+)" cy="([^"]+)" rx="([^"]+)" ry="([^"]+)"/g,
      ),
    ];
    assert.equal(hits.length, 4);
    assert.equal(hits[0][1], hits[1][1]);
    assert.ok(
      Math.abs(Number(hits[0][2]) - Number(hits[1][2])) <
        2 * Number(hits[0][4]),
    );
    const titles = [
      ...chart.matchAll(/<ellipse[^>]*><title>([^<]+)<\/title><\/ellipse>/g),
    ]
      .map((match) => match[1])
      .filter((title) => title.startsWith("15:00:15 UTC"));
    assert.equal(titles.length, 2);
    for (const title of titles) {
      assert.match(title, new RegExp(`Database query time: ${query} ms`));
      assert.match(title, new RegExp(`Pool acquire time: ${pool} ms`));
    }
  }
  const clientChart = html.match(
    /<h3>Average of tagged expected-response latency percentiles \(ms\)<\/h3>([\s\S]*?)<\/article>/,
  )?.[1];
  assert.ok(clientChart);
  const nearClientTitles = [
    ...clientChart.matchAll(
      /<ellipse[^>]*><title>([^<]+)<\/title><\/ellipse>/g,
    ),
  ]
    .map((match) => match[1])
    .filter(
      (title) => title.startsWith("15:00:15 UTC") && title.includes("P50"),
    );
  assert.equal(nearClientTitles.length, 2);
  for (const title of nearClientTitles) {
    assert.match(title, /Average tagged P50: 100 ms/);
    assert.match(title, /Average tagged P90: 101 ms/);
  }
  const rateChart = html.match(
    /<h3>Request rate \(req\/s\)<\/h3>([\s\S]*?)<\/article>/,
  )?.[1];
  assert.ok(rateChart);
  const hits = [
    ...rateChart.matchAll(/<ellipse cx="([^"]+)" cy="[^"]+" rx="([^"]+)"/g),
  ];
  assert.equal(hits.length, 2);
  assert.ok(Number(hits[1][1]) - Number(hits[0][1]) > 2 * Number(hits[0][2]));
  assert.doesNotMatch(html, /<rect\b|<script\b/i);
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

test("missing DB telemetry fails the report instead of inventing zero latency", async () => {
  const queries = [];
  const fetcher = async (url) => {
    const expression = url.searchParams.get("query");
    queries.push(expression);
    return {
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: expression.includes(
            "chalktalk_db_query_duration_seconds_bucket",
          )
            ? []
            : [
                {
                  metric: {},
                  values: [
                    [1794927600, "0.1"],
                    [1794927660, "0.2"],
                  ],
                },
              ],
        },
      }),
    };
  };
  await assert.rejects(
    queryRunSeries(runId, window, fetcher),
    /dbQueryP50: missing/i,
  );
  assert.equal(queries.length, 8);
});

test("idle DB histogram NaN samples are omitted, never rendered as zero", async () => {
  const fetcher = async (url) => {
    const isDatabase = url.searchParams.get("query").includes("chalktalk_db_");
    return {
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: {},
              values: isDatabase
                ? [
                    [1794927600, "NaN"],
                    [1794927615, "0.01"],
                    [1794927630, "0.02"],
                  ]
                : [
                    [1794927600, "0.1"],
                    [1794927630, "0.2"],
                  ],
            },
          ],
        },
      }),
    };
  };
  const data = await queryRunSeries(runId, window, fetcher);
  assert.deepEqual(data.dbQueryP50, [
    [1794927615, 10],
    [1794927630, 20],
  ]);
  assert.deepEqual(data.poolAcquireP95, [
    [1794927615, 10],
    [1794927630, 20],
  ]);
  const html = buildReport(runId, window, data, {});
  assert.match(html, /P50 database latency \(ms\)/);
  assert.match(html, /P95 database latency \(ms\)/);
  assert.doesNotMatch(html, /NaN/);
});
