import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { PostService } from "../posts/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `answers_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
  otherCourse: "01a0e5cc-58ae-7009-9f43-e69b17afee03",
  archivedCourse: "01a0e5cc-58ae-7009-9f43-e69b17afee04",
  author: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  student: "01a0e5cc-58ae-7009-9f43-cd86eb2ae706",
  staff: "01a0e5cc-58ae-7009-9f43-ddd412c38e07",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  outsider: "01a0e5cc-58ae-7009-9f43-e237164911e9",
  leaver: "01a0e5cc-58ae-7009-9f43-e237164911ea",
};
const names: Record<string, string> = {
  [ids.author]: "Author",
  [ids.student]: "Student",
  [ids.staff]: "Staff",
  [ids.instructor]: "Instructor",
  [ids.outsider]: "Outsider",
  [ids.leaver]: "Leaver",
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
function app(userId = ids.author) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: "01a0e5cc-58af-7467-8ab1-740de2b8c8e0",
        user: {
          id: userId,
          email: "user@example.edu",
          displayName: names[userId] ?? "User",
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
  });
}
function unsafe(test: request.Test) {
  return test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
function read(userId: string, path: string) {
  return request(app(userId)).get(path).set("Cookie", cookie);
}
async function insertPost(
  type: "question" | "note" = "question",
  courseId = ids.course,
): Promise<string> {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,$4,'Title','Body')",
    [id, courseId, ids.author, type],
  );
  return id;
}
function answer(
  userId: string,
  postId: string,
  body: object = { bodyMarkdown: "Rayleigh scattering." },
) {
  return unsafe(
    request(app(userId)).post(`/api/v1/posts/${postId}/answers`),
  ).send(body);
}

integration("answers HTTP contract: create and read", () => {
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
    for (const [id, name] of Object.entries(names))
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.organization, `${name.toLowerCase()}@example.edu`, name],
      );
    for (const [courseId, name, code] of [
      [ids.course, "Physics", "ABCDEFGH"],
      [ids.otherCourse, "Chemistry", "BCDEFGHI"],
      [ids.archivedCourse, "History", "CDEFGHIJ"],
    ])
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5)",
        [courseId, ids.organization, ids.author, name, code],
      );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($1,$5,'instructor'),($1,$6,'student'),($7,$2,'instructor'),($8,$2,'student'),($8,$4,'ta')",
      [
        ids.course,
        ids.author,
        ids.student,
        ids.staff,
        ids.instructor,
        ids.leaver,
        ids.otherCourse,
        ids.archivedCourse,
      ],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("creates a student answer with the documented headers and shape", async () => {
    const postId = await insertPost();
    const created = await answer(ids.author, postId);
    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      `/api/v1/answers/${created.body.data.id}`,
    );
    expect(created.headers.etag).toBe('"v1"');
    expect(created.body.data).toEqual({
      id: created.body.data.id,
      postId,
      kind: "student",
      deleted: false,
      bodyMarkdown: "Rayleigh scattering.",
      contributors: [{ id: ids.author, displayName: "Author" }],
      anonymous: false,
      attachments: [],
      endorsedAt: null,
      endorsedBy: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      version: 1,
    });
    const document = await pool.query(
      "SELECT yjs_state,lifecycle_state,persistence_revision FROM answer_collaboration_documents WHERE answer_id=$1",
      [created.body.data.id],
    );
    expect(document.rows).toEqual([
      {
        yjs_state: Buffer.from([0, 0]),
        lifecycle_state: "active",
        persistence_revision: "0",
      },
    ]);
    const fetched = await read(ids.student, created.headers.location);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.etag).toBe('"v1"');
    expect(fetched.body.data).toEqual(created.body.data);
  });

  it("derives staff kind and lists the student answer before the staff answer", async () => {
    const postId = await insertPost();
    const staff = await answer(ids.staff, postId, { bodyMarkdown: "Staff." });
    expect(staff.status).toBe(201);
    expect(staff.body.data.kind).toBe("staff");
    const student = await answer(ids.student, postId);
    expect(student.status).toBe(201);
    const listed = await read(ids.author, `/api/v1/posts/${postId}/answers`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((item: { kind: string }) => item.kind)).toEqual(
      ["student", "staff"],
    );
    const empty = await read(
      ids.author,
      `/api/v1/posts/${await insertPost()}/answers`,
    );
    expect(empty.body).toEqual({ data: [] });
  });

  it("allows one active answer of each kind, including concurrent attempts", async () => {
    const postId = await insertPost();
    const results = await Promise.all([
      answer(ids.author, postId),
      answer(ids.student, postId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      results.find((result) => result.status === 409)!.body.error.code,
    ).toBe("answer_kind_exists");
    await answer(ids.staff, postId);
    const second = await answer(ids.instructor, postId);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("answer_kind_exists");
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM answers WHERE post_id=$1",
      [postId],
    );
    expect(count.rows[0].n).toBe(2);
  });

  it("replays an idempotent create and rejects conflicting key reuse", async () => {
    const postId = await insertPost();
    const key = "answer-key-1";
    const first = await answer(ids.author, postId).set("Idempotency-Key", key);
    const replay = await answer(ids.author, postId).set("Idempotency-Key", key);
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);
    const conflict = await answer(ids.author, postId, {
      bodyMarkdown: "Different.",
    }).set("Idempotency-Key", key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_key_reused");
    const rows = await pool.query(
      "SELECT (SELECT count(*) FROM answers WHERE post_id=$1)::int AS answers,(SELECT count(*) FROM answer_contributors c JOIN answers a ON a.id=c.answer_id WHERE a.post_id=$1)::int AS contributors",
      [postId],
    );
    expect(rows.rows[0]).toEqual({ answers: 1, contributors: 1 });
  });

  it("uses the current role to project anonymous contributors on replay", async () => {
    const postId = await insertPost();
    const key = "anonymous-role-change";
    const body = { bodyMarkdown: "Staff response.", anonymous: true };
    const first = await answer(ids.staff, postId, body).set(
      "Idempotency-Key",
      key,
    );
    expect(first.status).toBe(201);
    expect(first.body.data.contributors).toEqual([
      { id: ids.staff, displayName: "Staff" },
    ]);
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.staff],
    );
    try {
      const replay = await answer(ids.staff, postId, body).set(
        "Idempotency-Key",
        key,
      );
      expect(replay.status).toBe(201);
      expect(replay.body.data).toEqual({
        ...first.body.data,
        contributors: null,
      });
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.staff],
      );
      const restored = await answer(ids.staff, postId, body).set(
        "Idempotency-Key",
        key,
      );
      expect(restored.status).toBe(201);
      expect(restored.body.data).toEqual(first.body.data);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.staff],
      );
    }
  });

  it("validates the request body and media type", async () => {
    const postId = await insertPost();
    for (const body of [
      {},
      { bodyMarkdown: "" },
      { bodyMarkdown: "   " },
      { bodyMarkdown: "x".repeat(100001) },
      { bodyMarkdown: "ok", anonymous: "yes" },
      { bodyMarkdown: "ok", extra: true },
    ]) {
      const result = await answer(ids.author, postId, body);
      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe("validation_failed");
    }
    const multipart = await unsafe(
      request(app()).post(`/api/v1/posts/${postId}/answers`),
    ).field("metadata", JSON.stringify({ bodyMarkdown: "ok" }));
    expect(multipart.status).toBe(422);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM answers WHERE post_id=$1",
      [postId],
    );
    expect(count.rows[0].n).toBe(0);
  });

  it("requires an allowed origin, CSRF token, and session", async () => {
    const postId = await insertPost();
    const path = `/api/v1/posts/${postId}/answers`;
    const noCsrf = await request(app())
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", environment.frontendBaseUrl)
      .send({ bodyMarkdown: "x" });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("csrf_validation_failed");
    const badOrigin = await request(app())
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", "csrf")
      .send({ bodyMarkdown: "x" });
    expect(badOrigin.status).toBe(403);
    const unauthenticated = await request(
      createApp({
        environment,
        authService: {
          session: async () => {
            throw new (await import("../auth/errors.js")).AuthError(
              401,
              "authentication_required",
              "Authentication is required",
            );
          },
        } as unknown as AuthService,
        answerService: new AnswerService(pool),
      }),
    ).get(path);
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects notes, hidden posts, other courses, non-members, and archived courses", async () => {
    const note = await insertPost("note");
    const noteCreate = await answer(ids.author, note);
    expect(noteCreate.status).toBe(409);
    expect(noteCreate.body.error.code).toBe("not_a_question");
    const noteList = await read(ids.author, `/api/v1/posts/${note}/answers`);
    expect(noteList.status).toBe(422);
    expect(noteList.body.error.code).toBe("not_a_question");

    const deleted = await insertPost();
    await pool.query(
      "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now() WHERE id=$1",
      [deleted],
    );
    const canonical = await insertPost();
    const merged = await insertPost();
    const mergedAnswer = await answer(ids.author, merged);
    await pool.query(
      "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
      [merged, canonical],
    );
    const other = await insertPost("question", ids.otherCourse);
    for (const [userId, postId] of [
      [ids.author, deleted],
      [ids.author, merged],
      [ids.student, other],
      [ids.outsider, await insertPost()],
      [ids.author, uuidv7()],
    ] as const) {
      const created = await answer(userId, postId);
      expect(created.status).toBe(404);
      expect(created.body.error.code).toBe("not_found");
      const listed = await read(userId, `/api/v1/posts/${postId}/answers`);
      expect(listed.status).toBe(404);
    }
    const hidden = await read(ids.author, mergedAnswer.headers.location);
    expect(hidden.status).toBe(404);
    const outsider = await read(
      ids.outsider,
      (await answer(ids.author, await insertPost())).headers.location,
    );
    expect(outsider.status).toBe(404);

    const archivedPost = await insertPost("question", ids.archivedCourse);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.archivedCourse,
    ]);
    const archived = await answer(ids.author, archivedPost);
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe("course_archived");
  });

  it("projects contributors for each viewer and omits deleted accounts", async () => {
    const postId = await insertPost();
    const anonymous = await answer(ids.author, postId, {
      bodyMarkdown: "Hidden.",
      anonymous: true,
    });
    expect(anonymous.body.data).toMatchObject({
      anonymous: true,
      contributors: null,
    });
    const path = anonymous.headers.location;
    expect((await read(ids.student, path)).body.data.contributors).toBeNull();
    expect((await read(ids.author, path)).body.data.contributors).toBeNull();
    for (const viewer of [ids.staff, ids.instructor])
      expect((await read(viewer, path)).body.data.contributors).toEqual([
        { id: ids.author, displayName: "Author" },
      ]);

    const leaverPost = await insertPost();
    const leaverAnswer = await answer(ids.leaver, leaverPost);
    await pool.query(
      "UPDATE users SET deleted_at=now(),display_name='Deleted user' WHERE id=$1",
      [ids.leaver],
    );
    const afterDeletion = await read(ids.staff, leaverAnswer.headers.location);
    expect(afterDeletion.body.data.contributors).toEqual([]);
  });

  function endorse(userId: string, path: string, etag?: string) {
    const test = unsafe(request(app(userId)).put(`${path}/endorsement`));
    return etag ? test.set("If-Match", etag) : test;
  }
  function remove(userId: string, path: string, etag?: string) {
    const test = unsafe(request(app(userId)).delete(path));
    return etag ? test.set("If-Match", etag) : test;
  }
  async function lifecycle(answerId: string) {
    const result = await pool.query(
      "SELECT lifecycle_state FROM answer_collaboration_documents WHERE answer_id=$1",
      [answerId],
    );
    return result.rows[0].lifecycle_state;
  }

  it("lets staff endorse an answer conditionally and repeat the endorsement", async () => {
    const created = await answer(ids.author, await insertPost());
    const path = created.headers.location;
    const missing = await endorse(ids.staff, path);
    expect(missing.status).toBe(428);
    expect(missing.body.error.code).toBe("precondition_required");
    const stale = await endorse(ids.staff, path, '"v9"');
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe("version_conflict");
    const student = await endorse(ids.student, path, '"v1"');
    expect(student.status).toBe(403);
    expect(student.body.error.code).toBe("permission_denied");
    const endorsed = await endorse(ids.staff, path, '"v1"');
    expect(endorsed.status).toBe(200);
    expect(endorsed.headers.etag).toBe('"v2"');
    expect(endorsed.body.data).toMatchObject({
      endorsedAt: expect.any(String),
      endorsedBy: ids.staff,
      version: 2,
    });
    expect(await lifecycle(created.body.data.id)).toBe("closed");
    const repeated = await endorse(ids.instructor, path, '"v2"');
    expect(repeated.status).toBe(200);
    expect(repeated.body.data).toEqual(endorsed.body.data);
    const outdated = await endorse(ids.instructor, path, '"v1"');
    expect(outdated.status).toBe(412);
  });

  it("lets staff delete an unendorsed answer and frees its kind", async () => {
    const postId = await insertPost();
    const created = await answer(ids.author, postId);
    const path = created.headers.location;
    const missing = await remove(ids.staff, path);
    expect(missing.status).toBe(428);
    const student = await remove(ids.author, path, '"v1"');
    expect(student.status).toBe(403);
    expect(student.body.error.code).toBe("permission_denied");
    const stale = await remove(ids.instructor, path, '"v2"');
    expect(stale.status).toBe(412);
    const deleted = await remove(ids.instructor, path, '"v1"');
    expect(deleted.status).toBe(204);
    expect((await read(ids.author, path)).status).toBe(404);
    expect(
      (await read(ids.author, `/api/v1/posts/${postId}/answers`)).body.data,
    ).toEqual([]);
    expect(await lifecycle(created.body.data.id)).toBe("closed");
    const row = await pool.query(
      "SELECT body_markdown,deleted_at,version FROM answers WHERE id=$1",
      [created.body.data.id],
    );
    expect(row.rows[0]).toMatchObject({
      body_markdown: null,
      deleted_at: expect.any(Date),
      version: "2",
    });
    expect((await remove(ids.instructor, path, '"v2"')).status).toBe(404);
    expect((await endorse(ids.instructor, path, '"v2"')).status).toBe(404);
    const replacement = await answer(ids.student, postId);
    expect(replacement.status).toBe(201);
  });

  it("refuses to delete an endorsed answer", async () => {
    const created = await answer(ids.author, await insertPost());
    const path = created.headers.location;
    await endorse(ids.staff, path, '"v1"');
    const result = await remove(ids.staff, path, '"v2"');
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("answer_endorsed");
  });

  it("rejects staff writes in an archived course and on hidden answers", async () => {
    const created = await answer(ids.author, await insertPost());
    const path = created.headers.location;
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      for (const result of [
        await endorse(ids.staff, path, '"v1"'),
        await remove(ids.staff, path, '"v1"'),
      ]) {
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe("course_archived");
      }
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    const merged = await insertPost();
    const mergedAnswer = await answer(ids.author, merged);
    await pool.query(
      "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
      [merged, await insertPost()],
    );
    for (const [userId, target] of [
      [ids.staff, mergedAnswer.headers.location],
      [ids.outsider, path],
      [ids.staff, `/api/v1/answers/${uuidv7()}`],
    ] as const) {
      expect((await endorse(userId, target, '"v1"')).status).toBe(404);
      expect((await remove(userId, target, '"v1"')).status).toBe(404);
    }
  });

  it("does not offer answer text edits in this phase", async () => {
    const created = await answer(ids.author, await insertPost());
    const patch = await unsafe(
      request(app(ids.author)).patch(created.headers.location),
    )
      .set("If-Match", '"v1"')
      .send({ anonymous: true });
    expect(patch.status).toBe(404);
    const after = await read(ids.author, created.headers.location);
    expect(after.body.data).toEqual(created.body.data);
  });

  it("reports answered questions and filters by answer presence", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Answer me", bodyMarkdown: "Please." });
    const postPath = created.headers.location;
    const postId = created.body.data.id;
    const listed = async (answered: boolean) =>
      (
        await read(
          ids.author,
          `/api/v1/courses/${ids.course}/posts?answered=${answered}&limit=100`,
        )
      ).body.data.map((item: { id: string }) => item.id);
    expect((await read(ids.author, postPath)).body.data.answered).toBe(false);
    expect(await listed(false)).toContain(postId);
    expect(await listed(true)).not.toContain(postId);

    const before = await read(ids.author, postPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const answered = await answer(ids.student, postId);
    const after = await read(ids.author, postPath);
    expect(after.body.data.answered).toBe(true);
    expect(after.headers.etag).toBe(before.headers.etag);
    expect(after.body.data.version).toBe(before.body.data.version);
    expect(Date.parse(after.body.data.lastActivityAt)).toBeGreaterThan(
      Date.parse(before.body.data.lastActivityAt),
    );
    expect(await listed(true)).toContain(postId);
    expect(await listed(false)).not.toContain(postId);

    await remove(ids.staff, answered.headers.location, '"v1"');
    expect((await read(ids.author, postPath)).body.data.answered).toBe(false);
    expect(await listed(false)).toContain(postId);
  });
});
