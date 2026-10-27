import { Pool } from "pg";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import WebSocket from "ws";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { ThreadService } from "../threads/service.js";
import { createThreadLiveServer } from "../threads/live.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `threads_${process.pid}_${Date.now()}`;
const ids = {
  organization: uuidv7(),
  course: uuidv7(),
  otherCourse: uuidv7(),
  instructor: uuidv7(),
  ta: uuidv7(),
  student: uuidv7(),
  otherStudent: uuidv7(),
  outsider: uuidv7(),
};
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";
let admin: Pool;
let pool: Pool;
function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "member@example.edu",
          displayName: "Member",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        expiresAt: "2026-12-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    threadService: new ThreadService(pool),
  });
}
function unsafe(agent: request.SuperTest<request.Test>) {
  return agent
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
function safe(agent: request.SuperTest<request.Test>) {
  return agent.set("Cookie", cookie);
}
const root = `/api/v1/courses/${ids.course}/threads`;

integration("public Threads HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    for (const [index, userId] of [
      ids.instructor,
      ids.ta,
      ids.student,
      ids.otherStudent,
      ids.outsider,
    ].entries()) {
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [
          userId,
          ids.organization,
          `member${index}@example.edu`,
          `Member ${index}`,
        ],
      );
    }
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH'),($4,$2,$3,'Chemistry','BCDEFGHI')",
      [ids.course, ids.organization, ids.instructor, ids.otherCourse],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'instructor'),($1,$3,'ta'),($1,$4,'student'),($1,$5,'student')",
      [ids.course, ids.instructor, ids.ta, ids.student, ids.otherStudent],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("lets staff create a public board while students and outsiders cannot", async () => {
    const denied = await unsafe(request(app(ids.student)).post(root)).send({
      title: "Find a project team",
    });
    expect(denied.status).toBe(403);
    const created = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Find a project team",
    });
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe('"v1"');
    expect(created.body.data).toMatchObject({
      title: "Find a project team",
      version: 1,
      courseId: ids.course,
    });
    const studentList = await safe(request(app(ids.student)).get(root));
    expect(studentList.status).toBe(200);
    expect(studentList.body.data).toEqual([
      expect.objectContaining({ id: created.body.data.id }),
    ]);
    const outsider = await safe(request(app(ids.outsider)).get(root));
    expect(outsider.status).toBe(404);
  });

  it("creates one conversation with an opening message and keeps replies chronological", async () => {
    const board = await unsafe(request(app(ids.instructor)).post(root)).send({
      title: "Teams",
    });
    const path = `${root}/${board.body.data.id}/conversations`;
    const created = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "Looking for teammates",
    });
    expect(created.status).toBe(201);
    expect(created.body.openingMessage).toMatchObject({
      bodyMarkdown: "Looking for teammates",
      version: 1,
    });
    expect(created.body.data.threadId).toBe(board.body.data.id);
    const conversationId = created.body.data.id as string;
    const messagesPath = `${path}/${conversationId}/messages`;
    const reply = await unsafe(
      request(app(ids.otherStudent)).post(messagesPath),
    ).send({ bodyMarkdown: "I can join" });
    expect(reply.status).toBe(201);
    const messages = await safe(request(app(ids.student)).get(messagesPath));
    expect(messages.status).toBe(200);
    expect(
      messages.body.data.map(
        (message: { bodyMarkdown: string }) => message.bodyMarkdown,
      ),
    ).toEqual(["Looking for teammates", "I can join"]);
    const outsider = await safe(request(app(ids.outsider)).get(messagesPath));
    expect(outsider.status).toBe(404);
    const missingBody = await unsafe(request(app(ids.student)).post(path)).send(
      { bodyMarkdown: "" },
    );
    expect(missingBody.status).toBe(422);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*) FROM thread_conversations WHERE board_id=$1",
      [board.body.data.id],
    );
    expect(Number(count.rows[0]!.count)).toBe(1);
  });

  it("uses posting-time role for staff moderation and protects staff contributions", async () => {
    const board = await unsafe(request(app(ids.instructor)).post(root)).send({
      title: "Moderation",
    });
    const threadId = board.body.data.id as string;
    const conversation = await unsafe(
      request(app(ids.student)).post(`${root}/${threadId}/conversations`),
    ).send({ bodyMarkdown: "Student opening" });
    const conversationId = conversation.body.data.id as string;
    const openingId = conversation.body.openingMessage.id as string;
    const messagePath = `${root}/${threadId}/conversations/${conversationId}/messages`;
    const openingPath = `${messagePath}/${openingId}`;
    await pool.query(
      "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.student],
    );
    const moderated = await unsafe(request(app(ids.ta)).patch(openingPath))
      .set("If-Match", '"v1"')
      .send({ bodyMarkdown: "Edited by staff" });
    expect(moderated.status).toBe(200);
    expect(moderated.body.data).toMatchObject({
      bodyMarkdown: "Edited by staff",
      version: 2,
    });
    const stale = await unsafe(request(app(ids.student)).patch(openingPath))
      .set("If-Match", '"v1"')
      .send({ bodyMarkdown: "Stale" });
    expect(stale.status).toBe(412);
    const staffReply = await unsafe(
      request(app(ids.instructor)).post(messagePath),
    ).send({ bodyMarkdown: "Staff response" });
    expect(staffReply.status).toBe(201);
    const staffPath = `${messagePath}/${staffReply.body.data.id}`;
    const forbidden = await unsafe(request(app(ids.ta)).delete(staffPath)).set(
      "If-Match",
      '"v1"',
    );
    expect(forbidden.status).toBe(403);
    const deleted = await unsafe(request(app(ids.ta)).delete(openingPath)).set(
      "If-Match",
      '"v2"',
    );
    expect(deleted.status).toBe(204);
    const messages = await safe(request(app(ids.student)).get(messagePath));
    expect(messages.body.data[0]).toMatchObject({
      bodyMarkdown: "",
      author: null,
      deleted: true,
    });
    expect(messages.body.data[1].bodyMarkdown).toBe("Staff response");
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.student],
    );
  });

  it("renames and deletes a board with ETags, hiding its messages immediately", async () => {
    const board = await unsafe(request(app(ids.instructor)).post(root)).send({
      title: "Original",
    });
    const path = `${root}/${board.body.data.id}`;
    const studentRename = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", '"v1"')
      .send({ title: "No" });
    expect(studentRename.status).toBe(403);
    const renamed = await unsafe(request(app(ids.ta)).patch(path))
      .set("If-Match", '"v1"')
      .send({ title: "Updated" });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.etag).toBe('"v2"');
    const stale = await unsafe(request(app(ids.instructor)).delete(path)).set(
      "If-Match",
      '"v1"',
    );
    expect(stale.status).toBe(412);
    const convo = await unsafe(
      request(app(ids.student)).post(`${path}/conversations`),
    ).send({ bodyMarkdown: "Team?" });
    expect(convo.status).toBe(201);
    const deleted = await unsafe(request(app(ids.instructor)).delete(path)).set(
      "If-Match",
      '"v2"',
    );
    expect(deleted.status).toBe(204);
    const hidden = await safe(
      request(app(ids.student)).get(
        `${path}/conversations/${convo.body.data.id}/messages`,
      ),
    );
    expect(hidden.status).toBe(404);
    const list = await safe(request(app(ids.student)).get(root));
    expect(
      list.body.data.some(
        (item: { id: string }) => item.id === board.body.data.id,
      ),
    ).toBe(false);
  });

  it("keeps archived course Threads readable but rejects writes", async () => {
    const board = await unsafe(request(app(ids.instructor)).post(root)).send({
      title: "Archived",
    });
    const path = `${root}/${board.body.data.id}`;
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      const readable = await safe(request(app(ids.student)).get(path));
      expect(readable.status).toBe(200);
      const created = await unsafe(request(app(ids.ta)).post(root)).send({
        title: "New",
      });
      expect(created.status).toBe(409);
      const conversation = await unsafe(
        request(app(ids.student)).post(`${path}/conversations`),
      ).send({ bodyMarkdown: "Blocked" });
      expect(conversation.status).toBe(409);
      const deleted = await unsafe(
        request(app(ids.instructor)).delete(path),
      ).set("If-Match", '"v1"');
      expect(deleted.status).toBe(409);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });

  it("paginates boards, conversations, and messages with bounded opaque cursors", async () => {
    const board = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Pages",
    });
    const first = await safe(request(app(ids.student)).get(`${root}?limit=1`));
    expect(first.status).toBe(200);
    expect(first.body.page.hasMore).toBe(true);
    expect(typeof first.body.page.nextCursor).toBe("string");
    const second = await safe(
      request(app(ids.student)).get(
        `${root}?limit=1&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
      ),
    );
    expect(second.status).toBe(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const bad = await safe(
      request(app(ids.student)).get(`${root}?limit=1&cursor=broken`),
    );
    expect(bad.status).toBe(400);
    const path = `${root}/${board.body.data.id}/conversations`;
    const one = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "First",
    });
    const two = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "Second",
    });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const conversations = await safe(
      request(app(ids.student)).get(`${path}?limit=1`),
    );
    expect(conversations.status).toBe(200);
    expect(conversations.body.data).toHaveLength(1);
    expect(conversations.body.data[0].openingMessage.bodyMarkdown).toBe(
      "Second",
    );
    expect(conversations.body.page.hasMore).toBe(true);
    const detail = await safe(
      request(app(ids.student)).get(`${path}/${one.body.data.id}`),
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.openingMessage.bodyMarkdown).toBe("First");
    const messagesPath = `${path}/${one.body.data.id}/messages`;
    await unsafe(request(app(ids.ta)).post(messagesPath)).send({
      bodyMarkdown: "Reply",
    });
    const messages = await safe(
      request(app(ids.student)).get(`${messagesPath}?limit=1`),
    );
    expect(messages.status).toBe(200);
    expect(messages.body.data).toHaveLength(1);
    expect(messages.body.data[0].bodyMarkdown).toBe("Reply");
    expect(messages.body.page.hasMore).toBe(true);
    const nextMessages = await safe(
      request(app(ids.student)).get(
        `${messagesPath}?limit=1&cursor=${encodeURIComponent(messages.body.page.nextCursor)}`,
      ),
    );
    expect(nextMessages.body.data[0].bodyMarkdown).toBe("First");
    const exact = await safe(
      request(app(ids.student)).get(
        `${messagesPath}/${one.body.openingMessage.id}`,
      ),
    );
    expect(exact.status).toBe(200);
    expect(exact.body.data.bodyMarkdown).toBe("First");
  });

  it("lists conversations by latest reply activity without repeating a paged item", async () => {
    const board = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Activity order",
    });
    const path = `${root}/${board.body.data.id}/conversations`;
    const older = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "Older conversation",
    });
    const newer = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "Newer conversation",
    });
    const reply = await unsafe(
      request(app(ids.ta)).post(`${path}/${older.body.data.id}/messages`),
    ).send({ bodyMarkdown: "Bump older" });
    expect(reply.status).toBe(201);
    const first = await safe(request(app(ids.student)).get(`${path}?limit=1`));
    expect(first.status).toBe(200);
    expect(first.body.data.map((item: { id: string }) => item.id)).toEqual([
      older.body.data.id,
    ]);
    expect(first.body.page.hasMore).toBe(true);
    const second = await safe(
      request(app(ids.student)).get(
        `${path}?limit=1&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
      ),
    );
    expect(second.status).toBe(200);
    expect(second.body.data.map((item: { id: string }) => item.id)).toEqual([
      newer.body.data.id,
    ]);
    expect(second.body.page.hasMore).toBe(false);
  });

  it("returns committed changes after an opaque cursor without duplicate replay", async () => {
    const before = await safe(
      request(app(ids.student)).get(`${root}/changes?limit=100`),
    );
    expect(before.status).toBe(200);
    const cursor = before.body.page.nextCursor as string | null;
    const board = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Live",
    });
    const convo = await unsafe(
      request(app(ids.student)).post(
        `${root}/${board.body.data.id}/conversations`,
      ),
    ).send({ bodyMarkdown: "Live opening" });
    const changes = await safe(
      request(app(ids.student)).get(
        `${root}/changes?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
      ),
    );
    expect(changes.status).toBe(200);
    expect(
      changes.body.data.map((change: { kind: string }) => change.kind),
    ).toEqual(["board_created", "conversation_created"]);
    expect(changes.body.data[1].entityId).toBe(convo.body.data.id);
    expect(typeof changes.body.page.nextCursor).toBe("string");
    const repeat = await safe(
      request(app(ids.student)).get(
        `${root}/changes?after=${encodeURIComponent(changes.body.page.nextCursor)}`,
      ),
    );
    expect(repeat.status).toBe(200);
    expect(repeat.body.data).toEqual([]);
    const outsider = await safe(
      request(app(ids.outsider)).get(`${root}/changes`),
    );
    expect(outsider.status).toBe(404);
  });

  it("catches up once after disconnecting before committed signals", async () => {
    const before = await safe(request(app(ids.student)).get(`${root}/changes`));
    expect(before.status).toBe(200);
    const cursor = before.body.page.nextCursor as string | null;
    const authService = {
      session: async () => ({ user: { id: ids.student, displayName: "Member" } }),
    } as unknown as AuthService;
    const server = createServer((_request, response) => response.end());
    const live = createThreadLiveServer({
      server,
      pool,
      authService,
      frontendOrigins: new Set([environment.frontendBaseUrl]),
    });
    let socket: WebSocket | undefined;
    try {
      await live.start();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const connect = async () => {
        const client = new WebSocket(`ws://127.0.0.1:${port}/api/v1/thread-events`, {
          headers: {
            Origin: environment.frontendBaseUrl,
            Cookie: "__Host-chalktalk_session=opaque",
          },
        });
        await once(client, "open");
        client.send(JSON.stringify({ type: "subscribe", courseId: ids.course }));
        expect(JSON.parse((await once(client, "message"))[0].toString())).toEqual({
          type: "subscribed",
          courseId: ids.course,
        });
        return client;
      };
      socket = await connect();
      socket.close();
      await once(socket, "close");
      const board = await unsafe(request(app(ids.ta)).post(root)).send({
        title: "Missed while offline",
      });
      expect(board.status).toBe(201);
      const conversation = await unsafe(
        request(app(ids.student)).post(`${root}/${board.body.data.id}/conversations`),
      ).send({ bodyMarkdown: "Missed opening" });
      expect(conversation.status).toBe(201);
      socket = await connect();
      const caught = await safe(
        request(app(ids.student)).get(
          `${root}/changes${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      expect(caught.status).toBe(200);
      expect(caught.body.data.map((change: { kind: string }) => change.kind)).toEqual([
        "board_created",
        "conversation_created",
      ]);
      const repeat = await safe(
        request(app(ids.student)).get(
          `${root}/changes?after=${encodeURIComponent(caught.body.page.nextCursor)}`,
        ),
      );
      expect(repeat.body.data).toEqual([]);
    } finally {
      socket?.terminate();
      await live.stop();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("replays keyed board, conversation, and reply creates without duplicates", async () => {
    const boardRequest = () =>
      unsafe(request(app(ids.ta)).post(root))
        .set("Idempotency-Key", "thread-board-key")
        .send({ title: "Retry board" });
    const board1 = await boardRequest();
    const board2 = await boardRequest();
    expect(board1.status).toBe(201);
    expect(board2.body.data.id).toBe(board1.body.data.id);
    const reused = await unsafe(request(app(ids.ta)).post(root))
      .set("Idempotency-Key", "thread-board-key")
      .send({ title: "Different" });
    expect(reused.status).toBe(409);
    const path = `${root}/${board1.body.data.id}/conversations`;
    const convoRequest = () =>
      unsafe(request(app(ids.student)).post(path))
        .set("Idempotency-Key", "thread-convo-key")
        .send({ bodyMarkdown: "Opening once" });
    const convo1 = await convoRequest();
    const convo2 = await convoRequest();
    expect(convo1.status).toBe(201);
    expect(convo2.body.data.id).toBe(convo1.body.data.id);
    const replyPath = `${path}/${convo1.body.data.id}/messages`;
    const replyRequest = () =>
      unsafe(request(app(ids.ta)).post(replyPath))
        .set("Idempotency-Key", "thread-reply-key")
        .send({ bodyMarkdown: "Reply once" });
    const reply1 = await replyRequest();
    const reply2 = await replyRequest();
    expect(reply1.status).toBe(201);
    expect(reply2.body.data.id).toBe(reply1.body.data.id);
    const messages = await safe(request(app(ids.student)).get(replyPath));
    expect(
      messages.body.data.map(
        (message: { bodyMarkdown: string }) => message.bodyMarkdown,
      ),
    ).toEqual(["Opening once", "Reply once"]);
  });

  it("does not replay deleted opening text from a keyed conversation create", async () => {
    const board = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Replay moderation",
    });
    const path = `${root}/${board.body.data.id}/conversations`;
    const create = () =>
      unsafe(request(app(ids.student)).post(path))
        .set("Idempotency-Key", "deleted-opening-replay")
        .send({ bodyMarkdown: "Private original text" });
    const first = await create();
    expect(first.status).toBe(201);
    const messagePath = `${path}/${first.body.data.id}/messages/${first.body.openingMessage.id}`;
    const removed = await unsafe(
      request(app(ids.student)).delete(messagePath),
    ).set("If-Match", '"v1"');
    expect(removed.status).toBe(204);
    const retry = await create();
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("idempotency_key_reused");
    expect(JSON.stringify(retry.body)).not.toContain("Private original text");
    const messages = await safe(
      request(app(ids.student)).get(`${path}/${first.body.data.id}/messages`),
    );
    expect(messages.body.data[0]).toMatchObject({
      deleted: true,
      bodyMarkdown: "",
      author: null,
    });
  });

  it("hides Threads from nonmembers before body and ETag validation", async () => {
    const board = await unsafe(request(app(ids.ta)).post(root)).send({
      title: "Hidden from outsider",
    });
    const boardPath = `${root}/${board.body.data.id}`;
    const conversation = await unsafe(
      request(app(ids.student)).post(`${boardPath}/conversations`),
    ).send({ bodyMarkdown: "Opening" });
    const conversationPath = `${boardPath}/conversations/${conversation.body.data.id}`;
    const messagePath = `${conversationPath}/messages/${conversation.body.openingMessage.id}`;
    const responses = await Promise.all([
      unsafe(request(app(ids.outsider)).post(root)).send({ title: "" }),
      unsafe(request(app(ids.outsider)).patch(boardPath))
        .set("If-Match", '"v1"')
        .send({ title: "" }),
      unsafe(
        request(app(ids.outsider)).post(`${boardPath}/conversations`),
      ).send({ bodyMarkdown: "" }),
      unsafe(
        request(app(ids.outsider)).post(`${conversationPath}/messages`),
      ).send({ bodyMarkdown: "" }),
      unsafe(request(app(ids.outsider)).patch(messagePath))
        .set("If-Match", '"v1"')
        .send({ bodyMarkdown: "" }),
      unsafe(request(app(ids.outsider)).patch(messagePath)).send({
        bodyMarkdown: "Valid but no ETag",
      }),
    ]);
    for (const response of responses) expect(response.status).toBe(404);
  });
});
