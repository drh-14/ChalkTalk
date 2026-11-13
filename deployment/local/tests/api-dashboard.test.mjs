import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { test } from "node:test";

const series = [
  ['chalktalk_http_requests_total{outcome="completed",status_class="2xx"}', 8],
  ['chalktalk_http_requests_total{outcome="completed",status_class="5xx"}', 2],
  ['chalktalk_http_requests_total{outcome="aborted",status_class="other"}', 90],
  ...[
    ["0.1", 2, 90],
    ["0.2", 6, 90],
    ["0.4", 8, 90],
    ["1", 10, 90],
    ["+Inf", 10, 90],
  ].flatMap(([le, completed, aborted]) => [
    [
      `chalktalk_http_request_duration_seconds_bucket{outcome="completed",le="${le}"}`,
      completed,
    ],
    [
      `chalktalk_http_request_duration_seconds_bucket{outcome="aborted",le="${le}"}`,
      aborted,
    ],
  ]),
  ['chalktalk_http_request_duration_seconds_count{outcome="completed"}', 10],
  ['chalktalk_http_request_duration_seconds_count{outcome="aborted"}', 90],
];

test("dashboard PromQL computes completed-request indicators", async () => {
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const panels = new Map(dashboard.panels.map((panel) => [panel.id, panel]));
  const expected = new Map([
    [1, 100 / 60],
    [2, 0.2],
    [3, 0.175],
    [4, 0.85],
    [5, 0.97],
    [6, 0.6],
  ]);
  const fixture = [
    "rule_files: []",
    "evaluation_interval: 1m",
    "tests:",
    "  - interval: 1m",
    "    input_series:",
    ...series.flatMap(([name, increment]) => [
      `      - series: '${name}'`,
      `        values: '0+${increment}x6'`,
    ]),
    "    promql_expr_test:",
    ...Array.from(expected, ([id, value]) => {
      const expression = panels.get(id)?.targets[0]?.expr;
      assert.equal(
        typeof expression,
        "string",
        `Missing panel ${id} expression`,
      );
      return [
        `      - expr: ${JSON.stringify(`abs((${expression}) - ${value}) < bool 1e-12`)}`,
        "        eval_time: 6m",
        "        exp_samples:",
        "          - labels: '{}'",
        "            value: 1",
      ];
    }).flat(),
  ].join("\n");
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".promql-test-"),
  );
  try {
    await chmod(directory, 0o755);
    await writeFile(join(directory, "test.yml"), fixture);
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--mount",
        `type=bind,source=${directory},target=/fixture,readonly`,
        "--entrypoint",
        "/bin/promtool",
        "prom/prometheus:v3.3.1",
        "test",
        "rules",
        "/fixture/test.yml",
      ],
      { encoding: "utf8" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard overlays database timings on matching HTTP percentiles", () => {
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const panels = new Map(dashboard.panels.map((panel) => [panel.id, panel]));
  for (const [id, percentile] of [
    [3, "p50"],
    [4, "p95"],
  ]) {
    const panel = panels.get(id);
    assert.equal(panel.title, `${percentile} API and database latency`);
    assert.equal(panel.fieldConfig.defaults.unit, "s");
    assert.deepEqual(
      panel.targets.map(({ refId, legendFormat }) => [refId, legendFormat]),
      [
        ["A", "API request"],
        ["B", "DB query ({{job}})"],
        ["C", "DB pool wait ({{job}})"],
      ],
    );
  }
  for (const id of [16, 17, 18, 19]) assert.equal(panels.has(id), false);
});

test("critical endpoint panels compare request, query-total, and pool-total percentiles", () => {
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const panels = new Map(dashboard.panels.map((panel) => [panel.id, panel]));
  const expected = [
    [22, "Login latency", [["login", "Login", "POST", "/api/v1/sessions"]]],
    [
      23,
      "Course creation latency",
      [
        [
          "course_create",
          "Course create",
          "POST",
          "/api/v1/organizations/:organizationId/courses",
        ],
      ],
    ],
    [
      24,
      "Notification fetching latency",
      [
        [
          "notifications_list",
          "Notification list",
          "GET",
          "/api/v1/users/me/notifications",
        ],
        [
          "notifications_unread_count",
          "Unread count",
          "GET",
          "/api/v1/users/me/notifications/unread-count",
        ],
      ],
    ],
  ];
  for (const [id, title, operations] of expected) {
    const panel = panels.get(id);
    assert.equal(panel?.title, title);
    assert.equal(panel.fieldConfig.defaults.unit, "s");
    assert.equal(panel.targets.length, operations.length * 6);
    for (const [
      index,
      [operation, label, method, route],
    ] of operations.entries()) {
      const targets = panel.targets.slice(index * 6, index * 6 + 6);
      assert.deepEqual(
        targets.map(({ legendFormat }) => legendFormat),
        [
          `${label} HTTP p50`,
          `${label} HTTP p95`,
          `${label} DB query total p50`,
          `${label} DB query total p95`,
          `${label} DB pool total p50`,
          `${label} DB pool total p95`,
        ],
      );
      for (const [targetIndex, target] of targets.entries()) {
        assert.match(target.expr, /outcome="completed"/);
        assert.match(target.expr, /histogram_quantile\(0\.(5|95),/);
        if (targetIndex < 2) {
          assert.ok(
            target.expr.includes(`method="${method}",route="${route}"`),
          );
        } else {
          assert.ok(target.expr.includes(`operation="${operation}"`));
        }
      }
    }
  }
});

test("critical endpoint PromQL computes completed-request totals without aborted traffic", async () => {
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const targets = dashboard.panels.find((panel) => panel.id === 22)?.targets;
  assert.equal(targets?.length, 6);
  const samples = [
    ...[
      ["0.1", 5],
      ["0.2", 10],
      ["+Inf", 10],
    ].map(([le, count]) => [
      `chalktalk_http_request_duration_seconds_bucket{method="POST",route="/api/v1/sessions",outcome="completed",le="${le}"}`,
      count,
    ]),
    ...[
      ["0", 2],
      ["0.05", 6],
      ["0.1", 10],
      ["+Inf", 10],
    ].map(([le, count]) => [
      `chalktalk_request_db_query_total_duration_seconds_bucket{operation="login",outcome="completed",le="${le}"}`,
      count,
    ]),
    ...[
      ["0", 5],
      ["0.01", 10],
      ["+Inf", 10],
    ].map(([le, count]) => [
      `chalktalk_request_db_pool_acquire_total_duration_seconds_bucket{operation="login",outcome="completed",le="${le}"}`,
      count,
    ]),
    [
      'chalktalk_http_request_duration_seconds_bucket{method="POST",route="/api/v1/sessions",outcome="aborted",le="+Inf"}',
      100,
    ],
  ];
  const expected = [0.1, 0.19, 0.0375, 0.09375, 0, 0.009];
  const fixture = [
    "rule_files: []",
    "evaluation_interval: 1m",
    "tests:",
    "  - interval: 1m",
    "    input_series:",
    ...samples.flatMap(([name, count]) => [
      `      - series: '${name}'`,
      `        values: '0+${count}x6'`,
    ]),
    "    promql_expr_test:",
    ...expected.flatMap((value, index) => [
      `      - expr: ${JSON.stringify(`abs((${targets[index].expr}) - ${value}) < bool 1e-10`)}`,
      "        eval_time: 6m",
      "        exp_samples:",
      "          - labels: '{}'",
      "            value: 1",
    ]),
  ].join("\n");
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".endpoint-promql-test-"),
  );
  try {
    await chmod(directory, 0o755);
    await writeFile(join(directory, "test.yml"), fixture);
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--mount",
        `type=bind,source=${directory},target=/fixture,readonly`,
        "--entrypoint",
        "/bin/promtool",
        "prom/prometheus:v3.3.1",
        "test",
        "rules",
        "/fixture/test.yml",
      ],
      { encoding: "utf8" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard PromQL computes database wait, query, and failure indicators", async () => {
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const panels = new Map(dashboard.panels.map((panel) => [panel.id, panel]));
  const series = [
    ...[
      ["0.05", 2],
      ["0.1", 6],
      ["0.2", 9],
      ["+Inf", 9],
    ].map(([le, value]) => [
      `chalktalk_db_query_duration_seconds_bucket{job="api",outcome="succeeded",le="${le}"}`,
      value,
    ]),
    ...[
      ["0.05", 0],
      ["0.1", 0],
      ["0.2", 1],
      ["+Inf", 1],
    ].map(([le, value]) => [
      `chalktalk_db_query_duration_seconds_bucket{job="api",outcome="failed",le="${le}"}`,
      value,
    ]),
    ...[
      ["0.01", 2],
      ["0.05", 7],
      ["0.1", 9],
      ["+Inf", 9],
    ].map(([le, value]) => [
      `chalktalk_db_pool_acquire_duration_seconds_bucket{job="api",outcome="succeeded",le="${le}"}`,
      value,
    ]),
    ...[
      ["0.01", 0],
      ["0.05", 0],
      ["0.1", 1],
      ["+Inf", 1],
    ].map(([le, value]) => [
      `chalktalk_db_pool_acquire_duration_seconds_bucket{job="api",outcome="failed",le="${le}"}`,
      value,
    ]),
    [
      'chalktalk_db_query_duration_seconds_count{job="api",outcome="succeeded"}',
      9,
    ],
    [
      'chalktalk_db_query_duration_seconds_count{job="api",outcome="failed"}',
      1,
    ],
    [
      'chalktalk_db_pool_acquire_duration_seconds_count{job="api",outcome="failed"}',
      1,
    ],
  ];
  const expected = [
    [3, 1, 0.0875],
    [4, 1, 0.1875],
    [3, 2, 0.034],
    [4, 2, 0.05 + (2.5 / 3) * 0.05],
    [20, 0, 11 / 60],
    [21, 0, 2 / 11],
  ];
  const fixture = [
    "rule_files: []",
    "evaluation_interval: 1m",
    "tests:",
    "  - interval: 1m",
    "    input_series:",
    ...series.flatMap(([name, increment]) => [
      `      - series: '${name}'`,
      `        values: '0+${increment}x6'`,
    ]),
    "    promql_expr_test:",
    ...expected
      .map(([id, target, value]) => {
        const expression = panels.get(id)?.targets[target]?.expr;
        assert.equal(typeof expression, "string", `Missing panel ${id}`);
        return [
          `      - expr: ${JSON.stringify(`abs((${expression}) - ${value}) < bool 1e-10`)}`,
          "        eval_time: 6m",
          "        exp_samples:",
          "          - labels: '{job=\"api\"}'",
          "            value: 1",
        ];
      })
      .flat(),
    "  - interval: 1m",
    "    input_series:",
    '      - series: \'chalktalk_db_query_duration_seconds_count{job="worker",outcome="succeeded"}\'',
    "        values: '0+9x6'",
    "    promql_expr_test:",
    `      - expr: ${JSON.stringify(panels.get(21)?.targets[0]?.expr)}`,
    "        eval_time: 6m",
    "        exp_samples:",
    "          - labels: '{job=\"worker\"}'",
    "            value: 0",
    "  - interval: 1m",
    "    input_series:",
    '      - series: \'chalktalk_db_pool_acquire_duration_seconds_count{job="collaboration",outcome="failed"}\'',
    "        values: '0+2x6'",
    "    promql_expr_test:",
    `      - expr: ${JSON.stringify(`abs((${panels.get(20)?.targets[0]?.expr}) - ${2 / 60}) < bool 1e-10`)}`,
    "        eval_time: 6m",
    "        exp_samples:",
    "          - labels: '{job=\"collaboration\"}'",
    "            value: 1",
    `      - expr: ${JSON.stringify(panels.get(21)?.targets[0]?.expr)}`,
    "        eval_time: 6m",
    "        exp_samples:",
    "          - labels: '{job=\"collaboration\"}'",
    "            value: 1",
  ].join("\n");
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".db-promql-test-"),
  );
  try {
    await chmod(directory, 0o755);
    await writeFile(join(directory, "test.yml"), fixture);
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--mount",
        `type=bind,source=${directory},target=/fixture,readonly`,
        "--entrypoint",
        "/bin/promtool",
        "prom/prometheus:v3.3.1",
        "test",
        "rules",
        "/fixture/test.yml",
      ],
      { encoding: "utf8" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
