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
    [25, 0.7],
    [4, 0.85],
    [5, 0.97],
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

test("dashboard consolidates four latency overlays and removes redundant indicators", async () => {
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
  const percentiles = [
    [3, "P50", [0.2, 0.06, 0.01]],
    [25, "P90", [0.7, 0.21, 0.0375]],
    [4, "P95", [0.85, 0.255, 0.04375]],
    [5, "P99", [0.97, 0.291, 0.04875]],
  ];
  for (const [id, percentile] of percentiles) {
    const panel = panels.get(id);
    assert.equal(panel.title, `${percentile} latency`);
    assert.equal(panel.fieldConfig.defaults.unit, "s");
    assert.equal(panel.targets.length, 3);
    assert.deepEqual(
      panel.targets.map(({ refId, legendFormat }) => [refId, legendFormat]),
      [
        ["A", "API response"],
        ["B", "Database query ({{job}})"],
        ["C", "Connection wait ({{job}})"],
      ],
    );
  }
  assert.equal(panels.has(6), false);
  assert.equal(panels.get(2).options.legend.showLegend, false);
  for (const id of [16, 17, 18, 19]) assert.equal(panels.has(id), false);
  const histograms = [
    ["chalktalk_http_request_duration_seconds_bucket", ["0.1", "0.2", "0.4", "1", "+Inf"], "outcome=\"completed\""],
    ["chalktalk_db_query_duration_seconds_bucket", ["0.02", "0.06", "0.12", "0.3", "+Inf"], "job=\"api\""],
    ["chalktalk_db_pool_acquire_duration_seconds_bucket", ["0.005", "0.01", "0.025", "0.05", "+Inf"], "job=\"api\""],
  ];
  const fixture = [
    "rule_files: []",
    "evaluation_interval: 1m",
    "tests:",
    "  - interval: 1m",
    "    input_series:",
    ...histograms.flatMap(([metric, buckets, labels]) =>
      buckets.flatMap((le, index) => [
        `      - series: '${metric}{${labels},le="${le}"}'`,
        `        values: '0+${[2, 5, 8, 10, 10][index]}x6'`,
      ]),
    ),
    "    promql_expr_test:",
    ...percentiles.flatMap(([id, , values]) =>
      values.flatMap((value, index) => {
        const expression = panels.get(id).targets[index].expr;
        return [
          `      - expr: ${JSON.stringify(`abs((${expression}) - ${value}) < bool 1e-10`)}`,
          "        eval_time: 6m",
          "        exp_samples:",
          `          - labels: '${index === 0 ? "{}" : '{job="api"}'}'`,
          "            value: 1",
        ];
      }),
    ),
  ].join("\n");
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".overlay-promql-test-"),
  );
  try {
    await chmod(directory, 0o755);
    await writeFile(join(directory, "test.yml"), fixture);
    execFileSync(
      "docker",
      [
        "run", "--rm", "--pull", "never", "--network", "none",
        "--mount", `type=bind,source=${directory},target=/fixture,readonly`,
        "--entrypoint", "/bin/promtool", "prom/prometheus:v3.3.1",
        "test", "rules", "/fixture/test.yml",
      ],
      { encoding: "utf8" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("all visible metric series use understandable legend names", () => {
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
  for (const panel of dashboard.panels.filter(
    (panel) => panel.type === "timeseries" && panel.id !== 2,
  )) {
    for (const target of panel.targets) {
      assert.match(
        target.legendFormat ?? "",
        /[A-Za-z]{3,}/,
        `${panel.title}: ${target.refId}`,
      );
      assert.doesNotMatch(target.legendFormat, /\b(?:HTTP|DB|Series [A-Z])\b/);
    }
  }
  assert.deepEqual(
    panels.get(10).targets.map((target) => target.legendFormat),
    ["Lost log events", "Evicted log events (delivery uncertain)"],
  );
  assert.deepEqual(
    panels.get(12).targets.map((target) => target.legendFormat),
    ["Live connections", "Open documents"],
  );
  assert.deepEqual(
    panels.get(15).targets.map((target) => target.legendFormat),
    ["Rejected updates", "Sessions ended ({{reason}})"],
  );
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
          "Course creation",
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
          `${label} response P50`,
          `${label} response P95`,
          `${label} total query time P50`,
          `${label} total query time P95`,
          `${label} total connection wait P50`,
          `${label} total connection wait P95`,
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
  const operations = [
    [22, 0, "login", "POST", "/api/v1/sessions"],
    [23, 0, "course_create", "POST", "/api/v1/organizations/:organizationId/courses"],
    [24, 0, "notifications_list", "GET", "/api/v1/users/me/notifications"],
    [24, 6, "notifications_unread_count", "GET", "/api/v1/users/me/notifications/unread-count"],
  ];
  const samples = operations.flatMap(([, , operation, method, route], index) => {
    const scale = index + 1;
    return [
      ...[[0.1, 5], [0.2, 10], ["+Inf", 10]].map(([le, count]) => [
        `chalktalk_http_request_duration_seconds_bucket{method="${method}",route="${route}",outcome="completed",le="${le === "+Inf" ? le : le * scale}"}`,
        count,
      ]),
      ...[[0, 2], [0.05, 6], [0.1, 10], ["+Inf", 10]].map(([le, count]) => [
        `chalktalk_request_db_query_total_duration_seconds_bucket{operation="${operation}",outcome="completed",le="${le === "+Inf" ? le : le * scale}"}`,
        count,
      ]),
      ...[[0, 5], [0.01, 10], ["+Inf", 10]].map(([le, count]) => [
        `chalktalk_request_db_pool_acquire_total_duration_seconds_bucket{operation="${operation}",outcome="completed",le="${le === "+Inf" ? le : le * scale}"}`,
        count,
      ]),
      [
        `chalktalk_http_request_duration_seconds_bucket{method="${method}",route="${route}",outcome="aborted",le="+Inf"}`,
        100,
      ],
    ];
  });
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
    ...operations.flatMap(([panelId, offset], operationIndex) => {
      const targets = dashboard.panels.find((panel) => panel.id === panelId)?.targets;
      assert.ok(targets?.length >= offset + 6);
      return [0.1, 0.19, 0.0375, 0.09375, 0, 0.009].flatMap((base, index) => [
        `      - expr: ${JSON.stringify(`abs((${targets[offset + index].expr}) - ${base * (operationIndex + 1)}) < bool 1e-10`)}`,
        "        eval_time: 6m",
        "        exp_samples:",
        "          - labels: '{}'",
        "            value: 1",
      ]);
    }),
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
