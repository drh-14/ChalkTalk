import type { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "../http/app.js";
import { CollaborationSessionService, hashTicket } from "./service.js";
import { createTestSchema, seedCourse } from "./test-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";

integration("collaboration session HTTP contract", () => {
  let database: Awaited<ReturnType<typeof createTestSchema>>;
  let pool: Pool;
  let course: Awaited<ReturnType<typeof seedCourse>>;
  let other: Awaited<ReturnType<typeof seedCourse>>;
  const authSessions: Record<string, string> = {};
  let service: CollaborationSessionService;

  const app = (userId: string) =>
    createApp({
      environment,
      authService: {
        session: async () => ({
          id: authSessions[userId]!,
          user: {
            id: userId,
            email: "user@example.edu",
            displayName: "User",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            version: 1,
          },
          expiresAt: "2026-12-01T00:00:00.000Z",
          csrfToken: "csrf",
        }),
      } as unknown as AuthService,
      collaborationSessionService: service,
    });
  const unsafe = (test: request.Test) =>
    test
      .set("Cookie", cookie)
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
  const as = (name: string) => course.users[name]!;
  const create = (
    name: string,
    body: object = { anchor: { postId: course.postId } },
  ) =>
    unsafe(
      request(app(as(name))).post(
        `/api/v1/courses/${course.courseId}/collaboration-sessions`,
      ),
    ).send(body);
  const get = (name: string, path: string) =>
    request(app(as(name)))
      .get(path)
      .set("Cookie", cookie);
  async function started(name = "alice") {
    const response = await create(name, {
      anchor: { postId: course.postId },
      language: "python",
    });
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  }
  const invite = (by: string, sessionId: string, userId: string) =>
    unsafe(
      request(app(as(by))).post(
        `/api/v1/collaboration-sessions/${sessionId}/participants`,
      ),
    ).send({ userId });
  const patch = (by: string, sessionId: string, etag: string, body: object) =>
    unsafe(
      request(app(as(by))).patch(`/api/v1/collaboration-sessions/${sessionId}`),
    )
      .set("If-Match", etag)
      .send(body);

  beforeAll(async () => {
    database = await createTestSchema(url!, "collab_http");
    pool = database.pool;
    service = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
      endTimeoutMs: 300,
      endPollMs: 20,
    });
    course = await seedCourse(pool, {
      alice: "student",
      bob: "student",
      carol: "student",
      tim: "ta",
      ina: "instructor",
    });
    other = await seedCourse(pool, { olga: "student" });
    for (const [name, userId] of Object.entries({
      ...course.users,
      ...other.users,
    })) {
      const id = uuidv7();
      authSessions[userId] = id;
      await pool.query(
        "INSERT INTO sessions (id,user_id,credential_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$3,now()+interval '1 day')",
        [id, userId, Buffer.from(`${name}-credential-hash-padding-32b`)],
      );
    }
    course.users.olga = other.users.olga!;
  });
  afterAll(async () => database?.drop());

  describe("creating", () => {
    it("creates an active session with defaults, Location, and ETag", async () => {
      const response = await create("alice");
      expect(response.status).toBe(201);
      expect(response.headers.location).toBe(
        `/api/v1/collaboration-sessions/${response.body.data.id}`,
      );
      expect(response.headers.etag).toBe('"v1"');
      expect(response.body.data).toMatchObject({
        courseId: course.courseId,
        status: "active",
        anchor: { postId: course.postId },
        title: "Why does my loop never stop?",
        language: "plaintext",
        createdBy: as("alice"),
        participants: [
          { userId: as("alice"), displayName: "alice", role: "creator" },
        ],
        endedAt: null,
        version: 1,
      });
    });

    it("accepts a trimmed title and a supported language", async () => {
      const response = await create("alice", {
        anchor: { postId: course.postId },
        title: "  Office hours  ",
        language: "java",
      });
      expect(response.body.data).toMatchObject({
        title: "Office hours",
        language: "java",
      });
    });

    it("rejects invalid bodies with validation_failed", async () => {
      for (const body of [
        { anchor: { postId: course.postId }, language: "rust" },
        { anchor: { postId: course.postId }, title: "   " },
        { anchor: { postId: course.postId }, title: "x".repeat(121) },
        { anchor: { subchannelId: course.postId } },
        { anchor: { postId: course.postId }, extra: true },
        {},
      ]) {
        const response = await create("alice", body);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_failed");
      }
    });

    it("rejects deleted, duplicate, foreign, and malformed anchors", async () => {
      const deleted = uuidv7();
      await pool.query(
        "INSERT INTO posts (id,course_id,type,deleted_at) VALUES ($1,$2,'question',now())",
        [deleted, course.courseId],
      );
      for (const postId of [deleted, other.postId, "not-a-uuid"]) {
        const response = await create("alice", { anchor: { postId } });
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("cross_course_anchor");
      }
    });

    it("returns 404 for nonmembers and 409 for an archived course", async () => {
      expect((await create("olga")).status).toBe(404);
      const archived = await seedCourse(
        pool,
        { zed: "student" },
        { status: "archived" },
      );
      authSessions[archived.users.zed!] = uuidv7();
      course.users.zed = archived.users.zed!;
      const response = await unsafe(
        request(app(as("zed"))).post(
          `/api/v1/courses/${archived.courseId}/collaboration-sessions`,
        ),
      ).send({ anchor: { postId: archived.postId } });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("course_archived");
    });

    it("replays a matching idempotent create and rejects a reused key", async () => {
      const key = uuidv7();
      const first = await create("alice").set("Idempotency-Key", key);
      const replay = await create("alice").set("Idempotency-Key", key);
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(first.body.data.id);
      const reused = await create("alice", {
        anchor: { postId: course.postId },
        language: "sql",
      }).set("Idempotency-Key", key);
      expect(reused.status).toBe(409);
      expect(reused.body.error.code).toBe("idempotency_key_reused");
    });

    it("requires authentication and CSRF", async () => {
      const unauthenticated = await request(app(as("alice")))
        .post(`/api/v1/courses/${course.courseId}/collaboration-sessions`)
        .set("Origin", environment.frontendBaseUrl)
        .send({ anchor: { postId: course.postId } });
      expect(unauthenticated.status).toBe(401);
      const noCsrf = await request(app(as("alice")))
        .post(`/api/v1/courses/${course.courseId}/collaboration-sessions`)
        .set("Cookie", cookie)
        .set("Origin", environment.frontendBaseUrl)
        .send({ anchor: { postId: course.postId } });
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.body.error.code).toBe("csrf_validation_failed");
    });
  });

  describe("visibility", () => {
    it("hides a session from uninvited members and shows it to staff", async () => {
      const session = await started();
      const path = `/api/v1/collaboration-sessions/${session.id}`;
      expect((await get("bob", path)).status).toBe(404);
      expect((await get("olga", path)).status).toBe(404);
      expect((await get("tim", path)).status).toBe(200);
      const own = await get("alice", path);
      expect(own.status).toBe(200);
      expect(own.headers.etag).toBe('"v1"');
    });

    it("lists only visible sessions and excludes hidden ones before hasMore", async () => {
      const mine = await started("carol");
      const hidden = await started("alice");
      const list = await get(
        "carol",
        `/api/v1/courses/${course.courseId}/collaboration-sessions?limit=1&status=active&anchorType=post&anchorId=${course.postId}`,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([
        mine.id,
      ]);
      expect(list.body.page).toEqual({ nextCursor: null, hasMore: false });
      const staff = await get(
        "tim",
        `/api/v1/courses/${course.courseId}/collaboration-sessions?limit=1`,
      );
      expect(staff.body.data[0].id).toBe(hidden.id);
      expect(staff.body.page.hasMore).toBe(true);
      const next = await get(
        "tim",
        `/api/v1/courses/${course.courseId}/collaboration-sessions?limit=1&cursor=${staff.body.page.nextCursor}`,
      );
      expect(next.body.data[0].id).toBe(mine.id);
    });

    it("rejects invalid list parameters and foreign cursors", async () => {
      const base = `/api/v1/courses/${course.courseId}/collaboration-sessions`;
      for (const query of [
        "status=ending",
        "anchorType=subchannel",
        "limit=0",
        "cursor=bad",
      ]) {
        const response = await get("tim", `${base}?${query}`);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("invalid_request");
      }
      const staff = await get("tim", `${base}?limit=1`);
      const replayed = await get(
        "ina",
        `${base}?limit=1&cursor=${staff.body.page.nextCursor}`,
      );
      expect(replayed.status).toBe(400);
      expect((await get("olga", base)).status).toBe(404);
    });
  });

  describe("invitations", () => {
    it("lets the creator and staff invite, idempotently, and grants access", async () => {
      const session = await started();
      const invited = await invite("alice", session.id, as("bob"));
      expect(invited.status).toBe(200);
      expect(invited.headers.etag).toBe('"v2"');
      expect(invited.body.data.participants).toEqual([
        { userId: as("alice"), displayName: "alice", role: "creator" },
        { userId: as("bob"), displayName: "bob", role: "invitee" },
      ]);
      const again = await invite("tim", session.id, as("bob"));
      expect(again.body.data.participants).toHaveLength(2);
      expect(again.body.data.version).toBe(2);
      expect(
        (await get("bob", `/api/v1/collaboration-sessions/${session.id}`))
          .status,
      ).toBe(200);
    });

    it("rejects invitees managing others, non-members, and the creator's removal", async () => {
      const session = await started();
      await invite("alice", session.id, as("bob"));
      const byInvitee = await invite("bob", session.id, as("carol"));
      expect(byInvitee.status).toBe(403);
      expect(byInvitee.body.error.code).toBe("forbidden");
      const outsider = await invite("alice", session.id, as("olga"));
      expect(outsider.status).toBe(422);
      expect(outsider.body.error.code).toBe("not_course_member");
      const creator = await unsafe(
        request(app(as("tim"))).delete(
          `/api/v1/collaboration-sessions/${session.id}/participants/${as("alice")}`,
        ),
      );
      expect(creator.status).toBe(422);
      expect(creator.body.error.code).toBe("creator_not_removable");
      const removeByInvitee = await unsafe(
        request(app(as("bob"))).delete(
          `/api/v1/collaboration-sessions/${session.id}/participants/${as("bob")}`,
        ),
      );
      expect(removeByInvitee.status).toBe(403);
    });

    it("removes an invitee, revokes their tickets, and hides the session from them", async () => {
      const session = await started();
      await invite("alice", session.id, as("bob"));
      const ticket = await unsafe(
        request(app(as("bob"))).post(
          `/api/v1/collaboration-sessions/${session.id}/connection-tickets`,
        ),
      );
      expect(ticket.status).toBe(201);
      const removed = await unsafe(
        request(app(as("alice"))).delete(
          `/api/v1/collaboration-sessions/${session.id}/participants/${as("bob")}`,
        ),
      );
      expect(removed.status).toBe(204);
      const row = await pool.query(
        "SELECT revoked_at FROM collaboration_connection_tickets WHERE token_hash=$1",
        [hashTicket(ticket.body.data.ticket)],
      );
      expect(row.rows[0].revoked_at).not.toBeNull();
      expect(
        (await get("bob", `/api/v1/collaboration-sessions/${session.id}`))
          .status,
      ).toBe(404);
      const missing = await unsafe(
        request(app(as("alice"))).delete(
          `/api/v1/collaboration-sessions/${session.id}/participants/${as("bob")}`,
        ),
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("updating and ending", () => {
    it("changes title and language with If-Match", async () => {
      const session = await started();
      const updated = await patch("tim", session.id, '"v1"', {
        language: "java",
        title: "Loops",
      });
      expect(updated.status).toBe(200);
      expect(updated.headers.etag).toBe('"v2"');
      expect(updated.body.data).toMatchObject({
        language: "java",
        title: "Loops",
      });
      const stale = await patch("alice", session.id, '"v1"', { language: "c" });
      expect(stale.status).toBe(412);
      expect(stale.body.error.code).toBe("version_conflict");
      const missing = await unsafe(
        request(app(as("alice"))).patch(
          `/api/v1/collaboration-sessions/${session.id}`,
        ),
      ).send({ language: "c" });
      expect(missing.status).toBe(428);
      for (const body of [
        {},
        { status: "active" },
        { status: "ended", language: "c" },
      ]) {
        const invalid = await patch("alice", session.id, '"v2"', body);
        expect(invalid.status).toBe(422);
      }
    });

    it("forbids invitees and ends with the fallback when no collaboration server confirms", async () => {
      const session = await started();
      await invite("alice", session.id, as("bob"));
      const byInvitee = await patch("bob", session.id, '"v2"', {
        status: "ended",
      });
      expect(byInvitee.status).toBe(403);
      const startedAt = Date.now();
      const ended = await patch("alice", session.id, '"v2"', {
        status: "ended",
      });
      expect(ended.status).toBe(200);
      expect(Date.now() - startedAt).toBeLessThan(5000);
      expect(ended.body.data.status).toBe("ended");
      expect(ended.body.data.endedAt).not.toBeNull();
      const again = await patch("alice", session.id, ended.headers.etag, {
        status: "ended",
      });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("session_ended");
      const ticket = await unsafe(
        request(app(as("alice"))).post(
          `/api/v1/collaboration-sessions/${session.id}/connection-tickets`,
        ),
      );
      expect(ticket.status).toBe(409);
      expect(ticket.body.error.code).toBe("session_ended");
      expect((await invite("alice", session.id, as("carol"))).status).toBe(409);
      expect(
        (await get("bob", `/api/v1/collaboration-sessions/${session.id}`))
          .status,
      ).toBe(200);
    });

    it("notifies the collaboration server of updates, removals, and endings", async () => {
      const session = await started();
      await invite("alice", session.id, as("bob"));
      const listener = await pool.connect();
      const events: unknown[] = [];
      await listener.query("LISTEN collaboration_events");
      // Notifications are database-wide, so other test schemas' events arrive too.
      listener.on("notification", (message) => {
        const event = JSON.parse(message.payload!);
        if (event.sessionId === session.id) events.push(event);
      });
      await patch("alice", session.id, '"v2"', { language: "sql" });
      await unsafe(
        request(app(as("alice"))).delete(
          `/api/v1/collaboration-sessions/${session.id}/participants/${as("bob")}`,
        ),
      );
      await patch("alice", session.id, '"v4"', { status: "ended" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      listener.release();
      expect(events).toEqual([
        { type: "session_updated", sessionId: session.id },
        { type: "access_changed", sessionId: session.id, userIds: [as("bob")] },
        { type: "session_ending", sessionId: session.id },
        { type: "session_ended", sessionId: session.id },
      ]);
    });

    it("ends after the collaboration server confirms", async () => {
      const session = await started();
      const listener = await pool.connect();
      await listener.query("LISTEN collaboration_events");
      listener.on("notification", (message) => {
        const event = JSON.parse(message.payload!);
        if (event.type === "session_ending" && event.sessionId === session.id)
          void pool.query(
            "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=now(),version=version+1 WHERE id=$1",
            [session.id],
          );
      });
      const ended = await patch("ina", session.id, '"v1"', { status: "ended" });
      listener.release();
      expect(ended.status).toBe(200);
      expect(ended.body.data.status).toBe("ended");
      expect(ended.body.data.version).toBe(3);
    });
  });

  describe("tickets and snapshots", () => {
    it("issues a hashed, five-minute, no-store ticket bound to the login session", async () => {
      const session = await started();
      const response = await unsafe(
        request(app(as("alice"))).post(
          `/api/v1/collaboration-sessions/${session.id}/connection-tickets`,
        ),
      );
      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      const { ticket, webSocketUrl, documentId, expiresAt } =
        response.body.data;
      expect(webSocketUrl).toBe("wss://app.example.edu/collaboration");
      expect(documentId).toBe(`collaboration-session:${session.id}`);
      expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(
        4 * 60 * 1000,
      );
      const stored = await pool.query(
        "SELECT token_hash,user_id,auth_session_id,permission FROM collaboration_connection_tickets WHERE collaboration_session_id=$1",
        [session.id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].token_hash.equals(hashTicket(ticket))).toBe(true);
      expect(stored.rows[0].token_hash.toString("base64url")).not.toBe(ticket);
      expect(stored.rows[0]).toMatchObject({
        user_id: as("alice"),
        auth_session_id: authSessions[as("alice")],
        permission: "write",
      });
      const hidden = await unsafe(
        request(app(as("bob"))).post(
          `/api/v1/collaboration-sessions/${session.id}/connection-tickets`,
        ),
      );
      expect(hidden.status).toBe(404);
    });

    it("returns the persisted snapshot with no-store to participants only", async () => {
      const session = await started();
      const empty = await get(
        "alice",
        `/api/v1/collaboration-sessions/${session.id}/snapshot`,
      );
      expect(empty.status).toBe(200);
      expect(empty.body.data).toMatchObject({
        collaborationSessionId: session.id,
        documentId: `collaboration-session:${session.id}`,
        sessionStatus: "active",
        content: "",
      });
      await pool.query(
        "INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection,persisted_at) VALUES ($1,$2,'print(1)','2026-09-20T14:31:58Z')",
        [session.id, Buffer.from([0, 0])],
      );
      const saved = await get(
        "tim",
        `/api/v1/collaboration-sessions/${session.id}/snapshot`,
      );
      expect(saved.headers["cache-control"]).toBe("no-store");
      expect(saved.body.data).toMatchObject({
        content: "print(1)",
        persistedAt: "2026-09-20T14:31:58.000Z",
      });
      expect(typeof saved.body.data.capturedAt).toBe("string");
      expect(
        (
          await get(
            "bob",
            `/api/v1/collaboration-sessions/${session.id}/snapshot`,
          )
        ).status,
      ).toBe(404);
    });
  });
});
