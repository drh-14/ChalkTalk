import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { test } from "node:test";

const config = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "deployment/local/compose.yml",
      "--env-file",
      "deployment/local/.env.example",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      env: {
        ...process.env,
        COMPOSE_ENV_FILE: "deployment/local/.env.example",
      },
      encoding: "utf8",
    },
  ),
);

test("default Compose uses a private, persistent Loki and Alloy log pipeline", () => {
  assert.ok(config.services.loki);
  assert.ok(config.services.alloy);
  assert.equal(config.services.elasticsearch, undefined);
  assert.equal(config.services.logstash, undefined);
  assert.equal(config.services.loki.ports, undefined);
  assert.equal(config.services.alloy.ports, undefined);
  assert.ok(
    config.services.alloy.volumes.some(
      (mount) => mount.target === "/var/log/chalktalk-api" && mount.read_only,
    ),
  );
  assert.ok(
    config.services.alloy.volumes.some(
      (mount) =>
        mount.target === "/var/log/chalktalk-worker" && mount.read_only,
    ),
  );
  assert.ok(
    config.services.alloy.volumes.some(
      (mount) => mount.target === "/var/lib/alloy/data",
    ),
  );
  assert.ok(
    config.services.loki.volumes.some((mount) => mount.target === "/loki"),
  );
  assert.ok(
    config.services.alloy.volumes.every(
      (mount) => mount.target !== "/var/run/docker.sock",
    ),
  );
});

test("Compose bounds API and worker Docker stdout logs", () => {
  for (const service of ["api", "worker"]) {
    assert.deepEqual(config.services[service].logging, {
      driver: "local",
      options: { "max-size": "20m", "max-file": "5" },
    });
  }
});

test("Grafana queries Loki logs and keeps the existing dashboard UID", async () => {
  const { readFileSync } = await import("node:fs");
  const dashboard = JSON.parse(
    readFileSync(
      new URL(
        "../../observability/grafana/dashboards/api.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const logs = dashboard.panels.find((panel) => panel.type === "logs");
  assert.equal(logs.datasource.type, "loki");
  assert.equal(logs.targets[0].expr, '{service=~"api|worker"}');
  assert.equal(dashboard.uid, "chalktalk-api");
});
