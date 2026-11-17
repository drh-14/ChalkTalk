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

test("local host exporter is private and reads Docker Linux VM views only", () => {
  const exporter = config.services["node-exporter"];
  assert.match(exporter.image, /^prom\/node-exporter:v\d/);
  assert.equal(exporter.ports?.length ?? 0, 0);
  assert.deepEqual(
    exporter.volumes.map(({ source, target, read_only }) => [
      source,
      target,
      read_only,
    ]),
    [
      ["/proc", "/host/proc", true],
      ["/sys", "/host/sys", true],
      ["/", "/host/root", true],
    ],
  );
  assert.equal(
    exporter.volumes.some(({ source }) => source.includes("docker.sock")),
    false,
  );
  assert.equal(config.services.api.depends_on?.["node-exporter"], undefined);
  assert.equal(
    config.services.gateway.depends_on?.["node-exporter"],
    undefined,
  );
});

test("local network exporter reads Docker Linux VM PID 1 privately", () => {
  const exporter = config.services["node-exporter-network"];
  assert.equal(exporter.image, "prom/node-exporter:v1.9.1");
  assert.equal(exporter.image, config.services["node-exporter"].image);
  assert.equal(exporter.pid, "host");
  assert.equal(exporter.network_mode, undefined);
  assert.equal(exporter.read_only, true);
  assert.deepEqual(exporter.security_opt, ["no-new-privileges:true"]);
  assert.equal(exporter.ports?.length ?? 0, 0);
  assert.deepEqual(
    exporter.volumes.map(({ source, target, read_only }) => [source, target, read_only]),
    [["/proc", "/host/proc", true]],
  );
  assert.deepEqual(exporter.command, [
    "--path.procfs=/host/proc/1",
    "--collector.disable-defaults",
    "--collector.netdev",
    "--no-collector.netdev.netlink",
  ]);
  assert.equal(config.services.api.depends_on?.["node-exporter-network"], undefined);
  assert.equal(config.services.gateway.depends_on?.["node-exporter-network"], undefined);
});
