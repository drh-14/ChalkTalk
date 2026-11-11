import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const example = resolve(root, "deployment/production/.env.example");
const grafanaExample = resolve(root, "deployment/production/grafana.env.example");
const compose = resolve(root, "deployment/production/compose.yml");
const project = `observability-smoke-${process.pid}`;
const env = {
  ...process.env,
  COMPOSE_ENV_FILE: example,
  GRAFANA_ENV_FILE: grafanaExample,
};

function docker(...args) {
  return execFileSync("docker", args, { cwd: root, env, encoding: "utf8" }).trim();
}

function stack(...args) {
  return docker("compose", "-p", project, "--env-file", example, "-f", compose, ...args);
}

function start(service, port) {
  const id = stack(
    "run",
    "-d",
    "--no-deps",
    "--use-aliases",
    "-p",
    `127.0.0.1::${port}`,
    service,
  );
  const bindings = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", id));
  assert.deepEqual(Object.keys(bindings), [`${port}/tcp`]);
  const [{ HostIp, HostPort }] = bindings[`${port}/tcp`];
  assert.equal(HostIp, "127.0.0.1");
  return `http://127.0.0.1:${HostPort}`;
}

function startGrafana() {
  const id = stack("run", "-d", "--no-deps", "--use-aliases", "--service-ports", "grafana");
  const bindings = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", id));
  assert.deepEqual(bindings, {
    "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }],
  });
  return "http://127.0.0.1:3001";
}

async function ready(url, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError;
}

test("running production monitoring enforces retention, authentication, and private ports", { timeout: 180000 }, async () => {
  try {
    const prometheus = start("prometheus", 9090);
    const grafana = startGrafana();
    await ready(`${prometheus}/-/ready`);
    const flags = await (await ready(`${prometheus}/api/v1/status/flags`)).json();
    assert.equal(flags.status, "success");
    assert.equal(flags.data["storage.tsdb.retention.time"], "15d");

    const dashboard = `${grafana}/api/dashboards/uid/chalktalk-api`;
    const password = "replace-with-at-least-32-random-characters";
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
    await ready(`${grafana}/api/health`);
    assert.equal((await fetch(dashboard)).status, 401);
    const response = await ready(dashboard, { Authorization: authorization });
    const body = await response.json();
    assert.equal(body.dashboard.uid, "chalktalk-api");
    assert.equal(body.dashboard.title, "ChalkTalk API observability");
  } finally {
    stack("down", "--volumes", "--remove-orphans");
  }
});
