import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService, EmailSender } from "../auth/service.js";
import { NotificationService } from "../notifications/service.js";
import { PostService } from "../posts/service.js";
import { JobWorker } from "../jobs/worker.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `scheduled_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  student: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  ta: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
};
const names: Record<string, string> = {
  [ids.student]: "Student",
  [ids.ta]: "Teaching Assistant",
  [ids.instructor]: "Instructor",
};
let admin: Pool;
let pool: Pool;
let worker: JobWorker;
const delivered: { to: string; subject: string }[] = [];
const sender: EmailSender = {
  send: async (message) => {
    delivered.push(message);
  },
};
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
    notificationService: new NotificationService(pool),
  });
}
const unsafe = (test: request.Test) =>
  test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
const later = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();
const schedule = (scheduledFor: unknown, extra: object = {}) =>
  unsafe(
    request(app(ids.instructor)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({
    type: "note",
    title: "Exam room moved",
    bodyMarkdown: "Room 204.",
    announcement: true,
    scheduledFor,
    ...extra,
  });
const feed = async (userId: string) =>
  (
    await get(userId, `/api/v1/courses/${ids.course}/posts?limit=100`)
  ).body.data.map((post: { id: string }) => post.id) as string[];
const counts = async (postId: string) =>
  (
    await pool.query<{ notifications: number; emails: number }>(
      `SELECT (SELECT count(*)::int FROM notifications WHERE post_id=$1) AS notifications,
              (SELECT count(*)::int FROM jobs WHERE kind='send_announcement_email' AND payload->>'postId'=$1::text) AS emails`,
      [postId],
    )
  ).rows[0]!;
/** Makes the publish jobs due now and runs the worker until the queue is empty. */
async function runDueJobs() {
  await pool.query(
    "UPDATE jobs SET available_at=now() WHERE kind='publish_scheduled_announcement' AND status='queued'",
  );
  while (await worker.runOnce());
}

integration("scheduled announcements HTTP contract", () => {
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
      if (!["organization", "course"].includes(key))
        await pool.query(
          "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
          [id, ids.organization, `${key}@example.edu`, names[id]],
        );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.organization, ids.instructor],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'ta'),($1,$4,'instructor')",
      [ids.course, ids.student, ids.ta, ids.instructor],
    );
    worker = new JobWorker(
      pool,
      "scheduled-test",
      sender,
      "https://app.example.edu",
    );
  });
  beforeEach(async () => {
    while (await worker.runOnce());
    delivered.length = 0;
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("allows a schedule only on announcements", async () => {
    await expect(
      pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,scheduled_for) VALUES (gen_random_uuid(),$1,$2,'note','t','b',now()+interval '1 day')",
        [ids.course, ids.instructor],
      ),
    ).rejects.toThrow(/posts_scheduled_announcement_check/);
  });

  it("validates the time and requires an announcement", async () => {
    for (const value of [later(0.5), later(366 * 24 * 60), "tomorrow"]) {
      const response = await schedule(value);
      expect(response.status, value).toBe(422);
      expect(response.body.error.code).toBe("schedule_invalid");
    }
    const notAnnouncement = await schedule(later(60), { announcement: false });
    expect(notAnnouncement.body.error.code).toBe("schedule_invalid");
    expect((await schedule(42)).body.error.code).toBe("validation_failed");
  });

  it("keeps a scheduled announcement from students and quiet until it publishes", async () => {
    const when = later(60);
    const created = await schedule(when);
    expect(created.status).toBe(201);
    const postId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      scheduledFor: when,
      pinned: true,
      announcement: true,
    });
    expect((await get(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );
    expect(await feed(ids.student)).not.toContain(postId);
    expect(await feed(ids.ta)).toContain(postId);
    expect(
      (await get(ids.ta, `/api/v1/posts/${postId}`)).body.data.scheduledFor,
    ).toBe(when);
    expect(await counts(postId)).toEqual({ notifications: 0, emails: 0 });

    // Not due yet: the worker leaves it alone.
    while (await worker.runOnce());
    expect((await get(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );

    await runDueJobs();
    const published = await get(ids.student, `/api/v1/posts/${postId}`);
    expect(published.status).toBe(200);
    expect(published.body.data.scheduledFor).toBeNull();
    expect(Date.parse(published.body.data.createdAt)).toBeGreaterThan(
      Date.parse(created.body.data.createdAt),
    );
    expect((await feed(ids.student))[0]).toBe(postId);
    expect(await counts(postId)).toEqual({ notifications: 2, emails: 2 });
    expect(delivered.map((message) => message.to).sort()).toEqual([
      "student@example.edu",
      "ta@example.edu",
    ]);
    const inbox = await get(ids.student, "/api/v1/users/me/notifications");
    expect(inbox.body.data[0]).toMatchObject({ kind: "announcement", postId });
  });

  it("reschedules, publishes now, and never publishes twice", async () => {
    const created = await schedule(later(60));
    const postId = created.body.data.id;
    const newTime = later(120);
    const moved = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", created.headers.etag)
      .send({ scheduledFor: newTime });
    expect(moved.status).toBe(200);
    expect(moved.body.data.scheduledFor).toBe(newTime);
    const now = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", moved.headers.etag)
      .send({ scheduledFor: null });
    expect(now.status).toBe(200);
    expect(now.body.data.scheduledFor).toBeNull();
    expect((await get(ids.student, `/api/v1/posts/${postId}`)).status).toBe(
      200,
    );
    // Both earlier jobs are now stale.
    await runDueJobs();
    expect(await counts(postId)).toEqual({ notifications: 2, emails: 2 });
    const again = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", now.headers.etag)
      .send({ scheduledFor: later(60) });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("not_scheduled");
  });

  it("does not publish a deleted announcement or one in an inactive course", async () => {
    const deleted = await schedule(later(60));
    await unsafe(
      request(app(ids.instructor)).delete(
        `/api/v1/posts/${deleted.body.data.id}`,
      ),
    )
      .set("If-Match", deleted.headers.etag)
      .expect(204);
    const waiting = await schedule(later(60));
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      await runDueJobs();
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    expect(await counts(deleted.body.data.id)).toEqual({
      notifications: 0,
      emails: 0,
    });
    expect(await counts(waiting.body.data.id)).toEqual({
      notifications: 0,
      emails: 0,
    });
    expect(
      (await get(ids.ta, `/api/v1/posts/${waiting.body.data.id}`)).body.data
        .scheduledFor,
    ).not.toBeNull();
  });
});
