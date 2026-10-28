import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { NotificationService } from "../notifications/service.js";
import { ThreadService } from "../threads/service.js";
import { ThreadWatchService } from "../threads/watch.js";
import { onThreadMessageCreated } from "../threads/watch.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `thread_watches_${process.pid}_${Date.now()}`;
const ids = {
  organization: uuidv7(),
  course: uuidv7(),
  board: uuidv7(),
  conversation: uuidv7(),
  author: uuidv7(),
  watcher: uuidv7(),
  other: uuidv7(),
  outsider: uuidv7(),
  opening: uuidv7(),
  older: uuidv7(),
  recent: uuidv7(),
  future: uuidv7(),
};
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
let admin: Pool;
let pool: Pool;
const base = `/api/v1/courses/${ids.course}/threads/${ids.board}/conversations/${ids.conversation}`;
function app(userId: string, watches = new ThreadWatchService(pool)) {
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
    notificationService: new NotificationService(pool),
    threadService: new ThreadService(pool),
    threadWatchService: watches,
  });
}
const safe = (userId: string, path: string) =>
  request(app(userId))
    .get(path)
    .set("Cookie", "__Host-chalktalk_session=opaque");
const unsafe = (userId: string, path: string, method: "put" | "post") => {
  const agent = request(app(userId));
  return agent[method](path)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
};

integration("Thread watches, read state, and bell notifications", () => {
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
      ids.author,
      ids.watcher,
      ids.other,
      ids.outsider,
    ].entries())
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [
          userId,
          ids.organization,
          `watch${index}@example.edu`,
          `Member ${index}`,
        ],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.organization, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'instructor'),($1,$3,'student'),($1,$4,'student')",
      [ids.course, ids.author, ids.watcher, ids.other],
    );
    await pool.query(
      "INSERT INTO thread_boards(id,course_id,title) VALUES ($1,$2,'Find a team')",
      [ids.board, ids.course],
    );
    await pool.query(
      "INSERT INTO thread_conversations(id,course_id,board_id,next_message_ordinal) VALUES ($1,$2,$3,5)",
      [ids.conversation, ids.course, ids.board],
    );
    for (const [ordinal, id, author] of [
      [1, ids.opening, ids.author],
      [2, ids.older, ids.author],
      [3, ids.recent, ids.other],
      [4, ids.future, ids.author],
    ] as const)
      await pool.query(
        "INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          ids.course,
          ids.board,
          ids.conversation,
          ordinal,
          author,
          author === ids.author ? "instructor" : "student",
          ordinal === 4
            ? "**Bold** [link](https://example.com)\nsecond\nthird\nfourth"
            : `Message ${ordinal}`,
        ],
      );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("requires membership, watches a conversation, and counts only loaded messages as read", async () => {
    expect((await safe(ids.outsider, `${base}/watch`)).status).toBe(404);
    expect((await safe(ids.watcher, `${base}/watch`)).body.data).toEqual({
      watching: false,
      noticesEnabled: false,
    });
    const followed = await unsafe(ids.watcher, `${base}/watch`, "put").send({
      noticesEnabled: true,
    });
    expect(followed.status).toBe(200);
    expect(followed.body.data).toEqual({
      watching: true,
      noticesEnabled: true,
    });
    const countPath = `/api/v1/courses/${ids.course}/threads/unread-count`;
    expect((await safe(ids.watcher, countPath)).body.data).toEqual({
      count: 4,
    });
    const read = await unsafe(ids.watcher, `${base}/read`, "post").send({
      messageIds: [ids.recent, ids.future],
    });
    expect(read.status).toBe(204);
    expect((await safe(ids.watcher, countPath)).body.data).toEqual({
      count: 2,
    });
    const invalid = await unsafe(ids.watcher, `${base}/read`, "post").send({
      messageIds: [ids.opening, ids.outsider],
    });
    expect(invalid.status).toBe(422);
    expect((await safe(ids.watcher, countPath)).body.data).toEqual({
      count: 2,
    });
  });

  it("reads live messages when another loaded message was deleted", async () => {
    const loaded = await safe(ids.other, `${base}/messages`);
    expect(loaded.status).toBe(200);
    expect(
      loaded.body.data.map((message: { id: string }) => message.id),
    ).toContain(ids.older);
    await pool.query(
      "UPDATE thread_messages SET deleted_at=clock_timestamp() WHERE id=$1",
      [ids.older],
    );
    try {
      const read = await unsafe(ids.other, `${base}/read`, "post").send({
        messageIds: [ids.older, ids.opening],
      });
      expect(read.status).toBe(204);
      const recorded = await pool.query<{ message_id: string }>(
        "SELECT message_id FROM thread_message_reads WHERE user_id=$1 AND message_id=ANY($2::uuid[]) ORDER BY message_id",
        [ids.other, [ids.older, ids.opening]],
      );
      expect(recorded.rows.map((row) => row.message_id)).toEqual([ids.opening]);
      const foreign = await unsafe(ids.other, `${base}/read`, "post").send({
        messageIds: [ids.recent, ids.outsider],
      });
      expect(foreign.status).toBe(422);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM thread_message_reads WHERE user_id=$1 AND message_id=$2",
            [ids.other, ids.recent],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        "UPDATE thread_messages SET deleted_at=NULL WHERE id=$1",
        [ids.older],
      );
    }
  });

  it("keeps an unfollowed watch and unread count but suppresses new reply notices", async () => {
    const unfollowed = await unsafe(ids.watcher, `${base}/watch`, "put").send({
      noticesEnabled: false,
    });
    expect(unfollowed.status).toBe(200);
    expect(unfollowed.body.data).toEqual({
      watching: true,
      noticesEnabled: false,
    });
    const read = await safe(ids.watcher, `${base}/watch`);
    expect(read.body.data).toEqual({ watching: true, noticesEnabled: false });
    expect(
      (
        await safe(
          ids.watcher,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).body.data.count,
    ).toBe(2);
    const bell = await safe(ids.watcher, "/api/v1/users/me/notifications");
    expect(bell.status).toBe(200);
    expect(bell.body.data).toEqual([]);
  });

  it("puts a reply only in enabled watchers' bell and dismissal does not read messages", async () => {
    await unsafe(ids.watcher, `${base}/watch`, "put").send({
      noticesEnabled: true,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await onThreadMessageCreated(client, {
        courseId: ids.course,
        conversationId: ids.conversation,
        messageId: ids.future,
        actorUserId: ids.author,
        isOpening: false,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const bell = await safe(ids.watcher, "/api/v1/users/me/notifications");
    expect(bell.status).toBe(200);
    expect(bell.body.data).toEqual([
      expect.objectContaining({
        kind: "thread_reply_created",
        courseId: ids.course,
        threadId: ids.board,
        threadTitle: "Find a team",
        conversationId: ids.conversation,
        messageId: ids.future,
        preview: "Bold link\nsecond\nthird",
      }),
    ]);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications/unread-count"))
        .body.data.count,
    ).toBe(1);
    const cardId = bell.body.data[0].id;
    expect(
      (
        await unsafe(
          ids.watcher,
          "/api/v1/users/me/notifications/read",
          "post",
        ).send({ ids: [cardId] })
      ).status,
    ).toBe(204);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications/unread-count"))
        .body.data.count,
    ).toBe(0);
    expect(
      (
        await safe(
          ids.watcher,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).body.data.count,
    ).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM jobs WHERE kind='send_notification_email'",
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("keeps archived-course unread state readable but rejects watch and read writes", async () => {
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    expect((await safe(ids.watcher, `${base}/watch`)).status).toBe(200);
    expect(
      (
        await safe(
          ids.watcher,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await unsafe(ids.watcher, `${base}/watch`, "put").send({
          noticesEnabled: false,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await unsafe(ids.watcher, `${base}/read`, "post").send({
          messageIds: [ids.opening],
        })
      ).status,
    ).toBe(409);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
  });

  it("serializes watch and read writes with course archiving", async () => {
    await pool.query(
      "DELETE FROM thread_message_reads WHERE message_id=$1 AND user_id=$2",
      [ids.opening, ids.other],
    );
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE courses SET status='archived' WHERE id=$1", [
        ids.course,
      ]);
      let watchSettled = false;
      let readSettled = false;
      const watch = unsafe(ids.other, `${base}/watch`, "put")
        .send({ noticesEnabled: true })
        .then((result) => {
          watchSettled = true;
          return result;
        });
      const read = unsafe(ids.other, `${base}/read`, "post")
        .send({ messageIds: [ids.opening] })
        .then((result) => {
          readSettled = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(watchSettled).toBe(false);
      expect(readSettled).toBe(false);
      await blocker.query("COMMIT");
      expect((await watch).status).toBe(409);
      expect((await read).status).toBe(409);
      expect((await safe(ids.other, `${base}/watch`)).body.data.watching).toBe(
        false,
      );
      expect(
        (
          await pool.query(
            "SELECT 1 FROM thread_message_reads WHERE message_id=$1 AND user_id=$2",
            [ids.opening, ids.other],
          )
        ).rowCount,
      ).toBe(0);
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
    }
  });

  it("paginates post and Thread cards together and marks both kinds read", async () => {
    const postId = uuidv7();
    const postNoticeId = uuidv7();
    const threadNoticeId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Existing question','Body')",
      [postId, ids.course, ids.author],
    );
    await pool.query(
      "INSERT INTO notifications(id,user_id,course_id,post_id,kind,actor_user_id,created_at) VALUES ($1,$2,$3,$4,'answer_created',$5,clock_timestamp()-interval '1 second')",
      [postNoticeId, ids.watcher, ids.course, postId, ids.author],
    );
    await pool.query(
      "INSERT INTO thread_notifications(id,course_id,conversation_id,message_id,recipient_user_id,actor_user_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())",
      [
        threadNoticeId,
        ids.course,
        ids.conversation,
        ids.future,
        ids.watcher,
        ids.author,
      ],
    );
    const first = await safe(
      ids.watcher,
      "/api/v1/users/me/notifications?limit=1&unread=true",
    );
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual([
      expect.objectContaining({
        id: threadNoticeId,
        kind: "thread_reply_created",
      }),
    ]);
    expect(first.body.page.hasMore).toBe(true);
    const second = await safe(
      ids.watcher,
      `/api/v1/users/me/notifications?limit=1&unread=true&cursor=${first.body.page.nextCursor}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual([
      expect.objectContaining({ id: postNoticeId, kind: "answer_created" }),
    ]);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications/unread-count"))
        .body.data.count,
    ).toBe(2);
    expect(
      (
        await unsafe(
          ids.watcher,
          "/api/v1/users/me/notifications/read",
          "post",
        ).send({ ids: [threadNoticeId, postNoticeId] })
      ).status,
    ).toBe(204);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications/unread-count"))
        .body.data.count,
    ).toBe(0);
  });

  it("pages mixed notifications in PostgreSQL microsecond order", async () => {
    const postId = uuidv7();
    const newerPostNotice = "00000000-0000-4000-8000-000000000001";
    const olderThreadNotice = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Precision','Body')",
      [postId, ids.course, ids.author],
    );
    await pool.query(
      "INSERT INTO notifications(id,user_id,course_id,post_id,kind,actor_user_id,created_at) VALUES ($1,$2,$3,$4,'answer_created',$5,'2099-01-01 00:00:00.123900+00')",
      [newerPostNotice, ids.watcher, ids.course, postId, ids.author],
    );
    await pool.query(
      "INSERT INTO thread_notifications(id,course_id,conversation_id,message_id,recipient_user_id,actor_user_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,'2099-01-01 00:00:00.123100+00')",
      [
        olderThreadNotice,
        ids.course,
        ids.conversation,
        ids.future,
        ids.watcher,
        ids.author,
      ],
    );
    const first = await safe(
      ids.watcher,
      "/api/v1/users/me/notifications?limit=1&unread=true",
    );
    expect(first.status).toBe(200);
    expect(first.body.data.map((item: { id: string }) => item.id)).toEqual([
      newerPostNotice,
    ]);
    const second = await safe(
      ids.watcher,
      `/api/v1/users/me/notifications?limit=1&unread=true&cursor=${first.body.page.nextCursor}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data.map((item: { id: string }) => item.id)).toEqual([
      olderThreadNotice,
    ]);
    await unsafe(
      ids.watcher,
      "/api/v1/users/me/notifications/read",
      "post",
    ).send({ ids: [newerPostNotice, olderThreadNotice] });
  });

  it("hides bell cards and unread content after board deletion or membership loss", async () => {
    await pool.query(
      "UPDATE thread_boards SET deleted_at=clock_timestamp() WHERE id=$1",
      [ids.board],
    );
    expect(
      (
        await safe(ids.watcher, "/api/v1/users/me/notifications")
      ).body.data.filter(
        (item: { kind: string }) => item.kind === "thread_reply_created",
      ),
    ).toEqual([]);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications/unread-count"))
        .body.data.count,
    ).toBe(0);
    expect(
      (
        await safe(
          ids.watcher,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).body.data.count,
    ).toBe(0);
    await pool.query("UPDATE thread_boards SET deleted_at=NULL WHERE id=$1", [
      ids.board,
    ]);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.watcher],
    );
    expect((await safe(ids.watcher, `${base}/watch`)).status).toBe(404);
    expect(
      (
        await safe(
          ids.watcher,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await safe(ids.watcher, "/api/v1/users/me/notifications")).body.data,
    ).toEqual([]);
  });
  it("retries a failed opening read without marking a concurrent reply", async () => {
    const watch = await unsafe(ids.other, `${base}/watch`, "put").send({
      noticesEnabled: false,
    });
    expect(watch.status).toBe(200);
    const loaded = await safe(ids.other, `${base}/messages`);
    expect(loaded.status).toBe(200);
    const loadedIds = loaded.body.data.map(
      (message: { id: string }) => message.id,
    );
    await pool.query(`CREATE FUNCTION reject_thread_read() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'read state temporarily unavailable'; END $$`);
    await pool.query(`CREATE TRIGGER reject_thread_read BEFORE INSERT ON thread_message_reads
      FOR EACH ROW EXECUTE FUNCTION reject_thread_read()`);
    try {
      const failed = await unsafe(ids.other, `${base}/read`, "post").send({
        messageIds: loadedIds,
      });
      expect(failed.status).toBe(500);
    } finally {
      await pool.query(
        "DROP TRIGGER reject_thread_read ON thread_message_reads",
      );
      await pool.query("DROP FUNCTION reject_thread_read()");
    }
    const beforeRetry = await pool.query(
      "SELECT 1 FROM thread_message_reads WHERE user_id=$1 AND message_id=ANY($2::uuid[])",
      [ids.other, loadedIds],
    );
    expect(beforeRetry.rowCount).toBe(0);
    const reply = await unsafe(ids.author, `${base}/messages`, "post").send({
      bodyMarkdown: "Concurrent reply",
    });
    expect(reply.status).toBe(201);
    const retry = await unsafe(ids.other, `${base}/read`, "post").send({
      messageIds: loadedIds,
    });
    expect(retry.status).toBe(204);
    const reads = await pool.query<{ message_id: string }>(
      "SELECT message_id FROM thread_message_reads WHERE user_id=$1 AND message_id=ANY($2::uuid[])",
      [ids.other, [...loadedIds, reply.body.data.id]],
    );
    expect(reads.rows.map((row) => row.message_id).sort()).toEqual(
      loadedIds.sort(),
    );
    expect(
      (
        await safe(
          ids.other,
          `/api/v1/courses/${ids.course}/threads/unread-count`,
        )
      ).body.data.count,
    ).toBe(1);
  });
});
