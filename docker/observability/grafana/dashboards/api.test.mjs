import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    readFileSync(new URL("./api.json", import.meta.url), "utf8"),
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
