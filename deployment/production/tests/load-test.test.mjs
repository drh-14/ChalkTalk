import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Prometheus remote write is receiver-only and VM-loopback-bound", () => {
  const compose = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "deployment/production/.env.example",
        "-f",
        "deployment/production/compose.yml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          COMPOSE_ENV_FILE: resolve(root, "deployment/production/.env.example"),
          GRAFANA_ENV_FILE: resolve(
            root,
            "deployment/production/grafana.env.example",
          ),
        },
      },
    ),
  );
  const prometheus = compose.services.prometheus;
  assert.deepEqual(
    prometheus.ports.map(({ host_ip, published, target }) => ({
      host_ip,
      published,
      target,
    })),
    [{ host_ip: "127.0.0.1", published: "9090", target: 9090 }],
  );
  assert.match(
    prometheus.command.join(" "),
    /--web\.enable-remote-write-receiver/,
  );
  assert.equal(
    compose.services.web.ports.some(({ target }) => target === 9090),
    false,
  );
});

test("load-test dashboard is provisioned in its own Grafana folder", () => {
  const providers = JSON.parse(
    execFileSync(
      "ruby",
      [
        "-ryaml",
        "-rjson",
        "-e",
        "puts JSON.generate(YAML.load_file(ARGV[0])['providers'])",
        resolve(
          root,
          "deployment/observability/grafana/provisioning/dashboards/dashboards.yml",
        ),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.ok(
    providers.some(
      (provider) =>
        provider.folder === "Load Tests" &&
        provider.options.path === "/var/lib/grafana/load-test-dashboards",
    ),
  );
  for (const composePath of [
    "deployment/production/compose.yml",
    "deployment/local/compose.yml",
  ]) {
    const envFile = composePath.replace("compose.yml", ".env.example");
    const config = JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "-f",
          composePath,
          "--env-file",
          envFile,
          "config",
          "--format",
          "json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            COMPOSE_ENV_FILE: composePath.includes("/local/")
              ? envFile
              : resolve(root, envFile),
            GRAFANA_ENV_FILE: resolve(
              root,
              "deployment/production/grafana.env.example",
            ),
          },
        },
      ),
    );
    assert.ok(
      config.services.grafana.volumes.some(
        (mount) =>
          mount.target === "/var/lib/grafana/load-test-dashboards" &&
          mount.read_only,
      ),
    );
  }
});

test("dedicated dashboard uses valid PromQL with fixed-testid client and host selectors", async () => {
  const dashboard = JSON.parse(
    read(
      "deployment/observability/grafana/load-test-dashboards/load-test-correlation.json",
    ),
  );
  assert.equal(dashboard.title, "Load Test Correlation");
  assert.ok(dashboard.templating.list.some((v) => v.name === "testid"));
  const panels = dashboard.panels;
  const expectedMetrics = new Set([
    "k6_http_req_duration_p50",
    "k6_http_req_duration_p90",
    "k6_http_req_duration_p95",
    "k6_http_req_duration_p99",
    "k6_http_reqs_total",
    "k6_checks_rate",
    "k6_vus",
    "k6_dropped_iterations_total",
    "chalktalk_http_request_duration_seconds_bucket",
    "chalktalk_db_query_duration_seconds_bucket",
    "chalktalk_db_pool_acquire_duration_seconds_bucket",
    "node_cpu_seconds_total",
    "node_memory_MemAvailable_bytes",
    "node_network_receive_bytes_total",
    "node_disk_read_bytes_total",
    "node_filesystem_avail_bytes",
  ]);
  const container = execFileSync(
    "docker",
    ["run", "--rm", "-d", "-p", "127.0.0.1::9090", "prom/prometheus:v3.3.1"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  try {
    const mapping = execFileSync("docker", ["port", container, "9090/tcp"], {
      encoding: "utf8",
    }).trim();
    const port = Number(mapping.match(/:(\d+)$/)?.[1]);
    assert.ok(port > 0);
    const endpoint = `http://127.0.0.1:${port}/api/v1/parse_query`;
    const selectors = [];
    for (const panel of panels) {
      for (const target of panel.targets ?? []) {
        let response;
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            response = await fetch(
              `${endpoint}?query=${encodeURIComponent(target.expr)}`,
            );
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        assert.ok(response, "Prometheus parser did not become ready");
        const parsed = await response.json();
        assert.equal(
          parsed.status,
          "success",
          `${panel.title}: ${JSON.stringify(parsed.error)}`,
        );
        const visit = (node) => {
          if (!node || typeof node !== "object") return;
          if (node.type === "vectorSelector" || node.type === "matrixSelector")
            selectors.push(node);
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (typeof value === "object") visit(value);
          }
        };
        const current = [];
        const start = selectors.length;
        visit(parsed.data);
        current.push(...selectors.slice(start));
        assert.ok(current.length, `${panel.title}: no metric selectors`);
        for (const selector of current) {
          const matchers = selector.matchers ?? [];
          const testId = matchers.filter(
            (matcher) => matcher.name === "testid",
          );
          if (selector.name.startsWith("k6_"))
            assert.deepEqual(
              testId.map(({ type, value }) => [type, value]),
              [["=", "$testid"]],
            );
          else assert.equal(testId.length, 0);
        }
      }
    }
    const found = new Set(selectors.map(({ name }) => name));
    for (const metric of expectedMetrics)
      assert.ok(found.has(metric), `missing ${metric}`);
  } finally {
    execFileSync("docker", ["stop", container], { encoding: "utf8" });
  }
});

test("k6 itself accepts only the bounded smoke and ramp execution plans without URL labels", () => {
  const directory = mkdtempSync(resolve(root, ".k6-inspect-"));
  // The container runs as a non-root user on Linux CI. This is a dummy
  // inspect-only manifest, so make its bind mount traversable/readable.
  chmodSync(directory, 0o755);
  const runId = "load-20261117-a1b2c3d4";
  const sha = "a".repeat(40);
  const manifest = {
    runId,
    deployedSha: sha,
    baseUrl: "https://joinchalktalk.com",
    users: Array.from({ length: 20 }, (_, i) => ({
      email: `vu${i}@example.invalid`,
      password: "test",
    })),
  };
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest));
  chmodSync(resolve(directory, "manifest.json"), 0o644);
  try {
    for (const mode of ["smoke", "ramp"]) {
      writeFileSync(
        resolve(directory, `profile-${mode}.json`),
        JSON.stringify({
          maxVus: mode === "smoke" ? 1 : 20,
          stageMinutes: [1, 3, 3, 3],
          stageTargets: mode === "smoke" ? [1, 1, 1, 1] : [2, 5, 10, 20],
          rampWriteAttempts: 17,
        }),
      );
      chmodSync(resolve(directory, `profile-${mode}.json`), 0o644);
      const options = JSON.parse(
        execFileSync(
          "docker",
          [
            "run",
            "--rm",
            "-v",
            `${root}:/repo:ro`,
            "-v",
            `${directory}:/test:ro`,
            "grafana/k6:2.4.0",
            "inspect",
            "-e",
            "MANIFEST_PATH=/test/manifest.json",
            "-e",
            `PROFILE_PATH=/test/profile-${mode}.json`,
            "-e",
            `MODE=${mode}`,
            "-e",
            `RUN_ID=${runId}`,
            "-e",
            `DEPLOYED_SHA=${sha}`,
            "-e",
            "CONFIRM_PRODUCTION=joinchalktalk.com",
            "/repo/deployment/load-test/workload.js",
          ],
          { cwd: root, encoding: "utf8" },
        ),
      );
      assert.equal(options.tags.testid, runId);
      assert.ok(options.systemTags.includes("name"));
      assert.equal(options.systemTags.includes("url"), false);
      const traffic = options.scenarios.traffic;
      if (mode === "smoke") {
        assert.equal(traffic.executor, "constant-vus");
        assert.equal(traffic.vus, 1);
        assert.equal(traffic.duration, "2m0s");
      } else {
        assert.equal(traffic.executor, "ramping-vus");
        assert.equal(traffic.startVUs, 2);
        assert.deepEqual(
          traffic.stages.map(({ target, duration }) => [target, duration]),
          [
            [2, "1m0s"],
            [5, "3m0s"],
            [10, "3m0s"],
            [20, "3m0s"],
          ],
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
