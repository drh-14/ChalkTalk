import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const schema = `mentions_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  otherCourse: "01a0e5cc-58ae-7009-9f43-e69b17afef06",
  asker: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  classmate: "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c",
  grace: "01a0e5cc-58ae-7009-9f43-c0ffee000001",
  ta: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
  outsider: "01a0e5cc-58ae-7009-9f43-e237164911da",
  gone: "01a0e5cc-58ae-7009-9f43-f1e2d3c4b5a6",
};
const names: Record<string, string> = {
  [ids.asker]: "Asker",
  [ids.classmate]: "Classmate",
  [ids.grace]: "Grace Hopper",
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
const unsafe = (test: request.Test) =>
  test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
const mention = (userId: string) => `[@${names[userId]}](mention:${userId})`;
async function question(body = "Why?", extra: object = {}) {
  const created = await unsafe(
    request(app(ids.asker)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({ type: "question", title: "Loops", bodyMarkdown: body, ...extra });
  expect(created.status).toBe(201);
  return created.body.data as { id: string; version: number };
}
const mentionedUsers = async () =>
  (
    await pool.query<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE kind='mentioned' ORDER BY user_id",
    )
  ).rows.map((row) => row.user_id);
const kinds = async (userId: string) =>
  (
    await pool.query<{ kind: string }>(
      "SELECT kind FROM notifications WHERE user_id=$1 ORDER BY created_at",
      [userId],
    )
  ).rows.map((row) => row.kind);

integration("mentions HTTP contract", () => {
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
       ($1,$2,'student'),($1,$3,'student'),($1,$4,'student'),($1,$5,'ta'),($1,$6,'instructor'),($1,$7,'student'),($8,$9,'student')`,
      [
        ids.course,
        ids.asker,
        ids.classmate,
        ids.grace,
        ids.ta,
        ids.instructor,
        ids.gone,
        ids.otherCourse,
        ids.outsider,
      ],
    );
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.gone,
    ]);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM notifications");
    await pool.query("DELETE FROM jobs WHERE kind='send_notification_email'");
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("accepts the mentioned kind in the schema", async () => {
    const { id } = await question();
    await pool.query(
      "INSERT INTO notifications (id,user_id,course_id,post_id,kind) VALUES (gen_random_uuid(),$1,$2,$3,'mentioned')",
      [ids.grace, ids.course, id],
    );
    expect(await kinds(ids.grace)).toEqual(["mentioned"]);
  });

  it("notifies current members a post mentions, but not outsiders, deleted accounts, the author, or code", async () => {
    await question(
      [
        `Hey ${mention(ids.grace)} and ${mention(ids.ta)}`,
        `${mention(ids.outsider)} ${mention(ids.gone)} ${mention(ids.asker)}`,
        `\`${mention(ids.classmate)}\``,
      ].join("\n"),
    );
    expect(await mentionedUsers()).toEqual([ids.grace, ids.ta].sort());
    const inbox = await get(ids.grace, "/api/v1/users/me/notifications");
    expect(inbox.body.data[0]).toMatchObject({
      kind: "mentioned",
      actor: { displayName: "Asker" },
      postTitle: "Loops",
    });
  });

  it("notifies all staff for @staff and queues email for those who opted in", async () => {
    await pool.query(
      "UPDATE course_memberships SET activity_emails=true WHERE user_id=$1",
      [ids.ta],
    );
    try {
      const { id } = await question();
      const followup = await unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${id}/followups`),
      ).send({ bodyMarkdown: "@staff can someone help?" });
      expect(followup.status).toBe(201);
      expect(await mentionedUsers()).toEqual([ids.ta, ids.instructor].sort());
      const jobs = await pool.query(
        `SELECT n.user_id FROM jobs j JOIN notifications n ON n.id::text=j.deduplication_key
         WHERE j.kind='send_notification_email' AND n.kind='mentioned'`,
      );
      expect(jobs.rows.map((row) => row.user_id)).toEqual([ids.ta]);
    } finally {
      await pool.query("UPDATE course_memberships SET activity_emails=false");
    }
  });

  it("sends a follower who is mentioned only the mention", async () => {
    const { id } = await question();
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${id}/answers`),
    ).send({ bodyMarkdown: `Thanks ${mention(ids.asker)}, try this.` });
    expect(answered.status).toBe(201);
    // The asker follows their question and is mentioned.
    expect(await kinds(ids.asker)).toEqual(["mentioned"]);
  });

  it("keeps anonymous mentions anonymous to students and named to staff", async () => {
    const { id } = await question();
    await unsafe(
      request(app(ids.classmate)).post(`/api/v1/posts/${id}/followups`),
    ).send({
      bodyMarkdown: `${mention(ids.grace)} ${mention(ids.ta)}`,
      anonymous: true,
    });
    const student = await get(ids.grace, "/api/v1/users/me/notifications");
    expect(student.body.data[0].actor).toEqual({ displayName: "Anonymous" });
    const staff = await get(ids.ta, "/api/v1/users/me/notifications");
    expect(staff.body.data[0].actor).toEqual({ displayName: "Classmate" });
  });

  it("does not notify a mentioned classmate who cannot read a private post", async () => {
    await question(`${mention(ids.grace)} ${mention(ids.ta)} @staff`, {
      private: true,
    });
    expect(await mentionedUsers()).toEqual([ids.ta, ids.instructor].sort());
  });

  it("notifies only newly mentioned people on edits of posts, answers, and followups", async () => {
    const created = await question(`Hi ${mention(ids.grace)}`);
    expect(await mentionedUsers()).toEqual([ids.grace]);
    await pool.query("DELETE FROM notifications");
    const edited = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${created.id}`),
    )
      .set("If-Match", `"v${created.version}"`)
      .send({ bodyMarkdown: `Hi ${mention(ids.grace)} ${mention(ids.ta)}` });
    expect(edited.status).toBe(200);
    expect(await mentionedUsers()).toEqual([ids.ta]);

    await pool.query("DELETE FROM notifications");
    const answer = await unsafe(
      request(app(ids.instructor)).post(`/api/v1/posts/${created.id}/answers`),
    ).send({ bodyMarkdown: "Answer" });
    await pool.query("DELETE FROM notifications");
    await unsafe(request(app(ids.instructor)).patch(answer.headers.location))
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: `Answer for ${mention(ids.classmate)}` });
    expect(await mentionedUsers()).toEqual([ids.classmate]);

    await pool.query("DELETE FROM notifications");
    const followup = await unsafe(
      request(app(ids.classmate)).post(`/api/v1/posts/${created.id}/followups`),
    ).send({ bodyMarkdown: `${mention(ids.grace)} too` });
    await pool.query("DELETE FROM notifications");
    const changed = await unsafe(
      request(app(ids.classmate)).patch(followup.headers.location),
    )
      .set("If-Match", followup.headers.etag)
      .send({ bodyMarkdown: `${mention(ids.grace)} and @staff` });
    expect(changed.status).toBe(200);
    expect(await mentionedUsers()).toEqual([ids.ta, ids.instructor].sort());
  });

  it("rejects more than 20 individual mentions without writing anything", async () => {
    const many = Array.from(
      { length: 21 },
      (_, n) =>
        `[@Person ${n}](mention:01a0e5cc-58ae-7009-9f43-${String(n).padStart(12, "0")})`,
    ).join(" ");
    const before = await pool.query("SELECT count(*)::int AS n FROM posts");
    const created = await unsafe(
      request(app(ids.asker)).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Too many", bodyMarkdown: many });
    expect(created.status).toBe(422);
    expect(created.body.error.code).toBe("too_many_mentions");
    const after = await pool.query("SELECT count(*)::int AS n FROM posts");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("suggests readable, active members by name", async () => {
    const path = (query: string) =>
      `/api/v1/courses/${ids.course}/mention-suggestions${query}`;
    const names = async (userId: string, query: string) =>
      (await get(userId, path(query))).body.data.map(
        (item: { displayName: string }) => item.displayName,
      );
    const found = await get(ids.asker, path("?q=gra"));
    expect(found.status).toBe(200);
    expect(found.body.data).toEqual([
      { userId: ids.grace, displayName: "Grace Hopper", role: "student" },
    ]);
    // Prefix matches first, then names containing the query.
    expect(await names(ids.asker, "?q=t")).toEqual([
      "Teaching Assistant",
      "Classmate",
      "Instructor",
    ]);
    // Never the caller, deleted accounts, or other courses.
    expect(await names(ids.asker, "?q=")).not.toContain("Asker");
    expect(await names(ids.asker, "?q=")).not.toContain("Gone");
    expect(await names(ids.asker, "?q=")).not.toContain("Outsider");
    // LIKE wildcards are literal.
    expect(await names(ids.asker, "?q=%25")).toEqual([]);

    const secret = await question("Private", { private: true });
    expect(await names(ids.asker, `?q=&postId=${secret.id}`)).toEqual([
      "Instructor",
      "Teaching Assistant",
    ]);
    expect(
      (await get(ids.classmate, path(`?q=&postId=${secret.id}`))).status,
    ).toBe(404);
    expect((await get(ids.outsider, path("?q=a"))).status).toBe(404);
    expect((await get(ids.asker, path(`?q=${"a".repeat(51)}`))).status).toBe(
      400,
    );
    expect((await get(ids.asker, path("?q=a&role=ta"))).status).toBe(400);
    expect((await request(app(ids.asker)).get(path("?q=a"))).status).toBe(401);
  });
});
