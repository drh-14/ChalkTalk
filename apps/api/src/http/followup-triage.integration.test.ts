import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { PostService } from "../posts/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `followup_triage_${process.pid}_${Date.now()}`;
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
  });
}
const unsafe = (test: request.Test) =>
  test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
async function question(extra: object = {}) {
  const created = await unsafe(
    request(app(ids.asker)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({
    type: "question",
    title: "Recursion depth",
    bodyMarkdown: "Why does it overflow?",
    ...extra,
  });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}
async function followup(userId: string, postId: string, parent?: string) {
  const created = await unsafe(
    request(app(userId)).post(
      parent
        ? `/api/v1/followups/${parent}/replies`
        : `/api/v1/posts/${postId}/followups`,
    ),
  ).send({ bodyMarkdown: parent ? "A reply" : "A followup" });
  expect(created.status).toBe(201);
  return created.body.data as {
    id: string;
    resolved: boolean;
    canResolve: boolean;
    version: number;
  };
}
const resolve = (userId: string, id: string, resolved = true) =>
  unsafe(
    request(app(userId))[resolved ? "put" : "delete"](
      `/api/v1/followups/${id}/resolution`,
    ),
  );
const post = async (userId: string, postId: string) =>
  (await get(userId, `/api/v1/posts/${postId}`)).body.data;
const queue = async (userId: string) =>
  (
    await get(
      userId,
      `/api/v1/courses/${ids.course}/posts?unresolvedFollowups=true&limit=100`,
    )
  ).body.data.map((item: { id: string }) => item.id) as string[];

integration("followup triage HTTP contract", () => {
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

  it("freezes existing resolution and rejects new anonymous followups while disabled", async () => {
    const postId = await question();
    const root = await followup(ids.classmate, postId);
    expect((await resolve(ids.asker, root.id)).status).toBe(200);
    const priorAnonymous = await unsafe(
      request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
    )
      .set("Idempotency-Key", "followup-before-policy")
      .send({ bodyMarkdown: "Prior anonymous", anonymous: true });
    expect(priorAnonymous.status).toBe(201);
    await pool.query(
      "UPDATE courses SET allow_anonymous_posting=false,allow_followup_resolution=false WHERE id=$1",
      [ids.course],
    );
    try {
      const viewed = await get(ids.asker, `/api/v1/followups/${root.id}`);
      expect(viewed.body.data).toMatchObject({
        resolved: true,
        canResolve: false,
      });
      const blocked = await unsafe(
        request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Anonymous followup", anonymous: true });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("anonymous_posting_disabled");
      const blockedReply = await unsafe(
        request(app(ids.asker)).post(`/api/v1/followups/${root.id}/replies`),
      ).send({ bodyMarkdown: "Anonymous reply", anonymous: true });
      expect(blockedReply.status).toBe(409);
      expect(blockedReply.body.error.code).toBe("anonymous_posting_disabled");
      const replay = await unsafe(
        request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
      )
        .set("Idempotency-Key", "followup-before-policy")
        .send({ bodyMarkdown: "Prior anonymous", anonymous: true });
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(priorAnonymous.body.data.id);
      expect(replay.body.data.canResolve).toBe(false);
      const reopen = await resolve(ids.asker, root.id, false);
      expect(reopen.status).toBe(409);
      expect(reopen.body.error.code).toBe("followup_resolution_disabled");
      const reply = await followup(ids.asker, postId, root.id);
      expect(reply.resolved).toBe(false);
      const unchanged = await get(ids.asker, `/api/v1/followups/${root.id}`);
      expect(unchanged.body.data.resolved).toBe(true);
    } finally {
      await pool.query(
        "UPDATE courses SET allow_anonymous_posting=true,allow_followup_resolution=true WHERE id=$1",
        [ids.course],
      );
    }
    const afterReenable = await get(ids.asker, `/api/v1/followups/${root.id}`);
    expect(afterReenable.body.data.canResolve).toBe(true);
    await followup(ids.asker, postId, root.id);
    const reopened = await get(ids.asker, `/api/v1/followups/${root.id}`);
    expect(reopened.body.data.resolved).toBe(false);
  });

  it("allows resolution only on root followups, with both columns together", async () => {
    const postId = await question();
    const root = await followup(ids.classmate, postId);
    const reply = await followup(ids.ta, postId, root.id);
    await expect(
      pool.query(
        "UPDATE followups SET resolved_at=now(),resolved_by_user_id=$2 WHERE id=$1",
        [reply.id, ids.ta],
      ),
    ).rejects.toThrow(/followups_resolution_root_check/);
    await expect(
      pool.query("UPDATE followups SET resolved_at=now() WHERE id=$1", [
        root.id,
      ]),
    ).rejects.toThrow(/followups_resolution_pair_check/);
  });

  it("starts discussions unresolved and lets staff and the asker resolve them", async () => {
    const postId = await question();
    const root = await followup(ids.classmate, postId);
    expect(root.resolved).toBe(false);
    // The classmate wrote the followup but did not ask the question.
    expect(root.canResolve).toBe(false);
    const before = await post(ids.ta, postId);
    expect(before.unresolvedFollowups).toBe(1);

    for (const userId of [ids.ta, ids.instructor, ids.asker]) {
      const resolved = await resolve(userId, root.id);
      expect(resolved.status).toBe(200);
      expect(resolved.body.data).toMatchObject({
        id: root.id,
        resolved: true,
        canResolve: true,
        version: root.version,
      });
      expect(resolved.headers.etag).toBe(`"v${root.version}"`);
      // Idempotent: resolving again keeps it resolved.
      expect((await resolve(userId, root.id)).body.data.resolved).toBe(true);
      const reopened = await resolve(userId, root.id, false);
      expect(reopened.status).toBe(200);
      expect(reopened.body.data.resolved).toBe(false);
      expect((await resolve(userId, root.id, false)).status).toBe(200);
    }
    await resolve(ids.ta, root.id).expect(200);
    const after = await post(ids.ta, postId);
    expect(after.unresolvedFollowups).toBe(0);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(after.version).toBe(before.version);
    const stored = await pool.query(
      "SELECT resolved_by_user_id FROM followups WHERE id=$1",
      [root.id],
    );
    expect(stored.rows[0].resolved_by_user_id).toBe(ids.ta);
  });

  it("refuses classmates, replies, deleted followups, and missing CSRF", async () => {
    const postId = await question();
    const root = await followup(ids.asker, postId);
    const reply = await followup(ids.ta, postId, root.id);
    const denied = await resolve(ids.classmate, root.id);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("permission_denied");
    const nested = await resolve(ids.ta, reply.id);
    expect(nested.status).toBe(422);
    expect(nested.body.error.code).toBe("not_a_discussion");
    expect(
      (
        await request(app(ids.ta))
          .put(`/api/v1/followups/${root.id}/resolution`)
          .set("Cookie", cookie)
          .set("Origin", environment.frontendBaseUrl)
      ).status,
    ).toBe(403);
    const lone = await followup(ids.asker, postId);
    await unsafe(request(app(ids.asker)).delete(`/api/v1/followups/${lone.id}`))
      .set("If-Match", `"v${lone.version}"`)
      .expect(204);
    expect((await resolve(ids.ta, lone.id)).status).toBe(404);
    expect(
      (await resolve(ids.ta, "01a0e5cc-0000-7000-8000-000000000000")).status,
    ).toBe(404);
  });

  it("hides discussions on a private post and refuses changes in an archived course", async () => {
    const postId = await question({ private: true });
    const root = await followup(ids.asker, postId);
    expect((await resolve(ids.classmate, root.id)).status).toBe(404);
    expect(await queue(ids.classmate)).not.toContain(postId);
    expect(await queue(ids.ta)).toContain(postId);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      const archived = await resolve(ids.ta, root.id);
      expect(archived.status).toBe(409);
      expect(archived.body.error.code).toBe("course_archived");
      const read = await get(ids.ta, `/api/v1/followups/${root.id}`);
      expect(read.body.data.canResolve).toBe(false);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });

  it("reopens a resolved discussion on a reply at any depth", async () => {
    const postId = await question();
    const root = await followup(ids.asker, postId);
    const reply = await followup(ids.ta, postId, root.id);
    await resolve(ids.ta, root.id).expect(200);
    await followup(ids.classmate, postId, reply.id);
    expect(
      (await get(ids.ta, `/api/v1/followups/${root.id}`)).body.data.resolved,
    ).toBe(false);
    await resolve(ids.ta, root.id).expect(200);
    await followup(ids.ta, postId, root.id);
    expect(
      (await get(ids.ta, `/api/v1/followups/${root.id}`)).body.data.resolved,
    ).toBe(false);
    // A reply in another discussion leaves this one alone.
    await resolve(ids.ta, root.id).expect(200);
    const other = await followup(ids.classmate, postId);
    await followup(ids.asker, postId, other.id);
    expect(
      (await get(ids.ta, `/api/v1/followups/${root.id}`)).body.data.resolved,
    ).toBe(true);
  });

  it("counts and filters questions with unresolved discussions", async () => {
    const postId = await question({ title: "Queue me" });
    const first = await followup(ids.asker, postId);
    const second = await followup(ids.classmate, postId);
    expect((await post(ids.classmate, postId)).unresolvedFollowups).toBe(2);
    expect(await queue(ids.ta)).toContain(postId);
    await resolve(ids.ta, first.id).expect(200);
    expect((await post(ids.ta, postId)).unresolvedFollowups).toBe(1);
    await unsafe(
      request(app(ids.classmate)).delete(`/api/v1/followups/${second.id}`),
    )
      .set("If-Match", `"v${second.version}"`)
      .expect(204);
    expect((await post(ids.ta, postId)).unresolvedFollowups).toBe(0);
    expect(await queue(ids.ta)).not.toContain(postId);

    const note = await unsafe(
      request(app(ids.ta)).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Note", bodyMarkdown: "Body" });
    expect(note.body.data).not.toHaveProperty("unresolvedFollowups");
    for (const value of ["false", "1"])
      expect(
        (
          await get(
            ids.ta,
            `/api/v1/courses/${ids.course}/posts?unresolvedFollowups=${value}`,
          )
        ).status,
      ).toBe(400);
  });
});
