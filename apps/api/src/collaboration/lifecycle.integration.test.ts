import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { CourseService } from "../courses/service.js";
import { JobWorker } from "../jobs/worker.js";
import { PostService } from "../posts/service.js";
import { endCollaborationSessions } from "./lifecycle.js";
import {
  CollaborationSessionService,
  type CollaborationEvent,
} from "./service.js";
import { createTestSchema, seedCourse } from "./test-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration("collaboration session lifecycle effects", () => {
  let database: Awaited<ReturnType<typeof createTestSchema>>;
  let pool: Pool;
  let sessions: CollaborationSessionService;
  let listener: PoolClient;
  let events: CollaborationEvent[] = [];
  const etag = async (table: string, where: string, values: unknown[]) => {
    const row = await pool.query(
      `SELECT version FROM ${table} WHERE ${where}`,
      values,
    );
    return `"v${row.rows[0].version}"`;
  };
  async function course() {
    const fixture = await seedCourse(pool, {
      ina: "instructor",
      alice: "student",
      bob: "student",
      tim: "ta",
    });
    const session = (
      await sessions.create(fixture.courseId, fixture.users.alice!, {
        title: "Course collaboration",
      })
    ).value;
    await sessions.invite(session.id, fixture.users.alice!, fixture.users.bob!);
    return { ...fixture, session };
  }
  const state = async (id: string) =>
    (
      await pool.query(
        "SELECT lifecycle_state,ended_at FROM collaboration_sessions WHERE id=$1",
        [id],
      )
    ).rows[0];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  beforeAll(async () => {
    database = await createTestSchema(url!, "collab_lifecycle");
    pool = database.pool;
    sessions = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
      endTimeoutMs: 100,
    });
    listener = await pool.connect();
    await listener.query("LISTEN collaboration_events");
    listener.on("notification", (message) =>
      events.push(JSON.parse(message.payload!)),
    );
  });
  beforeEach(() => {
    events = [];
  });
  afterAll(async () => {
    listener?.release();
    await database?.drop();
  });

  it("ends sessions when the course is archived", async () => {
    const fixture = await course();
    await new CourseService(pool).update(
      fixture.courseId,
      fixture.users.ina!,
      await etag("courses", "id=$1", [fixture.courseId]),
      { status: "archived" },
    );
    await settle();
    expect((await state(fixture.session.id)).lifecycle_state).toBe("ended");
    expect(events).toContainEqual({
      type: "session_ended",
      sessionId: fixture.session.id,
    });
    await expect(
      sessions.ticket(fixture.session.id, fixture.users.alice!, uuidv7()),
    ).rejects.toMatchObject({ status: 409, code: "course_archived" });
  });

  it("does not create an active session after a concurrent archive sweep", async () => {
    const fixture = await course();
    const transition = await pool.connect();
    await transition.query("BEGIN");
    try {
      await transition.query("UPDATE courses SET status='archived' WHERE id=$1", [
        fixture.courseId,
      ]);
      await endCollaborationSessions(transition, { courseId: fixture.courseId });
      let settled = false;
      const creating = sessions.create(fixture.courseId, fixture.users.alice!, {
        title: "Late session",
      });
      void creating.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await transition.query("COMMIT");
      await expect(creating).rejects.toMatchObject({
        status: 409,
        code: "course_archived",
      });
      const active = await pool.query(
        "SELECT id FROM collaboration_sessions WHERE course_id=$1 AND lifecycle_state='active'",
        [fixture.courseId],
      );
      expect(active.rowCount).toBe(0);
    } finally {
      await transition.query("ROLLBACK");
      transition.release();
    }
  });

  it.each(["course removal", "account deletion"])(
    "does not create an active session after concurrent %s",
    async (departure) => {
      const fixture = await course();
      const transition = await pool.connect();
      await transition.query("BEGIN");
      try {
        if (departure === "account deletion")
          await transition.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            fixture.users.alice,
          ]);
        if (departure === "course removal")
          await transition.query("SELECT id FROM courses WHERE id=$1 FOR UPDATE", [
            fixture.courseId,
          ]);
        await endCollaborationSessions(transition, {
          creatorId: fixture.users.alice!,
          courseId: fixture.courseId,
        });
        let settled = false;
        const creating = sessions.create(
          fixture.courseId,
          fixture.users.alice!,
          { title: "Late session" },
        );
        void creating.then(
          () => (settled = true),
          () => (settled = true),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        await transition.query(
          "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
          [fixture.courseId, fixture.users.alice],
        );
        if (departure === "account deletion")
          await transition.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
            fixture.users.alice,
          ]);
        await transition.query("COMMIT");
        await expect(creating).rejects.toMatchObject({ status: 404 });
        const active = await pool.query(
          "SELECT id FROM collaboration_sessions WHERE course_id=$1 AND created_by_user_id=$2 AND lifecycle_state='active'",
          [fixture.courseId, fixture.users.alice],
        );
        expect(active.rowCount).toBe(0);
      } finally {
        await transition.query("ROLLBACK");
        transition.release();
      }
    },
  );

  it("keeps a course session and its participant access when the former post is deleted", async () => {
    const fixture = await course();
    await new PostService(pool).delete(
      fixture.postId,
      fixture.users.ina!,
      await etag("posts", "id=$1", [fixture.postId]),
    );
    await settle();
    expect((await state(fixture.session.id)).lifecycle_state).toBe("active");
    expect(events).not.toContainEqual({
      type: "session_ended",
      sessionId: fixture.session.id,
    });
    await expect(
      sessions.get(fixture.session.id, fixture.users.alice!),
    ).resolves.toMatchObject({ status: "active" });
    await expect(
      sessions.get(fixture.session.id, fixture.users.tim!),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a course session when its former post is merged", async () => {
    const fixture = await course();
    const canonical = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Canonical','Body')",
      [canonical, fixture.courseId, fixture.users.ina],
    );
    await new PostService(pool).update(
      fixture.postId,
      fixture.users.tim!,
      await etag("posts", "id=$1", [fixture.postId]),
      { duplicateStatus: "confirmed", duplicateOfPostId: canonical } as never,
    );
    await settle();
    expect((await state(fixture.session.id)).lifecycle_state).toBe("active");
    await expect(
      sessions.get(fixture.session.id, fixture.users.bob!),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("revokes access when an invitee leaves the course", async () => {
    const fixture = await course();
    await new CourseService(pool).removeMember(
      fixture.courseId,
      fixture.users.bob!,
      fixture.users.bob!,
      undefined,
      true,
    );
    await settle();
    expect(events).toContainEqual({
      type: "access_changed",
      courseId: fixture.courseId,
      userIds: [fixture.users.bob],
    });
    const participants = await pool.query(
      "SELECT user_id FROM collaboration_participants WHERE collaboration_session_id=$1",
      [fixture.session.id],
    );
    expect(participants.rows.map((row) => row.user_id)).toEqual([
      fixture.users.alice,
    ]);
    await expect(
      sessions.get(fixture.session.id, fixture.users.bob!),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("ends a creator's sessions when they leave, preserving a last-saved snapshot for invitees", async () => {
    const fixture = await course();
    await pool.query(
      "INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection) VALUES ($1,$2,$3)",
      [fixture.session.id, Buffer.from([0, 0]), "Earlier saved text"],
    );
    await new CourseService(pool).removeMember(
      fixture.courseId,
      fixture.users.alice!,
      fixture.users.alice!,
      undefined,
      true,
    );
    await settle();
    expect(await state(fixture.session.id)).toMatchObject({
      lifecycle_state: "ended",
    });
    expect(events).toContainEqual({
      type: "session_ended",
      sessionId: fixture.session.id,
    });
    await expect(
      sessions.snapshot(fixture.session.id, fixture.users.bob!),
    ).resolves.toMatchObject({
      sessionStatus: "ended",
      content: "Earlier saved text",
      finalSnapshotConfirmed: false,
    });
    await expect(
      sessions.get(fixture.session.id, fixture.users.alice!),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not grant a TA access unless invited, and retains invited access after demotion", async () => {
    const fixture = await course();
    const own = (
      await sessions.create(fixture.courseId, fixture.users.tim!, {
        title: "TA collaboration",
      })
    ).value;
    await expect(
      sessions.get(fixture.session.id, fixture.users.tim!),
    ).rejects.toMatchObject({ status: 404 });
    await sessions.invite(
      fixture.session.id,
      fixture.users.alice!,
      fixture.users.tim!,
    );
    await expect(
      sessions.get(fixture.session.id, fixture.users.tim!),
    ).resolves.toBeTruthy();
    await new CourseService(pool).updateMember(
      fixture.courseId,
      fixture.users.ina!,
      fixture.users.tim!,
      await etag("course_memberships", "course_id=$1 AND user_id=$2", [
        fixture.courseId,
        fixture.users.tim,
      ]),
      "student",
    );
    await settle();
    expect(events).toContainEqual({
      type: "access_changed",
      courseId: fixture.courseId,
      userIds: [fixture.users.tim],
    });
    await expect(
      sessions.get(fixture.session.id, fixture.users.tim!),
    ).resolves.toMatchObject({ status: "active" });
    await expect(
      sessions.get(own.id, fixture.users.tim!),
    ).resolves.toMatchObject({
      createdBy: fixture.users.tim,
    });
  });

  it("notifies on logout", async () => {
    const fixture = await course();
    const authSession = uuidv7();
    await pool.query(
      "INSERT INTO sessions (id,user_id,credential_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$3,now()+interval '1 day')",
      [authSession, fixture.users.bob, Buffer.from(`logout-${authSession}`)],
    );
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
    });
    await new AuthService(pool, environment, {
      send: async () => undefined,
    } as never).logout(authSession);
    await settle();
    expect(events).toContainEqual({
      type: "access_changed",
      userIds: [fixture.users.bob],
    });
  });

  it("removes session data when course deletion cleanup runs", async () => {
    const fixture = await course();
    await pool.query(
      "INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection) VALUES ($1,$2,'x')",
      [fixture.session.id, Buffer.from([0, 0])],
    );
    await new CourseService(pool).delete(
      fixture.courseId,
      fixture.users.ina!,
      await etag("courses", "id=$1", [fixture.courseId]),
    );
    await settle();
    expect((await state(fixture.session.id)).lifecycle_state).toBe("ended");
    const worker = new JobWorker(pool);
    while (await worker.runOnce()) {
      // Drain queued jobs, including the course deletion.
    }
    for (const table of [
      "collaboration_sessions",
      "collaboration_documents",
      "collaboration_participants",
      "collaboration_connection_tickets",
    ]) {
      const column =
        table === "collaboration_sessions" ? "id" : "collaboration_session_id";
      const count = await pool.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`,
        [fixture.session.id],
      );
      expect(count.rows[0].count).toBe(0);
    }
  });
});
