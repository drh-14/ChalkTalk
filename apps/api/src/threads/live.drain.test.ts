import { createServer } from "node:http";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import type { AuthService } from "../auth/service.js";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { createThreadLiveServer } from "./live.js";

it("awaits delayed upgrade authorization and rejects late socket registration after cutoff", async () => {
  let complete!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const authorization = new Promise((done) => {
    complete = done;
  });
  const listener = Object.assign(new EventEmitter(), {
    query: async () => ({ rows: [] }),
    release: () => {},
  });
  const pool = { connect: async () => listener } as unknown as Pool;
  const authService = {
    session: () => {
      entered();
      return authorization;
    },
  } as unknown as AuthService;
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const live = createThreadLiveServer({
    server,
    pool,
    authService,
    frontendOrigins: new Set(["https://app.example.edu"]),
  });
  await live.start();
  const socket = new WebSocket(
    `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/thread-events`,
    {
      headers: {
        Origin: "https://app.example.edu",
        Cookie: "__Host-chalktalk_session=credential",
      },
    },
  );
  socket.on("error", () => {});
  await started;
  live.cutoff();
  let stopped = false;
  const stop = live.stop().then(() => {
    stopped = true;
  });
  await new Promise((done) => setTimeout(done, 10));
  expect(stopped).toBe(false);
  complete({ id: "session", user: { id: "user", displayName: "name" } });
  await stop;
  expect(socket.readyState).not.toBe(WebSocket.OPEN);
  socket.terminate();
  await new Promise<void>((done) => server.close(() => done()));
});

it("releases its listener and closes WebSockets after UNLISTEN fails", async () => {
  let completeAuthorization!: (value: unknown) => void;
  let authorizationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    authorizationStarted = resolve;
  });
  const authorization = new Promise((resolve) => {
    completeAuthorization = resolve;
  });
  const failure = new Error("UNLISTEN failed");
  let releases = 0;
  let releaseError: Error | boolean | undefined;
  let unlistenCalls = 0;
  const listener = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      if (sql === "UNLISTEN *") {
        unlistenCalls++;
        throw failure;
      }
      return { rows: [] };
    },
    release: (error?: Error | boolean) => {
      releases++;
      releaseError = error;
    },
  });
  const pool = { connect: async () => listener } as unknown as Pool;
  const authService = {
    session: (credential: string) => {
      if (credential === "connected")
        return Promise.resolve({
          id: "connected",
          user: { id: "user", displayName: "name" },
        });
      authorizationStarted();
      return authorization;
    },
  } as unknown as AuthService;
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const live = createThreadLiveServer({
    server,
    pool,
    authService,
    frontendOrigins: new Set(["https://app.example.edu"]),
  });
  await live.start();
  const address = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/thread-events`;
  const connected = new WebSocket(address, {
    headers: {
      Origin: "https://app.example.edu",
      Cookie: "__Host-chalktalk_session=connected",
    },
  });
  await once(connected, "open");
  const closed = once(connected, "close");
  const pending = new WebSocket(address, {
    headers: {
      Origin: "https://app.example.edu",
      Cookie: "__Host-chalktalk_session=pending",
    },
  });
  pending.on("error", () => {});
  await started;
  live.cutoff();
  const stop = live.stop();
  let settled = false;
  void stop
    .finally(() => {
      settled = true;
    })
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  expect(unlistenCalls).toBe(0);
  completeAuthorization({
    id: "session",
    user: { id: "user", displayName: "name" },
  });
  await expect(stop).rejects.toBe(failure);
  expect(unlistenCalls).toBe(1);
  expect(releases).toBe(1);
  expect(releaseError).toBe(failure);
  await closed;
  expect(connected.readyState).toBe(WebSocket.CLOSED);
  pending.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
