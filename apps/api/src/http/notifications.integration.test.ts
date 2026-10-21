import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { NotificationService } from "../notifications/service.js";
import { PostService } from "../posts/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `notifications_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  otherCourse: "01a0e5cc-58ae-7009-9f43-e69b17afef06",
  asker: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  classmate: "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c",
  ta: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
  outsider: "01a0e5cc-58ae-7009-9f43-e237164911da",
  gone: "01a0e5cc-58ae-7009-9f43-f1e2d3c4b5a6",
};
const names: Record<string, string> = {
  [ids.asker]: "Asker",
  [ids.classmate]: "Classmate",
  [ids.ta]: "Teaching Assistant",
  [ids.instructor]: "Instructor",
  [ids.outsider]: "Outsider",
  [ids.gone]: "Gone",
};
let admin: Pool;
let pool: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";
function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: "01a0e5cc-58af-7467-8ab1-740de2b8c8c3",
        user: {
          id: userId,
          email: "user@example.edu",
          displayName: names[userId]!,
          notificationEmails: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        expiresAt: "2026-12-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
    answerService: new AnswerService(pool),
    followupService: new FollowupService(pool),
    notificationService: new NotificationService(pool),
  });
}
function unsafe(test: request.Test) {
  return test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
async function question(userId: string, extra: object = {}) {
  const created = await unsafe(
    request(app(userId)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({
    type: "question",
    title: "Why?",
    bodyMarkdown: "Because.",
    ...extra,
  });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}
async function inbox(userId: string, query = "") {
  const listed = await get(userId, `/api/v1/users/me/notifications${query}`);
  expect(listed.status).toBe(200);
  return listed.body.data as {
    id: string;
    kind: string;
    postId: string;
    postTitle: string;
    courseName: string;
    actor: { displayName: string } | null;
    readAt: string | null;
  }[];
}
async function clearAll() {
  await pool.query("DELETE FROM notifications");
  await pool.query("DELETE FROM jobs WHERE kind='send_notification_email'");
}

integration("notifications HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    for (const [key, id] of Object.entries(ids))
      if (!["organization", "course", "otherCourse"].includes(key))
        await pool.query(
          "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
          [id, ids.organization, `${key}@example.edu`, names[id]],
        );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH'),($4,$2,$3,'Chemistry','BCDEFGHI')",
      [ids.course, ids.organization, ids.instructor, ids.otherCourse],
    );
    await pool.query(
      `INSERT INTO course_memberships (course_id,user_id,role) VALUES
       ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($1,$5,'instructor'),($1,$6,'student'),($7,$8,'student')`,
      [
        ids.course,
        ids.asker,
        ids.classmate,
        ids.ta,
        ids.instructor,
        ids.gone,
        ids.otherCourse,
        ids.outsider,
      ],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("enforces notification keys, kinds, and cascades in the schema", async () => {
    const postId = await question(ids.asker);
    await expect(
      pool.query(
        "INSERT INTO notifications (id,user_id,course_id,post_id,kind) VALUES (gen_random_uuid(),$1,$2,$3,'liked')",
        [ids.classmate, ids.course, postId],
      ),
    ).rejects.toThrow(/check/);
    await expect(
      pool.query(
        "INSERT INTO post_follows (post_id,course_id,user_id,following) VALUES ($1,$2,$3,true)",
        [postId, ids.course, ids.outsider],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      pool.query(
        "INSERT INTO notifications (id,user_id,course_id,post_id,kind) VALUES (gen_random_uuid(),$1,$2,$3,'answer_created')",
        [ids.classmate, ids.otherCourse, postId],
      ),
    ).rejects.toThrow(/foreign key/);
    const throwaway = await question(ids.asker);
    await pool.query(
      "INSERT INTO notifications (id,user_id,course_id,post_id,kind) VALUES (gen_random_uuid(),$1,$2,$3,'answer_created')",
      [ids.classmate, ids.course, throwaway],
    );
    await pool.query(
      "INSERT INTO course_read_marks (course_id,user_id,read_before) VALUES ($1,$2,now())",
      [ids.course, ids.gone],
    );
    await pool.query("DELETE FROM posts WHERE id=$1", [throwaway]);
    const left = await pool.query(
      "SELECT (SELECT count(*)::int FROM notifications WHERE post_id=$1) AS n,(SELECT count(*)::int FROM post_follows WHERE post_id=$1) AS f,(SELECT count(*)::int FROM post_reads WHERE post_id=$1) AS r",
      [throwaway],
    );
    expect(left.rows[0]).toEqual({ n: 0, f: 0, r: 0 });
    const defaults = await pool.query(
      "SELECT notification_emails FROM users WHERE id=$1",
      [ids.asker],
    );
    expect(defaults.rows[0].notification_emails).toBe(false);
    await pool.query("DELETE FROM course_read_marks");
    await clearAll();
  });

  it("notifies the asker of a TA answer, follows automatically, and keeps an unfollow", async () => {
    const postId = await question(ids.asker);
    const own = await get(ids.asker, `/api/v1/posts/${postId}`);
    expect(own.headers["cache-control"]).toBe("private, no-store");
    expect(own.body.data).toMatchObject({ following: true, unread: false });
    const feed = await get(ids.ta, `/api/v1/courses/${ids.course}/posts`);
    expect(
      feed.body.data.find((post: { id: string }) => post.id === postId),
    ).toMatchObject({ following: false, unread: true });
    // Opening the post reads it, so its own response is already read.
    const opened = await get(ids.ta, `/api/v1/posts/${postId}`);
    expect(opened.body.data).toMatchObject({ following: false, unread: false });

    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Staff answer" });
    expect(answered.status).toBe(201);
    const items = await inbox(ids.asker);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "answer_created",
      postId,
      postTitle: "Why?",
      courseName: "Physics",
      actor: { displayName: "Teaching Assistant" },
      readAt: null,
    });
    expect(await inbox(ids.ta)).toEqual([]);
    expect(
      (await get(ids.ta, `/api/v1/posts/${postId}`)).body.data,
    ).toMatchObject({ following: true, unread: false });

    const unfollowed = await unsafe(
      request(app(ids.ta)).delete(`/api/v1/posts/${postId}/follow`),
    );
    expect(unfollowed.status).toBe(200);
    expect(unfollowed.body).toEqual({ data: { following: false } });
    const edited = await unsafe(
      request(app(ids.ta)).patch(answered.headers.location),
    )
      .set("If-Match", answered.headers.etag)
      .send({ bodyMarkdown: "Better staff answer" });
    expect(edited.status).toBe(200);
    expect(
      (await get(ids.ta, `/api/v1/posts/${postId}`)).body.data.following,
    ).toBe(false);
    expect((await inbox(ids.asker)).map((item) => item.kind)).toEqual([
      "answer_edited",
      "answer_created",
    ]);
    await unsafe(
      request(app(ids.classmate)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Same question" });
    expect(await inbox(ids.ta)).toEqual([]);
    await clearAll();
  });

  it("notifies followers of endorsements, followups, and replies but never the actor", async () => {
    const postId = await question(ids.asker);
    const answered = await unsafe(
      request(app(ids.classmate)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Student answer" });
    expect(answered.status).toBe(201);
    const endorsed = await unsafe(
      request(app(ids.instructor)).put(
        `${answered.headers.location}/endorsement`,
      ),
    ).set("If-Match", answered.headers.etag);
    expect(endorsed.status).toBe(200);
    expect(
      (await inbox(ids.classmate)).map((item) => [item.kind, item.actor]),
    ).toEqual([["answer_endorsed", { displayName: "Instructor" }]]);
    expect((await inbox(ids.asker)).map((item) => item.kind)).toEqual([
      "answer_endorsed",
      "answer_created",
    ]);
    expect(
      (await get(ids.instructor, `/api/v1/posts/${postId}`)).body.data
        .following,
    ).toBe(false);

    const followup = await unsafe(
      request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "One more thing" });
    expect(followup.status).toBe(201);
    expect((await inbox(ids.classmate))[0]!.kind).toBe("followup_created");
    const asked = (await inbox(ids.asker)).length;
    const reply = await unsafe(
      request(app(ids.asker)).post(`${followup.headers.location}/replies`),
    ).send({ bodyMarkdown: "Never mind" });
    expect(reply.status).toBe(201);
    expect(await inbox(ids.asker)).toHaveLength(asked);
    expect((await inbox(ids.classmate))[0]!.kind).toBe("reply_created");
    await clearAll();
  });

  it("shows anonymous actors by name only to staff and hides deleted accounts", async () => {
    const postId = await question(ids.asker);
    await unsafe(
      request(app(ids.ta)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(200, { data: { following: true } });
    await unsafe(
      request(app(ids.classmate)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Secret", anonymous: true });
    expect((await inbox(ids.asker))[0]!.actor).toEqual({
      displayName: "Anonymous",
    });
    expect((await inbox(ids.ta))[0]!.actor).toEqual({
      displayName: "Classmate",
    });
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.classmate,
    ]);
    try {
      expect((await inbox(ids.ta))[0]!.actor).toBeNull();
      expect((await inbox(ids.asker))[0]!.actor).toEqual({
        displayName: "Anonymous",
      });
    } finally {
      await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
        ids.classmate,
      ]);
    }
    await clearAll();
  });

  it("excludes deleted accounts and former members from fan-out and from the inbox", async () => {
    const postId = await question(ids.asker);
    await unsafe(
      request(app(ids.gone)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(200);
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.gone,
    ]);
    await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Answer" });
    const rows = await pool.query(
      "SELECT user_id FROM notifications WHERE post_id=$1",
      [postId],
    );
    expect(rows.rows.map((row) => row.user_id)).toEqual([ids.asker]);
    await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
      ids.gone,
    ]);

    // A notification stays hidden once its reader leaves the course.
    await pool.query(
      "INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'answer_created',$4)",
      [ids.gone, ids.course, postId, ids.ta],
    );
    expect(await inbox(ids.gone)).toHaveLength(1);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.gone],
    );
    expect(await inbox(ids.gone)).toEqual([]);
    expect(
      (await get(ids.gone, "/api/v1/users/me/notifications/unread-count")).body,
    ).toEqual({ data: { count: 0 } });
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [ids.course, ids.gone],
    );

    // Deleted posts and confirmed duplicates drop out too.
    expect(await inbox(ids.asker)).toHaveLength(1);
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [postId],
    );
    expect(await inbox(ids.asker)).toEqual([]);
    await clearAll();
  });

  it("announces to every other member and queues email only for opted-in recipients", async () => {
    await pool.query(
      "UPDATE users SET notification_emails=true WHERE id = ANY($1::uuid[])",
      [[ids.classmate, ids.ta]],
    );
    const created = await unsafe(
      request(app(ids.instructor)).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "note",
      title: "Exam moved",
      bodyMarkdown: "To Friday.",
      announcement: true,
    });
    expect(created.status).toBe(201);
    const rows = await pool.query(
      "SELECT user_id FROM notifications WHERE post_id=$1 AND kind='announcement' ORDER BY user_id",
      [created.body.data.id],
    );
    expect(rows.rows.map((row) => row.user_id)).toEqual(
      [ids.asker, ids.classmate, ids.ta, ids.gone].sort(),
    );
    const jobs = () =>
      pool.query(
        `SELECT j.payload,j.deduplication_key,n.user_id FROM jobs j
         JOIN notifications n ON n.id::text=j.deduplication_key
         WHERE j.kind='send_notification_email'`,
      );
    // Announcements already email everyone, so no second email is queued.
    expect((await jobs()).rows).toEqual([]);

    const postId = await question(ids.asker);
    await unsafe(
      request(app(ids.classmate)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(200);
    await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Answer" });
    const queued = await jobs();
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0].user_id).toBe(ids.classmate);
    const job = queued.rows[0];
    expect(job.payload).toEqual({ notificationId: job.deduplication_key });
    await pool.query("UPDATE users SET notification_emails=false");
    await clearAll();
  });

  it("lists, pages, filters, counts, and marks notifications read", async () => {
    const first = await question(ids.asker, { title: "First" });
    const second = await question(ids.asker, { title: "Second" });
    for (const postId of [first, second, first])
      await unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Ping" });
    const count = () =>
      get(ids.asker, "/api/v1/users/me/notifications/unread-count").then(
        (response) => response.body.data.count,
      );
    expect(await count()).toBe(3);

    const page = await get(ids.asker, "/api/v1/users/me/notifications?limit=2");
    expect(page.status).toBe(200);
    expect(
      page.body.data.map((item: { postTitle: string }) => item.postTitle),
    ).toEqual(["First", "Second"]);
    expect(page.body.page.hasMore).toBe(true);
    const next = await get(
      ids.asker,
      `/api/v1/users/me/notifications?limit=2&cursor=${page.body.page.nextCursor}`,
    );
    expect(next.body.data).toHaveLength(1);
    expect(next.body.page).toEqual({ nextCursor: null, hasMore: false });
    expect(
      (
        await get(
          ids.asker,
          `/api/v1/users/me/notifications?unread=true&cursor=${page.body.page.nextCursor}`,
        )
      ).status,
    ).toBe(400);
    for (const query of ["?unread=false", "?kind=answer", "?limit=0"])
      expect(
        (await get(ids.asker, `/api/v1/users/me/notifications${query}`)).status,
      ).toBe(400);

    const marked = await unsafe(
      request(app(ids.asker)).post("/api/v1/users/me/notifications/read"),
    ).send({ ids: [page.body.data[0].id] });
    expect(marked.status).toBe(204);
    expect(await count()).toBe(2);
    expect(await inbox(ids.asker, "?unread=true")).toHaveLength(2);
    // Another member cannot mark someone else's notification.
    await unsafe(
      request(app(ids.classmate)).post("/api/v1/users/me/notifications/read"),
    )
      .send({ ids: [page.body.data[1].id] })
      .expect(204);
    expect(await count()).toBe(2);
    for (const body of [{ ids: [] }, { ids: ["nope"] }])
      expect(
        (
          await unsafe(
            request(app(ids.asker)).post("/api/v1/users/me/notifications/read"),
          ).send(body)
        ).status,
      ).toBe(422);

    // Opening a post reads its notifications.
    await get(ids.asker, `/api/v1/posts/${second}`).expect(200);
    expect(await count()).toBe(1);
    await unsafe(
      request(app(ids.asker)).post("/api/v1/users/me/notifications/read"),
    ).expect(204);
    expect(await count()).toBe(0);
    expect((await inbox(ids.asker)).every((item) => item.readAt)).toBe(true);
    await clearAll();
  });

  it("tracks unread posts and course read marks", async () => {
    const postId = await question(ids.asker);
    // The classmate opened the question before the answer arrived.
    await get(ids.classmate, `/api/v1/posts/${postId}`).expect(200);
    await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Answer" });
    const listed = async (userId: string) =>
      (
        await get(userId, `/api/v1/courses/${ids.course}/posts?limit=100`)
      ).body.data.find((post: { id: string }) => post.id === postId);
    expect((await listed(ids.classmate)).unread).toBe(true);
    await get(ids.classmate, `/api/v1/posts/${postId}`).expect(200);
    expect((await listed(ids.classmate)).unread).toBe(false);
    expect((await listed(ids.ta)).unread).toBe(false);
    expect((await listed(ids.instructor)).unread).toBe(true);
    const marked = await unsafe(
      request(app(ids.instructor)).post(
        `/api/v1/courses/${ids.course}/read-marks`,
      ),
    );
    expect(marked.status).toBe(204);
    expect((await listed(ids.instructor)).unread).toBe(false);
    expect(
      (
        await unsafe(
          request(app(ids.outsider)).post(
            `/api/v1/courses/${ids.course}/read-marks`,
          ),
        )
      ).status,
    ).toBe(404);
    await clearAll();
  });

  it("requires authentication, CSRF, and a readable post", async () => {
    const postId = await question(ids.asker);
    for (const path of [
      "/api/v1/users/me/notifications",
      "/api/v1/users/me/notifications/unread-count",
    ])
      expect((await request(app(ids.asker)).get(path)).status).toBe(401);
    expect(
      (
        await request(app(ids.asker))
          .put(`/api/v1/posts/${postId}/follow`)
          .set("Cookie", cookie)
          .set("Origin", environment.frontendBaseUrl)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app(ids.asker))
          .post("/api/v1/users/me/notifications/read")
          .set("Cookie", cookie)
          .set("Origin", environment.frontendBaseUrl)
      ).status,
    ).toBe(403);
    expect(
      (
        await unsafe(
          request(app(ids.outsider)).put(`/api/v1/posts/${postId}/follow`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await unsafe(
          request(app(ids.asker)).put(
            "/api/v1/posts/01a0e5cc-0000-7000-8000-000000000000/follow",
          ),
        )
      ).status,
    ).toBe(404);
    await pool.query(
      "UPDATE posts SET deleted_at=now(),author_user_id=NULL,title=NULL,body_markdown=NULL WHERE id=$1",
      [postId],
    );
    expect(
      (
        await unsafe(
          request(app(ids.asker)).put(`/api/v1/posts/${postId}/follow`),
        )
      ).status,
    ).toBe(404);
  });
});
