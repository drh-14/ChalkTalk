import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const example = resolve(root, "deployment/production/.env.example");
const grafanaExample = resolve(
  root,
  "deployment/production/grafana.env.example",
);
const compose = resolve(root, "deployment/production/compose.yml");

function model() {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        example,
        "-f",
        compose,
        "config",
        "--format",
        "json",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          COMPOSE_ENV_FILE: example,
          GRAFANA_ENV_FILE: grafanaExample,
        },
        encoding: "utf8",
      },
    ),
  );
}

test("production monitoring has only an SSH-forwardable Grafana port", () => {
  const services = model().services;
  assert.deepEqual(
    services.grafana.ports.map(({ host_ip, published, target }) => ({
      host_ip,
      published,
      target,
    })),
    [{ host_ip: "127.0.0.1", published: "3001", target: 3000 }],
  );
  assert.deepEqual(
    services.web.ports.map(({ published }) => published).sort(),
    ["80", "443", "443"].sort(),
  );
  for (const [name, service] of Object.entries(services)) {
    if (name === "grafana" || name === "web") continue;
    assert.equal(service.ports?.length ?? 0, 0, `${name} has a host port`);
  }
  assert.equal(services.grafana.environment.GF_AUTH_ANONYMOUS_ENABLED, "false");
  assert.ok(services.grafana.environment.GRAFANA_ADMIN_PASSWORD);
  for (const name of ["migrate", "api", "worker", "collaboration"]) {
    assert.equal(
      services[name].environment.GRAFANA_ADMIN_PASSWORD,
      undefined,
      `${name} received Grafana admin credentials`,
    );
  }
});

test("production collectors use persistent volumes and sanitized log inputs", () => {
  const { services } = model();
  for (const name of ["api", "worker", "collaboration"]) {
    assert.ok(
      services[name].environment.METRICS_TOKEN,
      `${name} lacks scrape token`,
    );
  }
  assert.ok(services.prometheus.environment.METRICS_TOKEN);

  for (const [name, spool] of [
    ["api", "api-log-spool"],
    ["worker", "worker-log-spool"],
  ]) {
    assert.ok(
      services[name].volumes.some(
        (volume) =>
          volume.source === spool && volume.target === "/var/log/chalktalk",
      ),
      `${name} has no persistent sanitized spool`,
    );
    assert.ok(
      services.alloy.volumes.some(
        (volume) => volume.source === spool && volume.read_only,
      ),
      `Alloy does not read ${name}'s spool safely`,
    );
  }
  assert.equal(
    services.alloy.volumes.some(
      (volume) => volume.target === "/var/run/docker.sock",
    ),
    false,
  );
  for (const name of ["loki", "alloy", "prometheus", "grafana"]) {
    const mounts = services[name].volumes;
    assert.ok(
      mounts.some((volume) => volume.type === "volume"),
      `${name} has no persistent state`,
    );
    for (const mount of mounts.filter((volume) => volume.type === "bind"))
      assert.ok(
        existsSync(mount.source),
        `missing ${name} config ${mount.source}`,
      );
  }
});

test("production host exporter is private and reads host views only", () => {
  const { services } = model();
  const exporter = services["node-exporter"];
  assert.match(exporter.image, /^prom\/node-exporter:v\d/);
  assert.equal(exporter.ports?.length ?? 0, 0);
  assert.ok(Object.hasOwn(exporter.networks, "edge"));
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
  assert.equal(services.api.depends_on?.["node-exporter"], undefined);
  assert.equal(services.web.depends_on?.["node-exporter"], undefined);
});

test("production network exporter reads host PID 1 without a published port", () => {
  const { services } = model();
  const exporter = services["node-exporter-network"];
  assert.equal(exporter.image, "prom/node-exporter:v1.9.1");
  assert.equal(exporter.image, services["node-exporter"].image);
  assert.equal(exporter.pid, "host");
  assert.equal(exporter.network_mode, undefined);
  assert.equal(exporter.read_only, true);
  assert.deepEqual(exporter.security_opt, ["no-new-privileges:true"]);
  assert.equal(exporter.ports?.length ?? 0, 0);
  assert.ok(Object.hasOwn(exporter.networks, "edge"));
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
  assert.equal(services.api.depends_on?.["node-exporter-network"], undefined);
  assert.equal(services.web.depends_on?.["node-exporter-network"], undefined);
});
