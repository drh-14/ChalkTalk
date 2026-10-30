/* global fetch */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

async function listen(server) {
  server.listen(0, "0.0.0.0");
  await new Promise((resolve) => server.once("listening", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function upgrade(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(
        "GET /collaboration HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      ),
    );
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("WebSocket upgrade timed out"));
    });
  });
}

test("Railway gateway serves SPA and safely routes API and WebSocket traffic", async (t) => {
  try {
    docker("info", "--format", "{{.ServerVersion}}");
  } catch {
    t.skip("Docker daemon unavailable");
    return;
  }
  const image = process.env.GATEWAY_TEST_IMAGE ?? "caddy:2.10-alpine";
  try {
    docker("image", "inspect", image);
  } catch {
    t.skip(`Gateway test image ${image} is unavailable; pull it first`);
    return;
  }

  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ path: request.url, headers: request.headers }),
    );
  });
  const collaboration = createServer();
  collaboration.on("upgrade", (request, socket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Upstream-Path: ${request.url}\r\n\r\n`,
    );
    socket.end();
  });
  const apiPort = await listen(api);
  const collaborationPort = await listen(collaboration);
  let container;
  try {
    container = docker(
      "run",
      "-d",
      "-p",
      "127.0.0.1::8080",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-e",
      "PORT=8080",
      "-e",
      `API_UPSTREAM=host.docker.internal:${apiPort}`,
      "-e",
      `COLLABORATION_UPSTREAM=host.docker.internal:${collaborationPort}`,
      "-v",
      `${directory}Caddyfile:/etc/caddy/Caddyfile:ro`,
      image,
    );
    const port = Number(
      docker("port", container, "8080/tcp").split(":").at(-1),
    );
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`${base}/api/health`);
        ready = response.ok;
        if (ready) break;
      } catch {
        // Allow the gateway process time to start.
      }
      await delay(100);
    }
    assert.ok(ready, `Gateway failed to start: ${docker("logs", container)}`);

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.path, "/health");
    const apiResponse = await fetch(`${base}/api/v1/posts?limit=3`, {
      headers: {
        "X-Real-IP": "198.51.100.42",
        "X-Forwarded-For": "203.0.113.99",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "attacker.invalid",
      },
    });
    const routed = await apiResponse.json();
    assert.equal(routed.path, "/api/v1/posts?limit=3");
    assert.equal(routed.headers["x-forwarded-for"], "198.51.100.42");
    assert.equal(routed.headers["x-forwarded-proto"], "https");
    assert.equal(routed.headers["x-forwarded-host"], "127.0.0.1");

    const websocket = await upgrade(port);
    assert.match(websocket, /^HTTP\/1\.1 101 /);
    assert.match(websocket, /X-Upstream-Path: \/collaboration/i);

    const spa = await fetch(`${base}/courses/example`);
    assert.equal(spa.status, 200);
    assert.match(spa.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await spa.text(), /<html/i);

    await close(api);
    const failedApi = await fetch(`${base}/api/v1/posts`);
    assert.equal(failedApi.status, 502);
    assert.doesNotMatch(await failedApi.text(), /<html/i);
  } finally {
    if (container) docker("rm", "-f", container);
    if (api.listening) await close(api);
    await close(collaboration);
  }
});
