import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { Pool } from "pg";
import type { AuthService } from "../auth/service.js";
import { createThreadLiveServer } from "./live.js";

const COURSE = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

class Listener extends EventEmitter {
  async query() {
    return { rows: [] };
  }
  release() {}
}

function fixture(memberCheck?: (userId: string) => Promise<void>) {
  const server = createServer((_request, response) => response.end());
  const listener = new Listener();
  const members = new Set(["alice", "bob"]);
  const pool = {
    connect: async () => listener,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("course_memberships")) {
        await memberCheck?.(String(params?.[1]));
        return { rows: members.has(String(params?.[1])) ? [{ ok: 1 }] : [] };
      }
      if (sql.includes("thread_conversations"))
        return { rows: [{ course_id: COURSE }] };
      if (sql.includes("pg_notify")) {
        listener.emit("notification", {
          channel: "thread_typing",
          payload: String(params?.[0]),
        });
      }
      return { rows: [] };
    },
  } as unknown as Pool;
  const auth = {
    session: async (cookie: string) => {
      if (cookie !== "alice" && cookie !== "bob") throw Error("unauthorized");
      return { id: cookie, user: { id: cookie, displayName: cookie } };
    },
  } as unknown as AuthService;
  const live = createThreadLiveServer({
    server,
    pool,
    authService: auth,
    frontendOrigins: new Set(["https://chalktalk.test"]),
  });
  return { server, listener, members, live };
}

async function connect(
  server: ReturnType<typeof createServer>,
  user: string,
  origin = "https://chalktalk.test",
) {
  const port = (server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/thread-events`, {
    headers: { Origin: origin, Cookie: `__Host-chalktalk_session=${user}` },
  });
  await once(socket, "open");
  return socket;
}

async function next(socket: WebSocket) {
  const [data] = await once(socket, "message");
  return JSON.parse(data.toString());
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Thread live WebSocket", () => {
  it("processes subscribe before immediate view and then delivers typing", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstAliceCheck = true;
    const { server, live } = fixture(async (userId) => {
      if (userId === "alice" && firstAliceCheck) {
        firstAliceCheck = false;
        await blocked;
      }
    });
    await live.start();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    cleanups.push(async () => {
      await live.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const bob = await connect(server, "bob");
    const alice = await connect(server, "alice");
    cleanups.push(async () => {
      bob.terminate();
      alice.terminate();
    });
    bob.send(JSON.stringify({ type: "subscribe", courseId: COURSE }));
    expect(await next(bob)).toEqual({ type: "subscribed", courseId: COURSE });
    bob.send(
      JSON.stringify({
        type: "view",
        courseId: COURSE,
        conversationId: CONVERSATION,
      }),
    );
    expect(await next(bob)).toEqual({
      type: "viewing",
      conversationId: CONVERSATION,
    });

    const received: unknown[] = [];
    alice.on("message", (data) => received.push(JSON.parse(data.toString())));
    alice.send(JSON.stringify({ type: "subscribe", courseId: COURSE }));
    alice.send(
      JSON.stringify({
        type: "view",
        courseId: COURSE,
        conversationId: CONVERSATION,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() =>
      expect(received).toEqual([
        { type: "subscribed", courseId: COURSE },
        { type: "viewing", conversationId: CONVERSATION },
      ]),
    );
    const typed = next(bob);
    alice.send(
      JSON.stringify({
        type: "typing",
        conversationId: CONVERSATION,
        active: true,
      }),
    );
    expect(await typed).toEqual({
      type: "typing",
      conversationId: CONVERSATION,
      userId: "alice",
      displayName: "alice",
      active: true,
    });
  });

  it("rejects foreign origins and missing sessions before upgrade", async () => {
    const { server, live } = fixture();
    await live.start();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    cleanups.push(async () => {
      await live.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const port = (server.address() as AddressInfo).port;
    for (const options of [
      {
        headers: {
          Origin: "https://evil.test",
          Cookie: "__Host-chalktalk_session=alice",
        },
      },
      { headers: { Origin: "https://chalktalk.test" } },
    ]) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/v1/thread-events`,
        options,
      );
      socket.on("error", () => {});
      const [, response] = await once(socket, "unexpected-response");
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      response.resume();
      socket.terminate();
    }
  });

  it("forwards committed invalidation to members but stops after access revocation", async () => {
    const { server, listener, members, live } = fixture();
    await live.start();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    cleanups.push(async () => {
      await live.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const alice = await connect(server, "alice");
    cleanups.push(async () => alice.terminate());
    alice.send(JSON.stringify({ type: "subscribe", courseId: COURSE }));
    expect(await next(alice)).toEqual({ type: "subscribed", courseId: COURSE });
    listener.emit("notification", {
      channel: "thread_changes",
      payload: JSON.stringify({
        courseId: COURSE,
        boardId: BOARD,
        sequence: 3,
      }),
    });
    expect(await next(alice)).toEqual({
      type: "changed",
      courseId: COURSE,
      boardId: BOARD,
      sequence: 3,
    });
    members.delete("alice");
    listener.emit("notification", {
      channel: "thread_changes",
      payload: JSON.stringify({
        courseId: COURSE,
        boardId: BOARD,
        sequence: 4,
      }),
    });
    expect(await next(alice)).toMatchObject({
      type: "error",
      code: "access_revoked",
    });
  });

  it("sends named reply typing only to other clients viewing the same conversation", async () => {
    const { server, live } = fixture();
    await live.start();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    cleanups.push(async () => {
      await live.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const alice = await connect(server, "alice");
    const bob = await connect(server, "bob");
    cleanups.push(async () => {
      alice.terminate();
      bob.terminate();
    });
    for (const socket of [alice, bob]) {
      socket.send(JSON.stringify({ type: "subscribe", courseId: COURSE }));
      await next(socket);
      socket.send(
        JSON.stringify({
          type: "view",
          courseId: COURSE,
          conversationId: CONVERSATION,
        }),
      );
      expect(await next(socket)).toMatchObject({
        type: "viewing",
        conversationId: CONVERSATION,
      });
    }
    alice.send(
      JSON.stringify({
        type: "typing",
        conversationId: CONVERSATION,
        active: true,
      }),
    );
    expect(await next(bob)).toMatchObject({
      type: "typing",
      conversationId: CONVERSATION,
      userId: "alice",
      displayName: "alice",
      active: true,
    });
    bob.send(JSON.stringify({ type: "unview", conversationId: CONVERSATION }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const afterLeaving: unknown[] = [];
    bob.on("message", (value) =>
      afterLeaving.push(JSON.parse(value.toString())),
    );
    alice.send(
      JSON.stringify({
        type: "typing",
        conversationId: CONVERSATION,
        active: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(afterLeaving).toEqual([]);
  });
});
