import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { NotificationService } from "../notifications/service.js";
import { PostService } from "../posts/service.js";
import { CollaborationSessionService } from "../collaboration/service.js";
import { ContentAttachmentService } from "../content-attachments/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `private_posts_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  asker: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  classmate: "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c",
  ta: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
};
const names: Record<string, string> = {
  [ids.asker]: "Asker",
  [ids.classmate]: "Classmate",
  [ids.ta]: "Teaching Assistant",
  [ids.instructor]: "Instructor",
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
async function create(userId: string, extra: object = {}) {
  return unsafe(
    request(app(userId)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({
    type: "question",
    title: "My grade on lab 3",
    bodyMarkdown: "Was problem 2 graded correctly?",
    private: true,
    ...extra,
  });
}
async function privateQuestion(extra: object = {}) {
  const created = await create(ids.asker, extra);
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}
const feed = async (userId: string, query = "") =>
  (
    await get(userId, `/api/v1/courses/${ids.course}/posts?limit=100${query}`)
  ).body.data.map((post: { id: string }) => post.id) as string[];

integration("private posts HTTP contract", () => {
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
      `INSERT INTO course_memberships (course_id,user_id,role) VALUES
       ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($1,$5,'instructor')`,
      [ids.course, ids.asker, ids.classmate, ids.ta, ids.instructor],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("enforces the schema default and check", async () => {
    const postId = await privateQuestion();
    const row = await pool.query("SELECT private FROM posts WHERE id=$1", [
      postId,
    ]);
    expect(row.rows[0].private).toBe(true);
    await expect(
      pool.query("UPDATE posts SET type='poll' WHERE id=$1", [postId]),
    ).rejects.toThrow(/posts_private_check/);
    const open = await create(ids.asker, { private: undefined });
    expect(open.body.data.private).toBe(false);
  });

  it("shows a private post to its author and staff only", async () => {
    const postId = await privateQuestion();
    for (const userId of [ids.asker, ids.ta, ids.instructor]) {
      const read = await get(userId, `/api/v1/posts/${postId}`);
      expect(read.status).toBe(200);
      expect(read.body.data.private).toBe(true);
    }
    const hidden = await get(ids.classmate, `/api/v1/posts/${postId}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("not_found");
  });

  it("rejects private announcements, private polls, and non-boolean values", async () => {
    const announcement = await create(ids.instructor, {
      type: "note",
      announcement: true,
    });
    expect(announcement.status).toBe(422);
    expect(announcement.body.error.code).toBe("private_announcement");
    const poll = await create(ids.instructor, {
      type: "poll",
      options: [{ label: "Yes" }, { label: "No" }],
    });
    expect(poll.status).toBe(422);
    expect(poll.body.error.code).toBe("private_poll");
    const invalid = await create(ids.asker, { private: "yes" });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("validation_failed");
  });

  it("lists, searches, and filters private posts only for those who can read them", async () => {
    const postId = await privateQuestion({ title: "Zebra regrade request" });
    expect(await feed(ids.classmate)).not.toContain(postId);
    expect(await feed(ids.asker)).toContain(postId);
    expect(await feed(ids.ta)).toContain(postId);
    expect(await feed(ids.classmate, "&q=zebra")).not.toContain(postId);
    expect(await feed(ids.instructor, "&q=zebra")).toContain(postId);
    // Fuzzy matching runs through a separate candidate query.
    expect(await feed(ids.classmate, "&q=zebr")).not.toContain(postId);

    const mine = await feed(ids.asker, "&private=true");
    expect(mine).toContain(postId);
    const openId = (await create(ids.classmate, { private: false })).body.data
      .id;
    expect(await feed(ids.ta, "&private=true")).not.toContain(openId);
    expect(await feed(ids.classmate, "&private=true")).toEqual([]);
    for (const value of ["false", "1"])
      expect(
        (
          await get(
            ids.asker,
            `/api/v1/courses/${ids.course}/posts?private=${value}`,
          )
        ).status,
      ).toBe(400);
  });

  it("hides answers, followups, replies, upvotes, follows, and edits from classmates", async () => {
    const postId = await privateQuestion();
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "We will regrade it." });
    expect(answered.status).toBe(201);
    const followup = await unsafe(
      request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Thanks!" });
    expect(followup.status).toBe(201);
    const reply = await unsafe(
      request(app(ids.instructor)).post(`${followup.headers.location}/replies`),
    ).send({ bodyMarkdown: "You're welcome." });
    expect(reply.status).toBe(201);

    const reads = [
      `/api/v1/posts/${postId}/answers`,
      answered.headers.location,
      `/api/v1/posts/${postId}/followups`,
      followup.headers.location,
      `${followup.headers.location}/replies`,
    ];
    for (const path of reads) {
      expect((await get(ids.classmate, path)).status, path).toBe(404);
      expect((await get(ids.asker, path)).status, path).toBe(200);
    }
    const writes = [
      unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${postId}/answers`),
      ).send({
        bodyMarkdown: "Me too",
      }),
      unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Me too" }),
      unsafe(
        request(app(ids.classmate)).put(`${answered.headers.location}/upvote`),
      ),
      unsafe(
        request(app(ids.classmate)).put(`${followup.headers.location}/upvote`),
      ),
      unsafe(request(app(ids.classmate)).put(`/api/v1/posts/${postId}/follow`)),
      unsafe(request(app(ids.classmate)).patch(`/api/v1/posts/${postId}`))
        .set("If-Match", '"v1"')
        .send({ title: "Mine now" }),
      unsafe(request(app(ids.classmate)).delete(`/api/v1/posts/${postId}`)).set(
        "If-Match",
        '"v1"',
      ),
    ];
    for (const write of writes) expect((await write).status).toBe(404);
  });

  it("hides attachments on a private post and its answers", async () => {
    const postId = await privateQuestion();
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "See attached." });
    const s3 = { send: async () => ({ Body: "file" }) } as unknown as S3Client;
    const attachments = new ContentAttachmentService(pool, s3, "bucket");
    for (const [column, parent] of [
      ["post_id", postId],
      ["answer_id", answered.body.data.id],
    ]) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO content_attachments (id,course_id,${column},object_key,file_name,media_type,size_bytes,checksum_sha256)
         VALUES (gen_random_uuid(),$1,$2,gen_random_uuid()::text,'notes.txt','text/plain',4,decode(repeat('00',32),'hex')) RETURNING id`,
        [ids.course, parent],
      );
      const id = inserted.rows[0]!.id;
      const kind = column === "post_id" ? "post" : "answer";
      await expect(
        attachments.authorizeUpload(kind, parent, ids.classmate),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        attachments.authorizeUpload(kind, parent, ids.instructor),
      ).resolves.toBeUndefined();
      await expect(
        attachments.download(id, ids.classmate),
      ).rejects.toMatchObject({ status: 404 });
      await expect(attachments.download(id, ids.asker)).resolves.toMatchObject({
        name: "notes.txt",
      });
      await expect(attachments.download(id, ids.ta)).resolves.toMatchObject({
        name: "notes.txt",
      });
    }
  });

  it("limits live sessions on a private post to people who can read it", async () => {
    const postId = await privateQuestion();
    const sessions = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
    });
    await expect(
      sessions.create(ids.course, ids.classmate, {
        postId,
        language: "python",
      }),
    ).rejects.toMatchObject({ status: 422, code: "cross_course_anchor" });
    const session = await sessions.create(ids.course, ids.asker, {
      postId,
      language: "python",
    });
    const sessionId = session.value.id;
    await expect(
      sessions.invite(sessionId, ids.asker, ids.classmate),
    ).rejects.toMatchObject({ status: 422, code: "invitee_cannot_read_post" });
    await expect(
      sessions.invite(sessionId, ids.asker, ids.ta),
    ).resolves.toBeDefined();
    // A classmate added behind the service's back still cannot reach it.
    await pool.query(
      "INSERT INTO collaboration_participants (collaboration_session_id,course_id,user_id,invited_by_user_id,permission) VALUES ($1,$2,$3,$4,'edit')",
      [sessionId, ids.course, ids.classmate, ids.asker],
    );
    await expect(sessions.get(sessionId, ids.classmate)).rejects.toMatchObject({
      status: 404,
    });
    const listed = await sessions.list(ids.course, ids.classmate, {
      limit: 25,
    });
    expect(listed.data.map((item) => item.id)).not.toContain(sessionId);
    const mine = await sessions.listForUser(ids.classmate, { limit: 25 });
    expect(mine.data.map((item) => item.id)).not.toContain(sessionId);
  });

  it("notifies only members who can still read the post", async () => {
    const postId = await privateQuestion();
    await unsafe(
      request(app(ids.ta)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(200);
    // A TA demoted to student loses access along with their notifications.
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.ta],
    );
    try {
      await unsafe(
        request(app(ids.instructor)).post(`/api/v1/posts/${postId}/answers`),
      ).send({ bodyMarkdown: "Answer" });
      const recipients = await pool.query(
        "SELECT user_id FROM notifications WHERE post_id=$1",
        [postId],
      );
      expect(recipients.rows.map((row) => row.user_id)).toEqual([ids.asker]);
      await pool.query(
        "INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'answer_created',$4)",
        [ids.ta, ids.course, postId, ids.instructor],
      );
      const inbox = await get(ids.ta, "/api/v1/users/me/notifications");
      expect(
        inbox.body.data.map((item: { postId: string }) => item.postId),
      ).not.toContain(postId);
      expect(
        (await get(ids.ta, "/api/v1/users/me/notifications/unread-count")).body
          .data.count,
      ).toBe(0);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.ta],
      );
      await pool.query("DELETE FROM notifications");
    }
  });

  it("lets staff make a private post public, keeping anonymity and notifying the author", async () => {
    const postId = await privateQuestion({ anonymous: true });
    const before = await get(ids.ta, `/api/v1/posts/${postId}`);
    const published = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", before.headers.etag)
      .send({ private: false });
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({
      private: false,
      anonymous: true,
      version: before.body.data.version + 1,
    });
    expect(Date.parse(published.body.data.lastActivityAt)).toBeGreaterThan(
      Date.parse(before.body.data.lastActivityAt),
    );
    const seen = await get(ids.classmate, `/api/v1/posts/${postId}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.author.displayName).toBe("Anonymous");
    expect(await feed(ids.classmate)).toContain(postId);
    const inbox = await get(ids.asker, "/api/v1/users/me/notifications");
    expect(inbox.body.data[0]).toMatchObject({
      kind: "post_published",
      postId,
      actor: { displayName: "Teaching Assistant" },
    });

    // It cannot go back, and repeating private:false is harmless.
    const back = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", published.headers.etag)
      .send({ private: true });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe("post_already_public");
    await pool.query("DELETE FROM notifications");
  });

  it("lets the author publish without notifying themselves, and ignores private:true on a private post", async () => {
    const postId = await privateQuestion();
    const kept = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", '"v1"')
      .send({ private: true });
    expect(kept.status).toBe(200);
    expect(kept.body.data.private).toBe(true);
    const published = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", kept.headers.etag)
      .send({ private: false });
    expect(published.body.data.private).toBe(false);
    const notified = await pool.query(
      "SELECT 1 FROM notifications WHERE post_id=$1",
      [postId],
    );
    expect(notified.rowCount).toBe(0);
  });

  it("never merges a post into a private post", async () => {
    const privateId = await privateQuestion();
    const publicId = (await create(ids.classmate, { private: false })).body.data
      .id;
    const merge = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${publicId}`),
    )
      .set("If-Match", '"v1"')
      .send({ duplicateOfPostId: privateId, duplicateStatus: "confirmed" });
    expect(merge.status).toBe(422);
    expect(merge.body.error.code).toBe("duplicate_target_private");
    const reverse = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${privateId}`),
    )
      .set("If-Match", '"v1"')
      .send({ duplicateOfPostId: publicId, duplicateStatus: "suggested" });
    expect(reverse.status).toBe(200);
  });
});
