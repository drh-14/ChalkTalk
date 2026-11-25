import { createServer, request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import express from "express";
import { createLifecycle } from "./runtime.js";
import { createHttpOwnership } from "./http.js";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((done) => server.close(() => done()));
  }
});
async function listen(app: express.Express) {
  const server = createServer(app);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
function get(port: number, path: string) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        headers: { origin: "https://app.example.edu" },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
it("rejects late HTTP before parser/auth and preserves identifier-free probes/CORS", async () => {
  const lifecycle = createLifecycle({
    publish: async () => {},
    exit: () => {},
  });
  lifecycle.markRunning();
  const release = lifecycle.admit("job")!;
  const ownership = createHttpOwnership(
    lifecycle,
    new Set(["https://app.example.edu"]),
  );
  const app = express();
  app.use(ownership.admission);
  let effects = 0;
  app.use((_request, _response, next) => {
    effects++;
    next();
  });
  app.get("/business", (_request, response) => response.end("business"));
  const port = await listen(app);
  expect((await get(port, "/ready")).body).toBe('{"ready":true}');
  const shutdown = lifecycle.shutdown("SIGTERM");
  const response = await get(port, "/business");
  expect(response.status).toBe(503);
  expect(response.headers).toMatchObject({
    "retry-after": "1",
    connection: "close",
    "cache-control": "no-store",
    "access-control-allow-origin": "https://app.example.edu",
  });
  expect(JSON.parse(response.body).error.code).toBe("service_unavailable");
  expect(await get(port, "/health")).toMatchObject({
    status: 200,
    body: '{"status":"ok"}',
  });
  expect(await get(port, "/ready")).toMatchObject({
    status: 503,
    body: '{"ready":false}',
  });
  expect(effects).toBe(0);
  release();
  await shutdown;
});
it("does not release a disconnected handler before its service settles", async () => {
  let settle!: () => void;
  const service = new Promise<void>((done) => {
    settle = done;
  });
  let started!: () => void;
  const entered = new Promise<void>((done) => {
    started = done;
  });
  let published = false;
  const lifecycle = createLifecycle({
    publish: async () => {
      published = true;
    },
    exit: () => {},
  });
  lifecycle.markRunning();
  const ownership = createHttpOwnership(lifecycle, new Set());
  const app = express();
  app.use(ownership.admission);
  app.get(
    "/business",
    ownership.handler(async (_request, response) => {
      started();
      await service;
      response.end("done");
    }),
  );
  const port = await listen(app);
  const request = httpRequest({ host: "127.0.0.1", port, path: "/business" });
  request.on("error", () => {});
  request.end();
  await entered;
  request.destroy();
  const shutdown = lifecycle.shutdown("SIGTERM");
  await new Promise((done) => setTimeout(done, 10));
  expect(published).toBe(false);
  settle();
  await shutdown;
  expect(published).toBe(true);
});

it("enforces lifecycle at the real API seam before malformed JSON/authentication", async () => {
  const { createApp } = await import("../http/app.js");
  const { loadEnvironment } = await import("../config/environment.js");
  const lifecycle = createLifecycle({
    publish: async () => {},
    exit: () => {},
  });
  lifecycle.markRunning();
  const release = lifecycle.admit("job")!;
  const environment = loadEnvironment({
    NODE_ENV: "test",
    AUTH_TOKEN_SECRET: "test-application-lifecycle-secret-long-enough",
  });
  const app = createApp({ environment, lifecycle });
  const port = await listen(app);
  const shutdown = lifecycle.shutdown("SIGTERM");
  const result = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/sessions",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      },
    );
    request.on("error", reject);
    request.end("{");
  });
  expect(result).toBe(503);
  release();
  await shutdown;
});

it("keeps healthy writers ready after a definitive read request failure", async () => {
  const { createApp } = await import("../http/app.js");
  const { loadEnvironment } = await import("../config/environment.js");
  const lifecycle = createLifecycle({
    publish: async () => {},
    exit: () => {},
  });
  lifecycle.markRunning();
  const environment = loadEnvironment({
    NODE_ENV: "test",
    AUTH_TOKEN_SECRET: "test-application-lifecycle-secret-long-enough",
  });
  const authService = {
    session: async () => {
      throw new Error("read authentication store unavailable");
    },
  } as unknown as NonNullable<Parameters<typeof createApp>[0]>["authService"];
  const app = createApp({ environment, lifecycle, authService });
  const port = await listen(app);
  const result = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/courses/example/statistics",
        headers: { Cookie: "__Host-chalktalk_session=credential" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      },
    );
    request.on("error", reject);
    request.end();
  });
  expect(result).toBe(500);
  expect((await get(port, "/ready")).status).toBe(200);
});

it("rejects a pipelined request on an existing keep-alive socket after cutoff", async () => {
  const { connect } = await import("node:net");
  const runtime = createLifecycle({ publish: async () => {}, exit: () => {} });
  runtime.markRunning();
  const ownership = createHttpOwnership(runtime, new Set());
  const app = express();
  app.use(ownership.admission);
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let admissions = 0;
  app.get(
    "/business",
    ownership.handler(async (_request, response) => {
      admissions++;
      entered();
      await gate;
      response.end("accepted-before-cutoff");
    }),
  );
  const port = await listen(app);
  const socket = connect(port, "127.0.0.1");
  let wire = "";
  socket.on("data", (chunk) => {
    wire += chunk;
  });
  const ended = once(socket, "end");
  await once(socket, "connect");
  socket.write(
    "GET /business HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
  );
  await started;
  const draining = runtime.shutdown("SIGTERM");
  socket.write(
    "GET /business HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
  );
  release();
  try {
    await ended;
    expect(admissions).toBe(1);
    expect(wire).toContain("HTTP/1.1 200");
    expect(wire).toContain("accepted-before-cutoff");
    expect(wire).toContain("HTTP/1.1 503");
    expect(wire.toLowerCase()).toContain("retry-after: 1");
    expect(wire.toLowerCase()).toContain("connection: close");
    expect((await draining).exitCode).toBe(0);
  } finally {
    release();
    socket.destroy();
  }
});
