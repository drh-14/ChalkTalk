import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const project = `observability-smoke-${process.pid}`;
const env = {
  ...process.env,
  COMPOSE_ENV_FILE: example,
  GRAFANA_ENV_FILE: grafanaExample,
};

function docker(...args) {
  return execFileSync("docker", args, {
    cwd: root,
    env,
    encoding: "utf8",
  }).trim();
}

function stack(...args) {
  return docker(
    "compose",
    "-p",
    project,
    "--env-file",
    example,
    "-f",
    compose,
    ...args,
  );
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
  const bindings = JSON.parse(
    docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", id),
  );
  assert.deepEqual(Object.keys(bindings), [`${port}/tcp`]);
  const [{ HostIp, HostPort }] = bindings[`${port}/tcp`];
  assert.equal(HostIp, "127.0.0.1");
  return `http://127.0.0.1:${HostPort}`;
}

function startGrafana() {
  return start("grafana", 3000);
}

async function ready(url, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError;
}

test(
  "running production monitoring enforces retention, authentication, and private ports",
  { timeout: 180000 },
  async () => {
    try {
      const prometheus = start("prometheus", 9090);
      const grafana = startGrafana();
      await ready(`${prometheus}/-/ready`);
      const flags = await (
        await ready(`${prometheus}/api/v1/status/flags`)
      ).json();
      assert.equal(flags.status, "success");
      assert.equal(flags.data["storage.tsdb.retention.time"], "15d");
      let vmTarget;
      let networkTarget;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const targets = await (await ready(`${prometheus}/api/v1/targets`)).json();
        vmTarget = targets.data.activeTargets.find(
          (target) => target.labels.job === "chalktalk-vm",
        );
        networkTarget = targets.data.activeTargets.find(
          (target) => target.labels.job === "chalktalk-vm-network",
        );
        if (vmTarget && networkTarget) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      assert.ok(vmTarget, "Prometheus did not register the VM scrape target");
      assert.equal(vmTarget.scrapeUrl, "http://node-exporter:9100/metrics");
      assert.equal(vmTarget.scrapeInterval, "1m");
      assert.ok(networkTarget, "Prometheus did not register the VM network scrape target");
      assert.equal(networkTarget.scrapeUrl, "http://node-exporter-network:9100/metrics");
      assert.equal(networkTarget.scrapeInterval, "1m");

      const dashboard = `${grafana}/api/dashboards/uid/chalktalk-api`;
      const password = "replace-with-at-least-32-random-characters";
      const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
      await ready(`${grafana}/api/health`);
      assert.equal((await fetch(dashboard)).status, 401);
      const response = await ready(dashboard, { Authorization: authorization });
      const body = await response.json();
      assert.equal(body.dashboard.uid, "chalktalk-api");
      assert.equal(body.dashboard.title, "ChalkTalk API observability");
      const vmResponse = await ready(
        `${grafana}/api/dashboards/uid/chalktalk-vm-system-load`,
        { Authorization: authorization },
      );
      const vmDashboard = await vmResponse.json();
      assert.equal(vmDashboard.dashboard.title, "VM System Load");
      assert.deepEqual(
        vmDashboard.dashboard.panels.map(({ title, targets }) => [title, targets.length]),
        [
          ["CPU used", 1],
          ["Memory", 2],
          ["Network traffic", 2],
          ["Network errors", 2],
          ["Disk I/O", 2],
          ["Filesystem free", 1],
        ],
      );
      for (const panel of vmDashboard.dashboard.panels) {
        assert.equal(panel.type, "timeseries");
        assert.equal(panel.datasource.uid, "chalktalk-prometheus");
        for (const { expr } of panel.targets) {
          const parameters = new URLSearchParams({ query: expr });
          const result = await (
            await fetch(`${prometheus}/api/v1/query?${parameters}`)
          ).json();
          assert.equal(result.status, "success", `${panel.title}: ${result.error}`);
          assert.equal(result.data.resultType, "vector");
          assert.equal(result.data.result.length, 0, `${panel.title} has data without the exporter`);
        }
      }
      stack("run", "-d", "--no-deps", "--use-aliases", "node-exporter");
      stack("run", "-d", "--no-deps", "--use-aliases", "node-exporter-network");
      for (const [metric, job, filter] of [
        ["node_cpu_seconds_total", "chalktalk-vm", ""],
        ["node_memory_MemAvailable_bytes", "chalktalk-vm", ""],
        ["node_network_receive_bytes_total", "chalktalk-vm-network", ',device!~"lo|veth.*"'],
        ["node_disk_read_bytes_total", "chalktalk-vm", ""],
      ]) {
        let samples = [];
        for (let attempt = 0; attempt < 130; attempt += 1) {
          const now = Math.floor(Date.now() / 1000);
          const parameters = new URLSearchParams({
            query: `${metric}{job="${job}"${filter}}[3m]`,
            time: String(now),
          });
          const result = await (
            await fetch(`${prometheus}/api/v1/query?${parameters}`)
          ).json();
          samples =
            result.data.result[0]?.values.filter(
              ([time]) => time >= now - 150 && time <= now + 15,
            ) ?? [];
          if (samples.length >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        assert.ok(samples.length >= 2, `${metric} lacks two fresh ${job} samples`);
        assert.ok(Number(samples.at(-1)[1]) >= 0);
      }
      const networkCpu = await (
        await fetch(
          `${prometheus}/api/v1/query?${new URLSearchParams({ query: 'node_cpu_seconds_total{job="chalktalk-vm-network"}' })}`,
        )
      ).json();
      assert.equal(networkCpu.status, "success");
      assert.deepEqual(networkCpu.data.result, []);
      for (const panel of vmDashboard.dashboard.panels) {
        for (const { expr } of panel.targets) {
          const parameters = new URLSearchParams({ query: expr });
          const result = await (
            await fetch(`${prometheus}/api/v1/query?${parameters}`)
          ).json();
          assert.equal(result.status, "success", `${panel.title}: ${result.error}`);
          assert.equal(result.data.resultType, "vector");
          assert.ok(result.data.result.length > 0, `${panel.title} has no VM data`);
          for (const series of result.data.result) {
            assert.ok(Number.isFinite(Number(series.value[1])), `${panel.title} has no numeric value`);
            if (panel.title === "Memory" || panel.title === "Filesystem free") {
              assert.equal(series.metric.job, "chalktalk-vm");
            } else {
              assert.deepEqual(series.metric, {});
            }
          }
        }
      }
    } finally {
      stack("down", "--volumes", "--remove-orphans");
    }
  },
);
