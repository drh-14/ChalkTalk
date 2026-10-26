import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { PostService } from "../posts/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `discussion_locks_${process.pid}_${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  staff: uuidv7(),
  student: uuidv7(),
  outsider: uuidv7(),
};
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
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
          email: "user@example.edu",
          displayName: "User",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          version: 1,
        },
        expiresAt: "2026-12-01T00:00:00Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
    answerService: new AnswerService(pool),
    followupService: new FollowupService(pool),
  });
}
function unsafe(
  userId: string,
  method: "put" | "post" | "delete" | "patch",
  path: string,
) {
  const agent = request(app(userId));
  return agent[method](path)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
function read(userId: string, path: string) {
  return request(app(userId))
    .get(path)
    .set("Cookie", "__Host-chalktalk_session=opaque");
}
async function post(
  type: "question" | "note" | "poll" = "question",
  announcement = false,
) {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,announcement) VALUES ($1,$2,$3,$4,'Title','Body',$5)",
    [
      id,
      ids.course,
      announcement ? ids.staff : ids.student,
      type,
      announcement,
    ],
  );
  if (type === "poll") {
    await pool.query(
      "INSERT INTO poll_options (id,course_id,post_id,label,position) VALUES ($1,$2,$3,'Option',0)",
      [uuidv7(), ids.course, id],
    );
    await pool.query("INSERT INTO poll_settings (post_id) VALUES ($1)", [id]);
  }
  return id;
}
async function toggle(
  postId: string,
  locked: boolean,
  etag?: string,
  userId = ids.staff,
) {
  const req = unsafe(
    userId,
    "put",
    `/api/v1/posts/${postId}/discussion-lock`,
  ).send({ locked });
  return etag ? req.set("If-Match", etag) : req;
}

integration("per-post discussion locks", () => {
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
      [ids.org],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$4,'staff@example.edu','Staff','x'),($2,$4,'student@example.edu','Student','x'),($3,$4,'outsider@example.edu','Outsider','x')",
      [ids.staff, ids.student, ids.outsider, ids.org],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.org, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'ta'),($1,$3,'student')",
      [ids.course, ids.staff, ids.student],
    );
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  it("projects default false; staff toggles conditionally without moving feed order", async () => {
    const id = await post();
    const newerId = await post();
    await pool.query(
      "UPDATE posts SET last_activity_at=now()-interval '1 day' WHERE id=$1",
      [id],
    );
    const feedPath = `/api/v1/courses/${ids.course}/posts`;
    const orderBefore = (await read(ids.student, feedPath)).body.data.map(
      (item: { id: string }) => item.id,
    );
    expect(orderBefore.slice(0, 2)).toEqual([newerId, id]);
    const before = await read(ids.student, `/api/v1/posts/${id}`);
    expect(before.status).toBe(200);
    expect(before.body.data.discussionLocked).toBe(false);
    const activity = before.body.data.lastActivityAt;
    const missing = await toggle(id, true);
    expect(missing.status).toBe(428);
    const denied = await toggle(id, true, before.headers.etag, ids.student);
    expect(denied.status).toBe(403);
    expect(
      (await toggle(id, true, before.headers.etag, ids.outsider)).status,
    ).toBe(404);
    const locked = await toggle(id, true, before.headers.etag);
    expect(locked.status).toBe(200);
    expect(locked.body.data.discussionLocked).toBe(true);
    expect(locked.body.data.lastActivityAt).toBe(activity);
    expect(locked.headers.etag).not.toBe(before.headers.etag);
    expect((await toggle(id, false, before.headers.etag)).status).toBe(412);
    const repeat = await toggle(id, true, locked.headers.etag);
    expect(repeat.status).toBe(200);
    expect(repeat.headers.etag).toBe(locked.headers.etag);
    const listing = await read(ids.student, feedPath);
    expect(listing.body.data.map((item: { id: string }) => item.id)).toEqual(
      orderBefore,
    );
    expect(
      listing.body.data.find((item: { id: string }) => item.id === id)
        .discussionLocked,
    ).toBe(true);
    const unlocked = await toggle(id, false, repeat.headers.etag);
    expect(unlocked.body.data.discussionLocked).toBe(false);
  });
  it.each([
    ["ordinary note", false],
    ["announcement", true],
  ])(
    "rejects discussion lock changes on an %s",
    async (_label, announcement) => {
      const id = await post("note", announcement);
      const path = `/api/v1/posts/${id}`;
      const before = await read(ids.staff, path);
      expect(before.status).toBe(200);
      expect(before.body.data.discussionLocked).toBe(false);
      for (const locked of [true, false]) {
        const result = await toggle(id, locked, before.headers.etag);
        expect(result.status).toBe(422);
        expect(result.body.error.code).toBe("validation_failed");
      }
      const after = await read(ids.staff, path);
      expect(after.body.data.discussionLocked).toBe(false);
      expect(after.body.data.version).toBe(before.body.data.version);
      expect(after.body.data.lastActivityAt).toBe(
        before.body.data.lastActivityAt,
      );
      expect(after.headers.etag).toBe(before.headers.etag);
      const listing = await read(
        ids.staff,
        `/api/v1/courses/${ids.course}/posts`,
      );
      expect(
        listing.body.data.find((item: { id: string }) => item.id === id)
          .discussionLocked,
      ).toBe(false);
    },
  );
  it("rejects new answers, root followups and replies, but permits edits and staff resolution", async () => {
    const id = await post();
    const answer = await unsafe(
      ids.student,
      "post",
      `/api/v1/posts/${id}/answers`,
    ).send({ bodyMarkdown: "Original answer" });
    const root = await unsafe(
      ids.student,
      "post",
      `/api/v1/posts/${id}/followups`,
    ).send({ bodyMarkdown: "Original followup" });
    expect(answer.status).toBe(201);
    expect(root.status).toBe(201);
    const current = await read(ids.staff, `/api/v1/posts/${id}`);
    expect((await toggle(id, true, current.headers.etag)).status).toBe(200);
    for (const path of [
      `/api/v1/posts/${id}/answers`,
      `/api/v1/posts/${id}/followups`,
      `/api/v1/followups/${root.body.data.id}/replies`,
    ]) {
      const result = await unsafe(ids.student, "post", path).send({
        bodyMarkdown: "New content",
      });
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe("discussion_locked");
    }
    const edited = await unsafe(
      ids.student,
      "patch",
      `/api/v1/followups/${root.body.data.id}`,
    )
      .set("If-Match", root.headers.etag)
      .send({ bodyMarkdown: "Edited followup" });
    expect(edited.status).toBe(200);
    const resolved = await unsafe(
      ids.staff,
      "put",
      `/api/v1/followups/${root.body.data.id}/resolution`,
    ).send({ resolved: true });
    expect(resolved.status).toBe(200);
    for (const path of [
      `/api/v1/answers/${answer.body.data.id}/upvote`,
      `/api/v1/followups/${root.body.data.id}/upvote`,
    ]) {
      for (const method of ["put", "delete"] as const) {
        const result = await unsafe(ids.student, method, path);
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe("discussion_locked");
      }
    }
    const editedAnswer = await unsafe(
      ids.staff,
      "patch",
      `/api/v1/answers/${answer.body.data.id}`,
    )
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: "Updated answer" });
    expect(editedAnswer.status).toBe(200);
    expect(
      (
        await unsafe(
          ids.staff,
          "delete",
          `/api/v1/answers/${answer.body.data.id}`,
        ).set("If-Match", editedAnswer.headers.etag)
      ).status,
    ).toBe(204);
    expect(
      (
        await unsafe(
          ids.student,
          "delete",
          `/api/v1/followups/${root.body.data.id}`,
        ).set("If-Match", edited.headers.etag)
      ).status,
    ).toBe(204);
  });
  it("validates lock payloads and preserves content editing on a locked post", async () => {
    const id = await post();
    const current = await read(ids.staff, `/api/v1/posts/${id}`);
    for (const value of ["true", 1, null]) {
      const invalid = await unsafe(
        ids.staff,
        "put",
        `/api/v1/posts/${id}/discussion-lock`,
      )
        .set("If-Match", current.headers.etag)
        .send({ locked: value });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe("validation_failed");
    }
    const extra = await unsafe(
      ids.staff,
      "put",
      `/api/v1/posts/${id}/discussion-lock`,
    )
      .set("If-Match", current.headers.etag)
      .send({ locked: true, title: "smuggled" });
    expect(extra.status).toBe(422);
    expect((await toggle(id, true, current.headers.etag)).status).toBe(200);
    const latest = await read(ids.staff, `/api/v1/posts/${id}`);
    const edited = await unsafe(ids.student, "patch", `/api/v1/posts/${id}`)
      .set("If-Match", latest.headers.etag)
      .send({ bodyMarkdown: "Updated while locked" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.discussionLocked).toBe(true);
    expect(edited.body.data.bodyMarkdown).toBe("Updated while locked");
  });

  it("waits on the parent row and rejects an in-flight answer after the lock commits", async () => {
    const id = await post();
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE", [id]);
      let settled = false;
      const creating = unsafe(
        ids.student,
        "post",
        `/api/v1/posts/${id}/answers`,
      )
        .send({ bodyMarkdown: "Racing answer" })
        .then((result) => {
          settled = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
      await holder.query(
        "UPDATE posts SET discussion_locked=true,version=version+1 WHERE id=$1",
        [id],
      );
      await holder.query("COMMIT");
      const rejected = await creating;
      expect(rejected.status).toBe(409);
      expect(rejected.body.error.code).toBe("discussion_locked");
      const rows = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM answers WHERE post_id=$1",
        [id],
      );
      expect(rows.rows[0].count).toBe("0");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("blocks casting and retracting poll ballots while locked", async () => {
    const id = await post("poll");
    const option = await pool.query<{ id: string }>(
      "SELECT id FROM poll_options WHERE post_id=$1",
      [id],
    );
    const votePath = `/api/v1/posts/${id}/vote`;
    expect(
      (
        await unsafe(ids.student, "put", votePath).send({
          optionId: option.rows[0].id,
        })
      ).status,
    ).toBe(200);
    const current = await read(ids.staff, `/api/v1/posts/${id}`);
    expect((await toggle(id, true, current.headers.etag)).status).toBe(200);
    for (const method of ["put", "delete"] as const) {
      const req = unsafe(ids.student, method, votePath);
      const result =
        method === "put"
          ? await req.send({ optionId: option.rows[0].id })
          : await req;
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe("discussion_locked");
    }
    const votes = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM poll_votes WHERE post_id=$1",
      [id],
    );
    expect(votes.rows[0].count).toBe("1");
  });
});
