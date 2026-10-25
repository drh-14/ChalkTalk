import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { PostService } from "../posts/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `posts_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  author: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  student: "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c",
  staff: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
  outsider: "01a0e5cc-58ae-7009-9f43-e237164911da",
  otherCourse: "01a0e5cc-58ae-7009-9f43-e69b17afef06",
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
const sessionId = "01a0e5cc-58af-7467-8ab1-740de2b8c8c3";
function app(userId = ids.author) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: sessionId,
        user: {
          id: userId,
          email: "author@example.edu",
          displayName:
            userId === ids.author
              ? "Author"
              : userId === ids.student
                ? "Student"
                : userId === ids.staff
                  ? "Staff"
                  : userId === ids.instructor
                    ? "Instructor"
                    : "Outsider",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        expiresAt: "2026-12-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
  });
}
function unsafe(agent: request.SuperTest<request.Test>) {
  return agent
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}

integration("text posts HTTP contract", () => {
  it("rejects semanticQuery without q or above its bound", async () => {
    const missing = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts?semanticQuery=related`)
      .set("Cookie", cookie);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("invalid_request");
    const oversized = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "related", semanticQuery: "x".repeat(501) })
      .set("Cookie", cookie);
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.code).toBe("invalid_request");
  });
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
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'author@example.edu','Author','x')",
      [ids.author, ids.organization],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'student@example.edu','Student','x'),($3,$2,'staff@example.edu','Staff','x'),($4,$2,'outsider@example.edu','Outsider','x')",
      [ids.student, ids.organization, ids.staff, ids.outsider],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'instructor@example.edu','Instructor','x')",
      [ids.instructor, ids.organization],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.organization, ids.author],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Chemistry','BCDEFGHI')",
      [ids.otherCourse, ids.organization, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [ids.course, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.otherCourse, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'ta'),($4,$3,'ta')",
      [ids.course, ids.student, ids.staff, ids.otherCourse],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.course, ids.instructor],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  it("creates and retrieves a question with the documented headers and shape", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Why?",
      bodyMarkdown: "Because.",
      tags: ["Physics"],
    });
    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      `/api/v1/posts/${created.body.data.id}`,
    );
    expect(created.headers.etag).toBe('"v1"');
    expect(created.body.data).toMatchObject({
      courseId: ids.course,
      type: "question",
      deleted: false,
      title: "Why?",
      bodyMarkdown: "Because.",
      tags: ["physics"],
      attachments: [],
      answered: false,
      version: 1,
      author: {
        userId: ids.author,
        displayName: "Author",
        anonymous: false,
        deleted: false,
      },
    });
    const read = await request(app())
      .get(created.headers.location)
      .set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual(created.body.data);
  });
  it("projects anonymous author identity for the author and staff but not another student", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "note",
      title: "Private identity",
      bodyMarkdown: "Visible content",
      anonymous: true,
    });
    expect(created.status).toBe(201);
    const path = created.headers.location;
    const student = await request(app(ids.student))
      .get(path)
      .set("Cookie", cookie);
    const staff = await request(app(ids.staff)).get(path).set("Cookie", cookie);
    const instructor = await request(app(ids.instructor))
      .get(path)
      .set("Cookie", cookie);
    expect(created.body.data.author).toEqual({
      userId: ids.author,
      displayName: "Author",
      anonymous: true,
      deleted: false,
    });
    expect(student.body.data.author).toEqual({
      userId: null,
      displayName: "Anonymous",
      anonymous: true,
      deleted: false,
    });
    expect(staff.body.data.author).toEqual(created.body.data.author);
    expect(instructor.body.data.author).toEqual(created.body.data.author);
  });
  it("returns indistinguishable 404s for absent and other-course post IDs", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.otherCourse}/posts`),
    ).send({ type: "note", title: "Other course", bodyMarkdown: "Secret" });
    expect(created.status).toBe(201);
    const otherCourseRead = await request(app(ids.student))
      .get(created.headers.location)
      .set("Cookie", cookie);
    const absentRead = await request(app(ids.student))
      .get("/api/v1/posts/01a0e5cc-58ae-7009-9f43-edde38b21440")
      .set("Cookie", cookie);
    expect(otherCourseRead.status).toBe(404);
    expect(otherCourseRead.body.error.code).toBe("not_found");
    expect(absentRead.status).toBe(404);
    expect(absentRead.body.error.code).toBe("not_found");
  });
  it("hides anonymous author-filter matches before pagination", async () => {
    await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
      .send({
        type: "note",
        title: "Anonymous physics",
        bodyMarkdown: "Scattering",
        anonymous: true,
        tags: ["visibility-slice"],
      })
      .expect(201);
    const visible = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Named physics",
        bodyMarkdown: "Scattering",
        tags: ["visibility-slice"],
      })
      .expect(201);
    const student = await request(app(ids.student))
      .get(
        `/api/v1/courses/${ids.course}/posts?authorId=${ids.author}&tag=visibility-slice&limit=1`,
      )
      .set("Cookie", cookie);
    expect(student.status).toBe(200);
    expect(student.body.data).toHaveLength(1);
    expect(student.body.data[0].id).toBe(visible.body.data.id);
    expect(student.body.page.hasMore).toBe(false);
    const staff = await request(app(ids.staff))
      .get(
        `/api/v1/courses/${ids.course}/posts?authorId=${ids.author}&tag=visibility-slice`,
      )
      .set("Cookie", cookie);
    expect(staff.status).toBe(200);
    expect(
      staff.body.data.some(
        (post: { title: string }) => post.title === "Anonymous physics",
      ),
    ).toBe(true);
    const other = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.otherCourse}/posts`)
      .set("Cookie", cookie);
    expect(other.status).toBe(404);
  });
  it("enforces conditional edits and member duplicate-suggestion permissions", async () => {
    const source = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Original", bodyMarkdown: "Text" })
      .expect(201);
    const target = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Canonical", bodyMarkdown: "Text" })
      .expect(201);
    const path = source.headers.location;
    const hiddenEdit = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", source.headers.etag)
      .send({ title: "Hijack" });
    expect(hiddenEdit.status).toBe(403);
    expect(hiddenEdit.body.error.code).toBe("permission_denied");
    const suggested = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", source.headers.etag)
      .send({
        duplicateOfPostId: target.body.data.id,
        duplicateStatus: "suggested",
      });
    expect(suggested.status).toBe(200);
    expect(suggested.headers.etag).toBe('"v2"');
    expect(suggested.body.data.duplicateStatus).toBe("suggested");
    const visibleSuggestion = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts?duplicateStatus=suggested`)
      .set("Cookie", cookie);
    expect(visibleSuggestion.status).toBe(200);
    expect(
      visibleSuggestion.body.data.map((post: { id: string }) => post.id),
    ).toContain(source.body.data.id);
    const stale = await unsafe(request(app()).patch(path))
      .set("If-Match", source.headers.etag)
      .send({ title: "New" });
    expect(stale.status).toBe(412);
    const updated = await unsafe(request(app()).patch(path))
      .set("If-Match", suggested.headers.etag)
      .send({ title: "New", tags: ["Revised"] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe("New");
    expect(updated.body.data.tags).toEqual(["revised"]);
    expect(updated.headers.etag).toBe('"v3"');
  });
  it("deletes to an exact tombstone without listing it or permitting resurrection", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Delete me",
        bodyMarkdown: "Private body",
        tags: ["delete-slice"],
      })
      .expect(201);
    const path = created.headers.location;
    const denied = await unsafe(request(app(ids.student)).delete(path)).set(
      "If-Match",
      created.headers.etag,
    );
    expect(denied.status).toBe(403);
    const removed = await unsafe(request(app()).delete(path)).set(
      "If-Match",
      created.headers.etag,
    );
    expect(removed.status).toBe(204);
    expect(removed.text).toBe("");
    const tombstone = await request(app(ids.student))
      .get(path)
      .set("Cookie", cookie);
    expect(tombstone.status).toBe(200);
    expect(Object.keys(tombstone.body.data).sort()).toEqual([
      "courseId",
      "createdAt",
      "deleted",
      "id",
      "type",
      "updatedAt",
      "version",
    ]);
    expect(tombstone.body.data).toMatchObject({
      id: created.body.data.id,
      deleted: true,
      version: 2,
    });
    const list = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts?tag=delete-slice`)
      .set("Cookie", cookie);
    expect(list.body).toEqual({
      data: [],
      page: { nextCursor: null, hasMore: false },
    });
    const repeated = await unsafe(request(app()).delete(path)).set(
      "If-Match",
      tombstone.headers.etag,
    );
    expect(repeated.status).toBe(404);
  });
  it("binds idempotency retries to the same caller, course, and body", async () => {
    const path = `/api/v1/courses/${ids.course}/posts`;
    const body = { type: "note", title: "Idempotent", bodyMarkdown: "One row" };
    const first = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "post-retry")
      .send(body);
    const replay = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "post-retry")
      .send(body);
    expect(first.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.location).toBe(first.headers.location);
    const conflict = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "post-retry")
      .send({ ...body, title: "Changed" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_key_reused");
  });
  it("replays an existing key after archive but still requires current membership", async () => {
    const path = `/api/v1/courses/${ids.course}/posts`;
    const body = {
      type: "note",
      title: "Replay after archive",
      bodyMarkdown: "Body",
    };
    const first = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "archive-replay")
      .send(body);
    expect(first.status).toBe(201);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    const replay = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "archive-replay")
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const fresh = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "new-after-archive")
      .send(body);
    expect(fresh.status).toBe(409);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.author],
    );
    const revoked = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "archive-replay")
      .send(body);
    expect(revoked.status).toBe(404);
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [ids.course, ids.author],
    );
  });
  it("binds cursors to viewer, course, and filters while supporting search and repeated-tag OR", async () => {
    for (const title of ["Photon one", "Photon two", "Photon three"]) {
      await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
        .send({
          type: "note",
          title,
          bodyMarkdown: "Light scattering",
          tags: [title.endsWith("one") ? "alpha" : "beta"],
        })
        .expect(201);
    }
    const path = `/api/v1/courses/${ids.course}/posts?q=photon&tag=alpha&tag=beta&sort=relevance&limit=2`;
    const first = await request(app(ids.student))
      .get(path)
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);
    const cursor = encodeURIComponent(first.body.page.nextCursor);
    const second = await request(app(ids.student))
      .get(`${path}&cursor=${cursor}`)
      .set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.page.hasMore).toBe(false);
    expect(
      new Set(
        [...first.body.data, ...second.body.data].map(
          (post: { id: string }) => post.id,
        ),
      ).size,
    ).toBe(3);
    const wrongViewer = await request(app(ids.staff))
      .get(`${path}&cursor=${cursor}`)
      .set("Cookie", cookie);
    expect(wrongViewer.status).toBe(400);
    const wrongFilter = await request(app(ids.student))
      .get(`${path}&type=question&cursor=${cursor}`)
      .set("Cookie", cookie);
    expect(wrongFilter.status).toBe(400);
  });
  it("matches an inflected question title through English full-text search", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Cutoffs for the course",
        bodyMarkdown: "Please clarify the dates.",
      })
      .expect(201);
    const results = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "A cutoff", type: "question", sort: "relevance" })
      .set("Cookie", cookie);
    expect(results.status).toBe(200);
    expect(
      results.body.data.some(
        (post: { id: string }) => post.id === created.body.data.id,
      ),
    ).toBe(true);
  });
  it("finds ordinary-query misspellings in both titles and bodies", async () => {
    const exact = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Galvanometer calibration",
        bodyMarkdown: "Check the instrument before lab.",
        tags: ["fuzzy-typo-slice"],
      })
      .expect(201);
    const title = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Galvanomter calibration",
        bodyMarkdown: "Check the instrument before lab.",
        tags: ["fuzzy-typo-slice"],
      })
      .expect(201);
    const body = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Lab instrument",
        bodyMarkdown: "The galvanomter needle needs calibration.",
        tags: ["fuzzy-typo-slice"],
      })
      .expect(201);
    const results = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "galvanometer", tag: "fuzzy-typo-slice", sort: "relevance" })
      .set("Cookie", cookie);
    expect(results.status).toBe(200);
    expect(results.body.data.map((post: { id: string }) => post.id)).toEqual([
      exact.body.data.id,
      title.body.data.id,
      body.body.data.id,
    ]);
    const fullTextOnly = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({
        q: '"galvanometer"',
        tag: "fuzzy-typo-slice",
        sort: "relevance",
      })
      .set("Cookie", cookie);
    expect(fullTextOnly.status).toBe(200);
    expect(
      fullTextOnly.body.data.map((post: { id: string }) => post.id),
    ).toEqual([exact.body.data.id]);
  });
  it("ranks exact matches first, favors fuzzy titles, and pages the complete union", async () => {
    const create = async (title: string, bodyMarkdown: string) => {
      const response = await unsafe(
        request(app()).post(`/api/v1/courses/${ids.course}/posts`),
      )
        .send({
          type: "note",
          title,
          bodyMarkdown,
          tags: ["fused-rank-slice"],
        })
        .expect(201);
      return response.body.data.id as string;
    };
    const exact = await create("Galvanometer reference", "Instrument notes.");
    const fuzzyTitle = await create(
      "Galvanomter reference",
      "Instrument notes.",
    );
    const fuzzyBody = await create(
      "Instrument reference",
      "Use the galvanomter.",
    );
    const path = `/api/v1/courses/${ids.course}/posts?q=galvanometer&tag=fused-rank-slice&sort=relevance&limit=1`;
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await request(app(ids.student))
        .get(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
        .set("Cookie", cookie);
      expect(page.status).toBe(200);
      found.push(...page.body.data.map((post: { id: string }) => post.id));
      cursor = page.body.page.nextCursor;
      expect(page.body.page.hasMore).toBe(Boolean(cursor));
    } while (cursor);
    expect(found).toEqual([exact, fuzzyTitle, fuzzyBody]);
  });
  it("keeps every full-text body match ahead of a stronger fuzzy-only title match", async () => {
    const fuzzy = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Electroencephalograpy reference",
        bodyMarkdown: "Instrument notes.",
        tags: ["tier-boundary-slice"],
      })
      .expect(201);
    const tag = await pool.query<{ id: string }>(
      "SELECT id FROM tags WHERE course_id=$1 AND name=$2",
      [ids.course, "tier-boundary-slice"],
    );
    const exact = await pool.query<{ post_id: string }>(
      `WITH inserted AS (
        INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown)
        SELECT gen_random_uuid(),$1,$2,'note','Body match ' || n,'electroencephalography'
        FROM generate_series(1,100) AS n RETURNING id
      ) INSERT INTO post_tags (post_id,tag_id)
        SELECT id,$3 FROM inserted RETURNING post_id`,
      [ids.course, ids.author, tag.rows[0].id],
    );
    expect(exact.rows).toHaveLength(100);
    const path = `/api/v1/courses/${ids.course}/posts?q=electroencephalography&tag=tier-boundary-slice&sort=relevance&limit=100`;
    const first = await request(app(ids.student))
      .get(path)
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.page.hasMore).toBe(true);
    expect(first.body.data.map((post: { id: string }) => post.id)).toEqual(
      expect.arrayContaining(exact.rows.map((row) => row.post_id)),
    );
    const second = await request(app(ids.student))
      .get(`${path}&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
      .set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.data.map((post: { id: string }) => post.id)).toEqual([
      fuzzy.body.data.id,
    ]);
    expect(second.body.page).toEqual({ nextCursor: null, hasMore: false });
  }, 30_000);
  it("favors a title over a body when both exactly match an ordinary query", async () => {
    const title = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Diffractometer",
        bodyMarkdown: "Laboratory instrument.",
        tags: ["lexical-title-slice"],
      })
      .expect(201);
    const body = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Laboratory instrument",
        bodyMarkdown: "Diffractometer",
        tags: ["lexical-title-slice"],
      })
      .expect(201);
    const result = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "diffractometer", tag: "lexical-title-slice" })
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.data.map((post: { id: string }) => post.id)).toEqual([
      title.body.data.id,
      body.body.data.id,
    ]);
  });
  it("uses timestamp ordering for an ordinary fuzzy search with a non-relevance sort", async () => {
    const exact = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Spectrometer calibration",
        bodyMarkdown: "Measure the spectrum.",
        tags: ["fuzzy-time-slice"],
      })
      .expect(201);
    const typo = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Spectromter notes",
        bodyMarkdown: "Measure the spectrum.",
        tags: ["fuzzy-time-slice"],
      })
      .expect(201);
    const result = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "spectrometer", tag: "fuzzy-time-slice", sort: "newest" })
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.data.map((post: { id: string }) => post.id)).toEqual([
      typo.body.data.id,
      exact.body.data.id,
    ]);
  });
  it("ignores short fuzzy terms while retaining the longer misspelled term", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Spectromter instructions",
        bodyMarkdown: "Read before the lab.",
        tags: ["fuzzy-short-slice"],
      })
      .expect(201);
    const result = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "x spectrometer", tag: "fuzzy-short-slice" })
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.data.map((post: { id: string }) => post.id)).toEqual([
      created.body.data.id,
    ]);
  });
  it("uses full-text ranking when no query term qualifies for fuzzy search", async () => {
    const create = async (title: string, bodyMarkdown: string) => {
      const response = await unsafe(
        request(app()).post(`/api/v1/courses/${ids.course}/posts`),
      )
        .send({
          type: "note",
          title,
          bodyMarkdown,
          tags: ["short-terms-slice"],
        })
        .expect(201);
      return response.body.data.id as string;
    };
    const first = await create("ab cd reference", "Lab notes.");
    const second = await create("Lab reference", "ab cd ab cd ab cd");
    const third = await create("Lab details", "ab cd measurements");
    const typo = await create("abb cdd reference", "Lab notes.");
    for (const [id, date] of [
      [first, "2026-01-01T00:00:00.000Z"],
      [second, "2026-01-02T00:00:00.000Z"],
      [third, "2026-01-03T00:00:00.000Z"],
      [typo, "2026-01-04T00:00:00.000Z"],
    ]) {
      await pool.query(
        "UPDATE posts SET created_at=$2,last_activity_at=$2 WHERE id=$1",
        [id, date],
      );
    }
    const collect = async (q: string, sort: string) => {
      const found: string[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({
          q,
          sort,
          tag: "short-terms-slice",
          limit: "1",
        });
        if (cursor) params.set("cursor", cursor);
        const page = await request(app(ids.student))
          .get(`/api/v1/courses/${ids.course}/posts?${params}`)
          .set("Cookie", cookie);
        expect(page.status).toBe(200);
        found.push(...page.body.data.map((post: { id: string }) => post.id));
        cursor = page.body.page.nextCursor;
        expect(page.body.page.hasMore).toBe(Boolean(cursor));
      } while (cursor);
      return found;
    };
    for (const sort of ["relevance", "newest", "oldest", "recent_activity"]) {
      const actual = await collect("ab cd", sort);
      expect(actual).toEqual(await collect('"ab" "cd"', sort));
      expect(new Set(actual)).toEqual(new Set([first, second, third]));
      if (sort !== "relevance")
        expect(actual).toEqual(
          sort === "oldest" ? [first, second, third] : [third, second, first],
        );
    }
    expect(await collect("the ab", "relevance")).toEqual(
      await collect('"the" "ab"', "relevance"),
    );
  });
  it("keeps operator queries and short queries on the full-text-only path", async () => {
    await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
      .send({
        type: "note",
        title: "Spectromter cat",
        bodyMarkdown: "Calibration notes.",
        tags: ["operator-fuzzy-slice"],
      })
      .expect(201);
    for (const q of [
      '"spectrometer"',
      "spectrometer OR wavelength",
      "spectrometer -wavelength",
      "at",
    ]) {
      const result = await request(app(ids.student))
        .get(`/api/v1/courses/${ids.course}/posts`)
        .query({ q, tag: "operator-fuzzy-slice" })
        .set("Cookie", cookie);
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual([]);
    }
  });
  it("filters hidden fuzzy matches before paging and hasMore", async () => {
    await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
      .send({
        type: "note",
        title: "Diffractomter hidden",
        bodyMarkdown: "Instrument notes.",
        anonymous: true,
        tags: ["fuzzy-visibility-slice"],
      })
      .expect(201);
    const visible = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Diffractomter visible",
        bodyMarkdown: "Instrument notes.",
        tags: ["fuzzy-visibility-slice"],
      })
      .expect(201);
    await unsafe(
      request(app()).post(`/api/v1/courses/${ids.otherCourse}/posts`),
    )
      .send({
        type: "note",
        title: "Diffractomter elsewhere",
        bodyMarkdown: "Instrument notes.",
        tags: ["fuzzy-visibility-slice"],
      })
      .expect(201);
    const result = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({
        q: "diffractometer",
        tag: "fuzzy-visibility-slice",
        authorId: ids.author,
        limit: 1,
      })
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.data.map((post: { id: string }) => post.id)).toEqual([
      visible.body.data.id,
    ]);
    expect(result.body.page).toEqual({ nextCursor: null, hasMore: false });
  });
  it("finds question text that appears only in the body", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Where is the reading?",
        bodyMarkdown: "The thermocline diagram is in chapter five.",
      })
      .expect(201);
    const results = await request(app(ids.student))
      .get(`/api/v1/courses/${ids.course}/posts`)
      .query({ q: "thermocline", type: "question", sort: "relevance" })
      .set("Cookie", cookie);
    expect(results.status).toBe(200);
    expect(
      results.body.data.some(
        (post: { id: string }) => post.id === created.body.data.id,
      ),
    ).toBe(true);
  });
  it("matches a quoted phrase but excludes a forbidden term", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Office hours moved to Friday",
        bodyMarkdown: "Please check the schedule.",
      })
      .expect(201);
    const path = `/api/v1/courses/${ids.course}/posts`;
    const phrase = await request(app(ids.student))
      .get(path)
      .query({ q: '"office hours"', type: "question", sort: "relevance" })
      .set("Cookie", cookie);
    expect(phrase.status).toBe(200);
    expect(
      phrase.body.data.some(
        (post: { id: string }) => post.id === created.body.data.id,
      ),
    ).toBe(true);
    const excluded = await request(app(ids.student))
      .get(path)
      .query({ q: "office -friday", type: "question", sort: "relevance" })
      .set("Cookie", cookie);
    expect(excluded.status).toBe(200);
    expect(
      excluded.body.data.some(
        (post: { id: string }) => post.id === created.body.data.id,
      ),
    ).toBe(false);
  });
  it("does not expose a hidden post through mutation preconditions", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.otherCourse}/posts`),
    )
      .send({ type: "note", title: "Hidden mutation", bodyMarkdown: "Secret" })
      .expect(201);
    const path = created.headers.location;
    const patch = await unsafe(request(app(ids.student)).patch(path)).send({
      title: "Guess",
    });
    const deletion = await unsafe(request(app(ids.student)).delete(path)).set(
      "If-Match",
      '"v999"',
    );
    expect(patch.status).toBe(404);
    expect(deletion.status).toBe(404);
    expect(patch.body.error.code).toBe("not_found");
    expect(deletion.body.error.code).toBe("not_found");
  });
  it("rejects unsupported variants and unsafe requests without writing", async () => {
    const path = `/api/v1/courses/${ids.course}/posts`;
    const poll = await unsafe(request(app()).post(path)).send({
      type: "poll",
      title: "Vote",
      bodyMarkdown: "Body",
      options: [],
    });
    expect(poll.status).toBe(422);
    const multipart = await unsafe(request(app()).post(path)).field(
      "metadata",
      "{}",
    );
    expect(multipart.status).toBe(422);
    const filtered = await request(app())
      .get(`${path}?type=poll`)
      .set("Cookie", cookie);
    expect(filtered.status).toBe(200);
    const unauthenticated = await request(app()).get(path);
    expect(unauthenticated.status).toBe(401);
    const noCsrf = await request(app())
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", environment.frontendBaseUrl)
      .send({ type: "note", title: "No CSRF", bodyMarkdown: "Body" });
    expect(noCsrf.status).toBe(403);
  });
  it("paginates recent posts without repeats and rejects a cross-course cursor", async () => {
    const path = `/api/v1/courses/${ids.course}/posts?tag=recent-cursor&sort=newest&limit=1`;
    for (const title of ["First", "Second"]) {
      await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
        .send({
          type: "note",
          title,
          bodyMarkdown: "Body",
          tags: ["recent-cursor"],
        })
        .expect(201);
    }
    const first = await request(app()).get(path).set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.page.hasMore).toBe(true);
    const second = await request(app())
      .get(`${path}&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
      .set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(second.body.page.hasMore).toBe(false);
    const wrongCourse = await request(app())
      .get(
        `/api/v1/courses/${ids.otherCourse}/posts?tag=recent-cursor&sort=newest&limit=1&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
      )
      .set("Cookie", cookie);
    expect(wrongCourse.status).toBe(400);
  });
  it("rejects malformed cursor sort values before PostgreSQL casts them", async () => {
    for (const title of ["Cursor bad value one", "Cursor bad value two"]) {
      await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
        .send({
          type: "note",
          title,
          bodyMarkdown: "Bad cursor search",
          tags: ["bad-cursor"],
        })
        .expect(201);
    }
    for (const [query, badValue] of [
      ["tag=bad-cursor&sort=newest", "not-a-date"],
      ["q=cursor&tag=bad-cursor&sort=relevance", "not-a-number"],
    ]) {
      const path = `/api/v1/courses/${ids.course}/posts?${query}&limit=1`;
      const first = await request(app()).get(path).set("Cookie", cookie);
      expect(first.status).toBe(200);
      expect(first.body.page.nextCursor).toBeTypeOf("string");
      const cursor = JSON.parse(
        Buffer.from(first.body.page.nextCursor, "base64url").toString("utf8"),
      );
      cursor.value = badValue;
      const tampered = Buffer.from(JSON.stringify(cursor)).toString(
        "base64url",
      );
      const response = await request(app())
        .get(`${path}&cursor=${encodeURIComponent(tampered)}`)
        .set("Cookie", cookie);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("invalid_request");
    }
  });
  it("rejects missing and non-boolean pinned cursor values", async () => {
    for (const title of ["Pinned cursor one", "Pinned cursor two"]) {
      await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
        .send({
          type: "note",
          title,
          bodyMarkdown: "Cursor body",
          tags: ["pinned-cursor"],
        })
        .expect(201);
    }
    const path = `/api/v1/courses/${ids.course}/posts?tag=pinned-cursor&sort=newest&limit=1`;
    const first = await request(app()).get(path).set("Cookie", cookie);
    expect(first.status).toBe(200);
    const cursor = JSON.parse(
      Buffer.from(first.body.page.nextCursor, "base64url").toString("utf8"),
    );
    expect(cursor.pinned).toBeTypeOf("boolean");
    for (const badPinned of [undefined, null, "true", 1]) {
      const tampered = { ...cursor, pinned: badPinned };
      const encoded = Buffer.from(JSON.stringify(tampered)).toString(
        "base64url",
      );
      const response = await request(app())
        .get(`${path}&cursor=${encodeURIComponent(encoded)}`)
        .set("Cookie", cookie);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("invalid_request");
    }
  });
  it("reorders All posts after staff pin and unpin across every sort", async () => {
    const courseId = uuidv7();
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Pin ordering','PINORDER')",
      [courseId, ids.organization, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'ta')",
      [courseId, ids.author, ids.staff],
    );
    const older = await unsafe(
      request(app()).post(`/api/v1/courses/${courseId}/posts`),
    )
      .send({
        type: "note",
        title: "Toggle older",
        bodyMarkdown: "toggle",
      })
      .expect(201);
    const newer = await unsafe(
      request(app()).post(`/api/v1/courses/${courseId}/posts`),
    )
      .send({
        type: "note",
        title: "Toggle newer",
        bodyMarkdown: "toggle toggle toggle",
      })
      .expect(201);
    for (const [id, date] of [
      [older.body.data.id, "2026-01-01T00:00:00.000Z"],
      [newer.body.data.id, "2026-01-02T00:00:00.000Z"],
    ]) {
      await pool.query(
        "UPDATE posts SET created_at=$2,last_activity_at=$2 WHERE id=$1",
        [id, date],
      );
    }
    const sorts = ["oldest", "newest", "recent_activity", "relevance"] as const;
    const listToggle = async (
      sort: (typeof sorts)[number],
      cursor?: string,
    ) => {
      const params = new URLSearchParams({ sort, limit: "1" });
      if (sort === "relevance") params.set("q", "toggle");
      if (cursor) params.set("cursor", cursor);
      return request(app())
        .get(`/api/v1/courses/${courseId}/posts?${params}`)
        .set("Cookie", cookie);
    };
    const titleOrder = async (sort: (typeof sorts)[number]) => {
      const first = await listToggle(sort);
      expect(first.status).toBe(200);
      const second = await listToggle(sort, first.body.page.nextCursor);
      expect(second.status).toBe(200);
      expect(second.body.page.nextCursor).toBeNull();
      const posts = [...first.body.data, ...second.body.data];
      expect(new Set(posts.map((post: { id: string }) => post.id)).size).toBe(
        2,
      );
      return posts.map((post: { title: string }) => post.title);
    };
    for (const sort of sorts) {
      expect(await titleOrder(sort)).toEqual(
        sort === "oldest"
          ? ["Toggle older", "Toggle newer"]
          : ["Toggle newer", "Toggle older"],
      );
    }
    const pinned = await unsafe(
      request(app(ids.staff)).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", older.headers.etag)
      .send({ pinned: true })
      .expect(200);
    for (const sort of sorts)
      expect(await titleOrder(sort)).toEqual(["Toggle older", "Toggle newer"]);
    await unsafe(
      request(app(ids.staff)).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", pinned.headers.etag)
      .send({ pinned: false })
      .expect(200);
    for (const sort of sorts) {
      expect(await titleOrder(sort)).toEqual(
        sort === "oldest" || sort === "recent_activity"
          ? ["Toggle older", "Toggle newer"]
          : ["Toggle newer", "Toggle older"],
      );
    }
  });
  it("keeps idempotent concurrent retries to one post and allows an expired key to be reused", async () => {
    const path = `/api/v1/courses/${ids.course}/posts`;
    const body = { type: "note", title: "Concurrent", bodyMarkdown: "Body" };
    const [first, second] = await Promise.all([
      unsafe(request(app()).post(path))
        .set("Idempotency-Key", "concurrent-post")
        .send(body),
      unsafe(request(app()).post(path))
        .set("Idempotency-Key", "concurrent-post")
        .send(body),
    ]);
    expect(first.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    await pool.query(
      "UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE key='concurrent-post'",
    );
    const later = await unsafe(request(app()).post(path))
      .set("Idempotency-Key", "concurrent-post")
      .send(body);
    expect(later.status).toBe(201);
    expect(later.body.data.id).not.toBe(first.body.data.id);
  });
  it("allows staff pinning and confirmation, but rejects cross-course and self duplicate targets", async () => {
    const source = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Review source", bodyMarkdown: "Body" })
      .expect(201);
    const target = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Review target", bodyMarkdown: "Body" })
      .expect(201);
    const other = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.otherCourse}/posts`),
    )
      .send({
        type: "note",
        title: "Other course target",
        bodyMarkdown: "Body",
      })
      .expect(201);
    const path = source.headers.location;
    for (const duplicateOfPostId of [source.body.data.id, other.body.data.id]) {
      const invalid = await unsafe(request(app(ids.student)).patch(path))
        .set("If-Match", source.headers.etag)
        .send({ duplicateOfPostId, duplicateStatus: "suggested" });
      expect(invalid.status).toBe(422);
    }
    const studentPin = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", source.headers.etag)
      .send({ pinned: true });
    expect(studentPin.status).toBe(403);
    const staff = await unsafe(request(app(ids.staff)).patch(path))
      .set("If-Match", source.headers.etag)
      .send({
        pinned: true,
        duplicateOfPostId: target.body.data.id,
        duplicateStatus: "confirmed",
      });
    expect(staff.status).toBe(200);
    expect(staff.body.data).toEqual({
      id: source.body.data.id,
      courseId: ids.course,
      duplicateOfPostId: target.body.data.id,
      duplicateStatus: "confirmed",
      version: 2,
    });
    const cleared = await unsafe(request(app(ids.staff)).patch(path))
      .set("If-Match", staff.headers.etag)
      .send({ duplicateOfPostId: null, duplicateStatus: "none" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({
      pinned: true,
      duplicateOfPostId: null,
      duplicateStatus: "none",
    });
  });
  it("queues exactly one author email for a confirmed question, not for suggestions, notes, failed edits, or unmerge", async () => {
    const canonical = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "question", title: "Canonical", bodyMarkdown: "Body" })
      .expect(201);
    const question = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Why does this happen?",
        bodyMarkdown: "Body",
      })
      .expect(201);
    const suggestion = await unsafe(
      request(app(ids.student)).patch(question.headers.location),
    )
      .set("If-Match", question.headers.etag)
      .send({
        duplicateStatus: "suggested",
        duplicateOfPostId: canonical.body.data.id,
      })
      .expect(200);
    const none = () =>
      pool.query(
        "SELECT * FROM jobs WHERE kind='send_question_duplicate_email' AND payload->>'sourcePostId'=$1",
        [question.body.data.id],
      );
    expect((await none()).rowCount).toBe(0);
    const merged = await unsafe(
      request(app(ids.staff)).patch(question.headers.location),
    )
      .set("If-Match", suggestion.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: canonical.body.data.id,
      })
      .expect(200);
    expect(merged.body.data).toEqual({
      id: question.body.data.id,
      courseId: ids.course,
      duplicateOfPostId: canonical.body.data.id,
      duplicateStatus: "confirmed",
      version: 3,
    });
    expect(merged.headers.etag).toBe('"v3"');
    const jobs = await none();
    expect(jobs.rowCount).toBe(1);
    expect(jobs.rows[0].payload).toEqual({
      sourcePostId: question.body.data.id,
      canonicalPostId: canonical.body.data.id,
      staffUserId: ids.staff,
      staffRole: "ta",
    });
    expect(jobs.rows[0].deduplication_key).toBe(`${question.body.data.id}:3`);
    await unsafe(request(app(ids.staff)).patch(question.headers.location))
      .set("If-Match", suggestion.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: canonical.body.data.id,
      })
      .expect(412);
    expect((await none()).rowCount).toBe(1);
    await unsafe(request(app(ids.staff)).patch(question.headers.location))
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null })
      .expect(200);
    expect((await none()).rowCount).toBe(1);
    const note = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Note", bodyMarkdown: "Body" })
      .expect(201);
    await unsafe(request(app(ids.staff)).patch(note.headers.location))
      .set("If-Match", note.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: canonical.body.data.id,
      })
      .expect(200);
    expect(
      (
        await pool.query(
          "SELECT * FROM jobs WHERE kind='send_question_duplicate_email' AND payload->>'sourcePostId'=$1",
          [note.body.data.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("hides confirmed duplicates from members and redirects old links to canonical posts", async () => {
    const source = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Merging source",
        bodyMarkdown: "Private retained body",
      })
      .expect(201);
    const target = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Canonical target",
        bodyMarkdown: "Canonical body",
      })
      .expect(201);
    await unsafe(request(app(ids.staff)).patch(source.headers.location))
      .set("If-Match", source.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: target.body.data.id,
      })
      .expect(200);
    for (const suffix of ["", "?q=Merging", "?duplicateStatus=confirmed"]) {
      const listed = await request(app(ids.student))
        .get(`/api/v1/courses/${ids.course}/posts${suffix}`)
        .set("Cookie", cookie);
      if (suffix.includes("confirmed")) expect(listed.status).toBe(403);
      else
        expect(
          listed.body.data.map((item: { id: string }) => item.id),
        ).not.toContain(source.body.data.id);
    }
    const redirected = await request(app(ids.student))
      .get(source.headers.location)
      .set("Cookie", cookie);
    expect(redirected.status).toBe(303);
    expect(redirected.headers.location).toBe(target.headers.location);
    expect(redirected.headers["cache-control"]).toContain("no-store");
    expect(redirected.text).not.toContain("Private retained body");
    const review = await request(app(ids.staff))
      .get(`/api/v1/courses/${ids.course}/posts?duplicateStatus=confirmed`)
      .set("Cookie", cookie);
    expect(review.status).toBe(200);
    expect(review.body.data).toContainEqual(
      expect.objectContaining({
        id: source.body.data.id,
        title: "Merging source",
        duplicateOfPostId: target.body.data.id,
        canonicalTitle: "Canonical target",
      }),
    );
    expect(JSON.stringify(review.body.data)).not.toContain(
      "Private retained body",
    );
    const inaccessible = await request(app(ids.outsider))
      .get(source.headers.location)
      .set("Cookie", cookie);
    expect(inaccessible.status).toBe(404);
  });
  it("returns retained duplicate detail only to course staff", async () => {
    const source = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Private duplicate review",
        bodyMarkdown: "Retained **staff review** body",
        anonymous: true,
        tags: ["review-tag"],
      })
      .expect(201);
    const target = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "question",
        title: "Review target",
        bodyMarkdown: "Target",
      })
      .expect(201);
    const reviewUrl = `${source.headers.location}/duplicate-review`;
    const beforeMerge = await request(app(ids.staff))
      .get(reviewUrl)
      .set("Cookie", cookie);
    expect(beforeMerge.status).toBe(404);
    const merged = await unsafe(
      request(app(ids.staff)).patch(source.headers.location),
    )
      .set("If-Match", source.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: target.body.data.id,
      })
      .expect(200);
    for (const staffId of [ids.staff, ids.instructor]) {
      const review = await request(app(staffId))
        .get(reviewUrl)
        .set("Cookie", cookie);
      expect(review.status).toBe(200);
      expect(review.headers.etag).toBe(merged.headers.etag);
      expect(review.headers["cache-control"]).toBe("private, no-store");
      expect(review.body.data).toMatchObject({
        id: source.body.data.id,
        title: "Private duplicate review",
        bodyMarkdown: "Retained **staff review** body",
        tags: ["review-tag"],
        author: { userId: ids.author, displayName: "Author", anonymous: true },
        duplicateStatus: "confirmed",
        duplicateOfPostId: target.body.data.id,
        version: merged.body.data.version,
      });
    }
    const student = await request(app(ids.student))
      .get(reviewUrl)
      .set("Cookie", cookie);
    expect(student.status).toBe(403);
    expect(JSON.stringify(student.body)).not.toContain("staff review");
    const outsider = await request(app(ids.outsider))
      .get(reviewUrl)
      .set("Cookie", cookie);
    expect(outsider.status).toBe(404);
    const absent = await request(app(ids.staff))
      .get(
        "/api/v1/posts/01a0e5cc-58ae-7009-9f43-edde38b21440/duplicate-review",
      )
      .set("Cookie", cookie);
    expect(absent.status).toBe(404);
    const unauthenticated = await request(app(ids.staff)).get(reviewUrl);
    expect(unauthenticated.status).toBe(401);
    const unmerged = await unsafe(
      request(app(ids.staff)).patch(source.headers.location),
    )
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null })
      .expect(200);
    const afterUnmerge = await request(app(ids.staff))
      .get(reviewUrl)
      .set("Cookie", cookie);
    expect(afterUnmerge.status).toBe(404);
    await unsafe(request(app()).delete(source.headers.location))
      .set("If-Match", unmerged.headers.etag)
      .expect(204);
    const afterDelete = await request(app(ids.staff))
      .get(reviewUrl)
      .set("Cookie", cookie);
    expect(afterDelete.status).toBe(404);
  });
  it("preserves canonical references until staff unmerge, then restores the retained source", async () => {
    const source = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Retained source",
        bodyMarkdown: "Retained source body",
      })
      .expect(201);
    const target = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Protected canonical",
        bodyMarkdown: "Target body",
      })
      .expect(201);
    const merged = await unsafe(
      request(app(ids.instructor)).patch(source.headers.location),
    )
      .set("If-Match", source.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: target.body.data.id,
      })
      .expect(200);
    const blockedDelete = await unsafe(
      request(app()).delete(target.headers.location),
    ).set("If-Match", target.headers.etag);
    expect(blockedDelete.status).toBe(409);
    expect(blockedDelete.body.error.code).toBe("canonical_has_duplicates");
    const blockedMerge = await unsafe(
      request(app(ids.staff)).patch(target.headers.location),
    )
      .set("If-Match", target.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: source.body.data.id,
      });
    expect(blockedMerge.status).toBe(409);
    const blockedEdit = await unsafe(
      request(app(ids.staff)).patch(source.headers.location),
    )
      .set("If-Match", merged.headers.etag)
      .send({ bodyMarkdown: "Changed" });
    expect(blockedEdit.status).toBe(409);
    const unmergeDenied = await unsafe(
      request(app(ids.student)).patch(source.headers.location),
    )
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null });
    expect(unmergeDenied.status).toBe(403);
    await unsafe(request(app(ids.staff)).patch(source.headers.location))
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null })
      .expect(200);
    const restored = await request(app(ids.student))
      .get(source.headers.location)
      .set("Cookie", cookie);
    expect(restored.status).toBe(200);
    expect(restored.body.data.bodyMarkdown).toBe("Retained source body");
    await unsafe(request(app()).delete(target.headers.location))
      .set("If-Match", target.headers.etag)
      .expect(204);
  });
  it("returns a deleted-author identity projection without the original account name", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({
        type: "note",
        title: "Past author",
        bodyMarkdown: "Retained content",
        anonymous: true,
      })
      .expect(201);
    await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
      .send({
        type: "note",
        title: "Named past author",
        bodyMarkdown: "Retained content",
        tags: ["deleted-author-filter"],
      })
      .expect(201);
    await pool.query(
      "UPDATE users SET deleted_at=now(),display_name='Deleted user' WHERE id=$1",
      [ids.author],
    );
    const response = await request(app(ids.student))
      .get(created.headers.location)
      .set("Cookie", cookie);
    expect(response.body.data.author).toEqual({
      userId: null,
      displayName: "Deleted user",
      anonymous: true,
      deleted: true,
    });
    const filterPath = `/api/v1/courses/${ids.course}/posts?authorId=${ids.author}&tag=deleted-author-filter&limit=1`;
    const studentMatches = await request(app(ids.student))
      .get(filterPath)
      .set("Cookie", cookie);
    expect(studentMatches.status).toBe(200);
    expect(studentMatches.body).toEqual({
      data: [],
      page: { nextCursor: null, hasMore: false },
    });
    const staffMatches = await request(app(ids.staff))
      .get(filterPath)
      .set("Cookie", cookie);
    expect(staffMatches.status).toBe(200);
    expect(staffMatches.body.data).toHaveLength(1);
    expect(staffMatches.body.data[0].author).toEqual({
      userId: null,
      displayName: "Deleted user",
      anonymous: false,
      deleted: true,
    });
    await pool.query(
      "UPDATE users SET deleted_at=NULL,display_name='Author' WHERE id=$1",
      [ids.author],
    );
  });
  it("rejects writes to archived courses and missing preconditions for accessible posts", async () => {
    const created = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .send({ type: "note", title: "Archived", bodyMarkdown: "Body" })
      .expect(201);
    const missing = await unsafe(
      request(app()).patch(created.headers.location),
    ).send({ title: "Updated" });
    expect(missing.status).toBe(428);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    const createDenied = await unsafe(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Denied", bodyMarkdown: "Body" });
    expect(createDenied.status).toBe(409);
    const patchDenied = await unsafe(
      request(app()).patch(created.headers.location),
    )
      .set("If-Match", created.headers.etag)
      .send({ title: "Denied" });
    expect(patchDenied.status).toBe(409);
    const read = await request(app(ids.student))
      .get(created.headers.location)
      .set("Cookie", cookie);
    expect(read.status).toBe(200);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
  });

  describe("tag matching", () => {
    const list = (query: string) =>
      request(app(ids.student))
        .get(`/api/v1/courses/${ids.course}/posts?sort=oldest&${query}`)
        .set("Cookie", cookie);
    const titles = (response: request.Response) =>
      response.body.data.map((item: { title: string }) => item.title);
    beforeAll(async () => {
      const posts: [string, string[]][] = [
        ["Recursion only", ["tm-recursion"]],
        ["Exam only", ["tm-exam"]],
        ["Both tags", ["tm-recursion", "tm-exam"]],
        ["Neither tag", ["tm-other"]],
      ];
      for (const [title, tags] of posts)
        await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
          .send({ type: "note", title, bodyMarkdown: "Body", tags })
          .expect(201);
    });

    it("matches any requested tag by default and with tagMatch=any", async () => {
      for (const query of [
        "tag=tm-recursion&tag=tm-exam",
        "tag=tm-recursion&tag=tm-exam&tagMatch=any",
      ]) {
        const response = await list(query);
        expect(response.status).toBe(200);
        expect(titles(response)).toEqual([
          "Recursion only",
          "Exam only",
          "Both tags",
        ]);
      }
    });

    it("matches every requested tag with tagMatch=all", async () => {
      expect(
        titles(await list("tag=tm-recursion&tag=tm-exam&tagMatch=all")),
      ).toEqual(["Both tags"]);
      expect(
        titles(
          await list(
            "tag=TM-Recursion&tag=tm-exam&tag=%20tm-exam&tagMatch=all",
          ),
        ),
      ).toEqual(["Both tags"]);
    });

    it("returns the same results for one tag under either match", async () => {
      for (const match of ["any", "all"])
        expect(
          titles(await list(`tag=tm-recursion&tagMatch=${match}`)),
        ).toEqual(["Recursion only", "Both tags"]);
    });

    it("pages through all-tag matches and binds the cursor to the match", async () => {
      await unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
        .send({
          type: "note",
          title: "Both tags again",
          bodyMarkdown: "Body",
          tags: ["tm-exam", "tm-recursion"],
        })
        .expect(201);
      const path = "tag=tm-recursion&tag=tm-exam&tagMatch=all&limit=1";
      const first = await list(path);
      expect(first.status).toBe(200);
      expect(titles(first)).toEqual(["Both tags"]);
      expect(first.body.page.hasMore).toBe(true);
      const cursor = encodeURIComponent(first.body.page.nextCursor);
      const second = await list(`${path}&cursor=${cursor}`);
      expect(second.status).toBe(200);
      expect(titles(second)).toEqual(["Both tags again"]);
      expect(second.body.page.hasMore).toBe(false);
      const otherMatch = await list(
        `tag=tm-recursion&tag=tm-exam&tagMatch=any&limit=1&cursor=${cursor}`,
      );
      expect(otherMatch.status).toBe(400);
      expect(otherMatch.body.error.code).toBe("invalid_request");
      const single = await list("tag=tm-exam&tagMatch=all&limit=1");
      const singleCursor = encodeURIComponent(single.body.page.nextCursor);
      const singleAny = await list(
        `tag=tm-exam&limit=1&cursor=${singleCursor}`,
      );
      expect(singleAny.status).toBe(200);
    });

    it("rejects an unsupported tag match and more than ten tags", async () => {
      const tags = (count: number) =>
        Array.from({ length: count }, (_, index) => `tag=limit-${index}`).join(
          "&",
        );
      expect((await list(tags(10))).status).toBe(200);
      for (const query of [
        "tag=tm-exam&tagMatch=both",
        "tagMatch=",
        tags(11),
      ]) {
        const invalid = await list(query);
        expect(invalid.status).toBe(400);
        expect(invalid.body.error.code).toBe("invalid_request");
      }
    });
  });
  describe("sort and filter options", () => {
    const listCourse = "01a0e5cc-58ae-7009-9f43-f1ba75831a01";
    const leaver = "01a0e5cc-58ae-7009-9f43-f1ba75831a02";
    const seeded: Record<string, string> = {};
    const list = (userId: string, query: string) =>
      request(app(userId))
        .get(`/api/v1/courses/${listCourse}/posts?limit=100&${query}`)
        .set("Cookie", cookie);
    const titles = (response: request.Response) =>
      response.body.data.map((item: { title: string }) => item.title);
    beforeAll(async () => {
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Filters','FILTERS1')",
        [listCourse, ids.organization, ids.instructor],
      );
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'leaver@example.edu','Leaver','x')",
        [leaver, ids.organization],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor'),($1,$3,'ta'),($1,$4,'student'),($1,$5,'student'),($1,$6,'ta')",
        [
          listCourse,
          ids.instructor,
          ids.staff,
          ids.author,
          ids.student,
          leaver,
        ],
      );
      const rows: [string, string, string, boolean, boolean, string][] = [
        ["Instructor note", ids.instructor, "note", false, true, "2026-01-01"],
        ["TA question", ids.staff, "question", false, true, "2026-01-02"],
        [
          "Anonymous instructor",
          ids.instructor,
          "question",
          true,
          false,
          "2026-01-03",
        ],
        [
          "Student question",
          ids.author,
          "question",
          false,
          false,
          "2026-01-04",
        ],
        ["Leaver question", leaver, "question", false, false, "2026-01-05"],
        ["Pinned student note", ids.author, "note", false, false, "2026-01-06"],
      ];
      for (const [title, author, type, anonymous, pinned, created] of rows) {
        const id = uuidv7();
        seeded[title] = id;
        await pool.query(
          "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,anonymous,pinned,created_at,last_activity_at) VALUES ($1,$2,$3,$4,$5,'Body about filters',$6,$7,$8,$8)",
          [
            id,
            listCourse,
            author,
            type,
            title,
            anonymous,
            pinned || title === "Pinned student note",
            created,
          ],
        );
      }
      // Account deletion removes memberships and anonymizes the account.
      await pool.query("DELETE FROM course_memberships WHERE user_id=$1", [
        leaver,
      ]);
      await pool.query(
        "UPDATE users SET deleted_at=now(),display_name='Deleted user' WHERE id=$1",
        [leaver],
      );
    });

    it("sorts oldest first and pages through every post exactly once", async () => {
      const all = await list(ids.author, "sort=oldest");
      expect(all.status).toBe(200);
      expect(titles(all)).toEqual([
        "Instructor note",
        "TA question",
        "Pinned student note",
        "Anonymous instructor",
        "Student question",
        "Leaver question",
      ]);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const pageResponse = await request(app(ids.author))
          .get(
            `/api/v1/courses/${listCourse}/posts?sort=oldest&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
          .set("Cookie", cookie);
        expect(pageResponse.status).toBe(200);
        seen.push(...titles(pageResponse));
        cursor = pageResponse.body.page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(titles(all));
      const searched = await list(ids.author, "q=filters&sort=oldest");
      expect(searched.status).toBe(200);
      expect(titles(searched)[0]).toBe("Instructor note");
      const newest = await request(app(ids.author))
        .get(`/api/v1/courses/${listCourse}/posts?sort=newest&limit=1`)
        .set("Cookie", cookie);
      const replayed = await request(app(ids.author))
        .get(
          `/api/v1/courses/${listCourse}/posts?sort=oldest&limit=1&cursor=${encodeURIComponent(newest.body.page.nextCursor)}`,
        )
        .set("Cookie", cookie);
      expect(replayed.status).toBe(400);
    });

    it("orders pinned posts first for every sort and pages across the pin boundary", async () => {
      const orders = [
        [
          "oldest",
          [
            "Instructor note",
            "TA question",
            "Pinned student note",
            "Anonymous instructor",
            "Student question",
            "Leaver question",
          ],
        ],
        [
          "newest",
          [
            "Pinned student note",
            "TA question",
            "Instructor note",
            "Leaver question",
            "Student question",
            "Anonymous instructor",
          ],
        ],
        [
          "recent_activity",
          [
            "Pinned student note",
            "TA question",
            "Instructor note",
            "Leaver question",
            "Student question",
            "Anonymous instructor",
          ],
        ],
      ] as const;
      for (const [sort, expected] of orders) {
        const full = await list(ids.author, `sort=${sort}`);
        expect(full.status).toBe(200);
        expect(titles(full)).toEqual(expected);
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const pageResponse = await request(app(ids.author))
            .get(
              `/api/v1/courses/${listCourse}/posts?sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            )
            .set("Cookie", cookie);
          expect(pageResponse.status).toBe(200);
          seen.push(...titles(pageResponse));
          cursor = pageResponse.body.page.nextCursor;
        } while (cursor);
        expect(seen).toEqual(expected);
        expect(new Set(seen).size).toBe(expected.length);
      }
      const relevant = await list(ids.author, "q=filters&sort=relevance");
      expect(relevant.status).toBe(200);
      const pinTitles = [
        "Instructor note",
        "TA question",
        "Pinned student note",
      ];
      const otherTitles = [
        "Anonymous instructor",
        "Student question",
        "Leaver question",
      ];
      const byId = (a: string, b: string) =>
        seeded[b]!.localeCompare(seeded[a]!);
      const expectedRelevance = [
        ...pinTitles.sort(byId),
        ...otherTitles.sort(byId),
      ];
      expect(titles(relevant)).toEqual(expectedRelevance);
      const relevantSeen: string[] = [];
      let cursor: string | null = null;
      do {
        const pageResponse = await request(app(ids.author))
          .get(
            `/api/v1/courses/${listCourse}/posts?q=filters&sort=relevance&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
          .set("Cookie", cookie);
        expect(pageResponse.status).toBe(200);
        relevantSeen.push(...titles(pageResponse));
        cursor = pageResponse.body.page.nextCursor;
      } while (cursor);
      expect(relevantSeen).toEqual(expectedRelevance);
      expect(new Set(relevantSeen).size).toBe(expectedRelevance.length);
    });

    it("filters by pinned state alone and with a type", async () => {
      expect(titles(await list(ids.author, "pinned=true&sort=oldest"))).toEqual(
        ["Instructor note", "TA question", "Pinned student note"],
      );
      expect(
        titles(await list(ids.author, "pinned=true&type=note&sort=oldest")),
      ).toEqual(["Instructor note", "Pinned student note"]);
      expect(
        titles(await list(ids.author, "pinned=true&type=question")),
      ).toEqual(["TA question"]);
      expect(
        titles(await list(ids.author, "pinned=false&sort=oldest")),
      ).toEqual([
        "Anonymous instructor",
        "Student question",
        "Leaver question",
      ]);
      const invalid = await list(ids.author, "pinned=yes");
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe("invalid_request");
    });

    it("filters by instructor and TA roles without revealing anonymous authors to students", async () => {
      expect(
        titles(await list(ids.author, "authorRole=instructor&sort=oldest")),
      ).toEqual(["Instructor note"]);
      expect(
        titles(await list(ids.staff, "authorRole=instructor&sort=oldest")),
      ).toEqual(["Instructor note", "Anonymous instructor"]);
      expect(
        titles(await list(ids.instructor, "authorRole=instructor&sort=oldest")),
      ).toEqual(["Instructor note", "Anonymous instructor"]);
      expect(titles(await list(ids.author, "authorRole=ta"))).toEqual([
        "TA question",
      ]);
      for (const value of ["staff", "student", ""]) {
        const invalid = await list(ids.author, `authorRole=${value}`);
        expect(invalid.status).toBe(400);
        expect(invalid.body.error.code).toBe("invalid_request");
      }
    });

    it("matches only an author's current role", async () => {
      await pool.query(
        "UPDATE course_memberships SET role='instructor' WHERE course_id=$1 AND user_id=$2",
        [listCourse, ids.staff],
      );
      try {
        expect(titles(await list(ids.author, "authorRole=ta"))).toEqual([]);
        expect(
          titles(await list(ids.author, "authorRole=instructor&sort=oldest")),
        ).toEqual(["Instructor note", "TA question"]);
      } finally {
        await pool.query(
          "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
          [listCourse, ids.staff],
        );
      }
    });
  });

  describe("polls and announcements", () => {
    const path = `/api/v1/courses/${ids.course}/posts`;
    const poll = (userId: string, body: Record<string, unknown> = {}) =>
      unsafe(request(app(userId)).post(path)).send({
        type: "poll",
        title: "Review session time?",
        bodyMarkdown: "Pick one.",
        options: [
          { label: "Monday" },
          { label: " Tuesday " },
          { label: "Friday" },
        ],
        ...body,
      });
    const vote = (userId: string, postId: string, optionId: unknown) =>
      unsafe(request(app(userId)).put(`/api/v1/posts/${postId}/vote`)).send({
        optionId,
      });
    const read = (userId: string, postId: string) =>
      request(app(userId)).get(`/api/v1/posts/${postId}`).set("Cookie", cookie);

    it("enforces poll and announcement rules in the schema", async () => {
      const insert = (type: string, extra = "", values: unknown[] = []) =>
        pool.query(
          `INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown${extra ? "," + extra : ""}) VALUES (gen_random_uuid(),$1,$2,$3,'T','B'${values.map((_, i) => ",$" + (i + 4)).join("")}) RETURNING id`,
          [ids.course, ids.staff, type, ...values],
        );
      await expect(insert("survey")).rejects.toMatchObject({ code: "23514" });
      await expect(
        insert("question", "announcement", [true]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        insert("note", "announcement,anonymous", [true, true]),
      ).rejects.toMatchObject({ code: "23514" });
      const first = (await insert("poll")).rows[0]!.id as string;
      const second = (await insert("poll")).rows[0]!.id as string;
      const option = (
        await pool.query<{ id: string }>(
          "INSERT INTO poll_options (id,course_id,post_id,position,label) VALUES (gen_random_uuid(),$1,$2,0,'A') RETURNING id",
          [ids.course, second],
        )
      ).rows[0]!.id;
      await expect(
        pool.query(
          "INSERT INTO poll_votes (course_id,post_id,user_id,option_id) VALUES ($1,$2,$3,$4)",
          [ids.course, first, ids.student, option],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await pool.query(
        "INSERT INTO poll_votes (course_id,post_id,user_id,option_id) VALUES ($1,$2,$3,$4)",
        [ids.course, second, ids.student, option],
      );
      await pool.query("DELETE FROM posts WHERE id=$1", [second]);
      const left = await pool.query(
        "SELECT (SELECT count(*) FROM poll_options WHERE post_id=$1)::int+(SELECT count(*) FROM poll_votes WHERE post_id=$1)::int AS count",
        [second],
      );
      expect(left.rows[0].count).toBe(0);
    });

    it("lets staff create polls and rejects students and invalid options", async () => {
      const created = await poll(ids.staff);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        type: "poll",
        announcement: false,
        totalVotes: 0,
        options: [
          { label: "Monday", voteCount: 0, selected: false },
          { label: "Tuesday", voteCount: 0, selected: false },
          { label: "Friday", voteCount: 0, selected: false },
        ],
      });
      expect(created.body.data).not.toHaveProperty("answered");

      const student = await poll(ids.student);
      expect(student.status).toBe(403);
      expect(student.body.error.code).toBe("permission_denied");
      for (const options of [
        [{ label: "Only" }],
        Array.from({ length: 11 }, (_, i) => ({ label: `O${i}` })),
        [{ label: "Same" }, { label: "same" }],
        [{ label: "  " }, { label: "B" }],
        [{ label: "x".repeat(201) }, { label: "B" }],
        [{ label: "A", extra: 1 }, { label: "B" }],
        undefined,
      ]) {
        const response = await poll(ids.staff, { options });
        expect(response.status).toBe(422);
      }
      const noteWithOptions = await unsafe(
        request(app(ids.staff)).post(path),
      ).send({
        type: "note",
        title: "N",
        bodyMarkdown: "B",
        options: [{ label: "A" }, { label: "B" }],
      });
      expect(noteWithOptions.status).toBe(422);
      const count = await pool.query(
        "SELECT count(*)::int AS count FROM posts WHERE author_user_id=$1 AND type='poll'",
        [ids.student],
      );
      expect(count.rows[0].count).toBe(0);
    });

    it("lists polls with their state and keeps options fixed", async () => {
      const created = (await poll(ids.instructor, { title: "Fixed options" }))
        .body.data;
      const listed = await request(app(ids.student))
        .get(`${path}?type=poll`)
        .set("Cookie", cookie);
      expect(listed.status).toBe(200);
      expect(
        listed.body.data.every(
          (item: { type: string }) => item.type === "poll",
        ),
      ).toBe(true);
      expect(
        listed.body.data.find((item: { id: string }) => item.id === created.id),
      ).toMatchObject({ totalVotes: 0, options: expect.any(Array) });
      const patched = await unsafe(
        request(app(ids.instructor)).patch(`/api/v1/posts/${created.id}`),
      )
        .set("If-Match", '"v1"')
        .send({ options: [{ label: "X" }, { label: "Y" }] });
      expect(patched.status).toBe(422);
    });

    it("records one vote per member, changes it, retracts it, and reports counts", async () => {
      const created = (await poll(ids.staff, { title: "Votes" })).body.data;
      const [monday, tuesday] = created.options as { id: string }[];
      const first = await vote(ids.student, created.id, monday!.id);
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({
        postId: created.id,
        totalVotes: 1,
        options: [
          { id: monday!.id, voteCount: 1, selected: true },
          { voteCount: 0, selected: false },
          { voteCount: 0, selected: false },
        ],
      });
      await vote(ids.author, created.id, monday!.id);
      const changed = await vote(ids.student, created.id, tuesday!.id);
      expect(changed.body.data.totalVotes).toBe(2);
      expect(changed.body.data.options[0]).toMatchObject({
        voteCount: 1,
        selected: false,
      });
      expect(changed.body.data.options[1]).toMatchObject({
        voteCount: 1,
        selected: true,
      });
      // Another member sees counts and only their own choice.
      const seen = await read(ids.author, created.id);
      expect(seen.body.data.options[0]).toMatchObject({
        voteCount: 1,
        selected: true,
      });
      expect(seen.body.data.options[1]).toMatchObject({
        voteCount: 1,
        selected: false,
      });
      expect(seen.body.data.version).toBe(1);

      const retracted = await unsafe(
        request(app(ids.student)).delete(`/api/v1/posts/${created.id}/vote`),
      );
      expect(retracted.status).toBe(204);
      const again = await unsafe(
        request(app(ids.student)).delete(`/api/v1/posts/${created.id}/vote`),
      );
      expect(again.status).toBe(204);
      expect((await read(ids.staff, created.id)).body.data.totalVotes).toBe(1);
    });

    it("rejects invalid votes", async () => {
      const created = (await poll(ids.staff, { title: "Errors" })).body.data;
      const other = (await poll(ids.staff, { title: "Other" })).body.data;
      const note = await unsafe(request(app(ids.student)).post(path)).send({
        type: "note",
        title: "A note",
        bodyMarkdown: "Body",
      });
      const wrongOption = await vote(
        ids.student,
        created.id,
        other.options[0].id,
      );
      expect(wrongOption.status).toBe(422);
      expect(wrongOption.body.error.code).toBe("poll_option_invalid");
      const notPoll = await vote(
        ids.student,
        note.body.data.id,
        created.options[0].id,
      );
      expect(notPoll.status).toBe(422);
      expect(notPoll.body.error.code).toBe("not_a_poll");
      expect(
        (await vote(ids.outsider, created.id, created.options[0].id)).status,
      ).toBe(404);
      expect(
        (
          await vote(
            ids.student,
            "01a0e5cc-58ae-7009-9f43-000000000000",
            created.options[0].id,
          )
        ).status,
      ).toBe(404);
      const noCsrf = await request(app(ids.student))
        .put(`/api/v1/posts/${created.id}/vote`)
        .set("Cookie", cookie)
        .set("Origin", environment.frontendBaseUrl)
        .send({ optionId: created.options[0].id });
      expect(noCsrf.status).toBe(403);

      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        ids.course,
      ]);
      try {
        const closed = await vote(
          ids.student,
          created.id,
          created.options[0].id,
        );
        expect(closed.status).toBe(409);
        expect(closed.body.error.code).toBe("poll_closed");
      } finally {
        await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
          ids.course,
        ]);
      }
      expect((await read(ids.staff, created.id)).body.data.totalVotes).toBe(0);
    });

    it("lets staff post pinned announcements and queues one email per other member", async () => {
      const announce = (userId: string, body: Record<string, unknown> = {}) =>
        unsafe(request(app(userId)).post(path)).send({
          type: "note",
          title: "Office hours moved",
          bodyMarkdown: "Thursday instead.",
          announcement: true,
          ...body,
        });
      const created = await announce(ids.instructor);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        type: "note",
        announcement: true,
        pinned: true,
        anonymous: false,
      });
      const jobs = await pool.query<{
        payload: { postId: string; userId: string };
        deduplication_key: string;
      }>(
        "SELECT payload,deduplication_key FROM jobs WHERE kind='send_announcement_email' AND payload->>'postId'=$1",
        [created.body.data.id],
      );
      const recipients = jobs.rows.map((row) => row.payload.userId).sort();
      expect(recipients).toEqual([ids.author, ids.staff, ids.student].sort());
      expect(jobs.rows[0]!.deduplication_key).toBe(
        `${created.body.data.id}:${jobs.rows[0]!.payload.userId}`,
      );

      expect((await announce(ids.staff, { title: "TA note" })).status).toBe(
        201,
      );
      const student = await announce(ids.student);
      expect(student.status).toBe(403);
      expect((await announce(ids.instructor, { anonymous: true })).status).toBe(
        422,
      );
      expect(
        (await announce(ids.instructor, { type: "question" })).status,
      ).toBe(422);

      const listed = await request(app(ids.student))
        .get(`${path}?announcement=true`)
        .set("Cookie", cookie);
      expect(listed.status).toBe(200);
      expect(listed.body.data.length).toBeGreaterThan(0);
      expect(
        listed.body.data.every(
          (item: { announcement: boolean }) => item.announcement,
        ),
      ).toBe(true);
      expect(
        (
          await request(app())
            .get(`${path}?announcement=maybe`)
            .set("Cookie", cookie)
        ).status,
      ).toBe(400);

      const anonymous = await unsafe(
        request(app(ids.instructor)).patch(
          `/api/v1/posts/${created.body.data.id}`,
        ),
      )
        .set("If-Match", '"v1"')
        .send({ anonymous: true });
      expect(anonymous.status).toBe(422);
      const unpinned = await unsafe(
        request(app(ids.instructor)).patch(
          `/api/v1/posts/${created.body.data.id}`,
        ),
      )
        .set("If-Match", '"v1"')
        .send({ pinned: false });
      expect(unpinned.body.data).toMatchObject({
        pinned: false,
        announcement: true,
      });
    });
  });
  describe("durable post drafts", () => {
    beforeEach(async () => {
      await pool.query(
        "DELETE FROM post_drafts WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.author],
      );
    });
    it("keeps one course draft, clears content after publish, and rejects a stale second device", async () => {
      const singleton = `/api/v1/courses/${ids.course}/post-draft`;
      const empty = await request(app()).get(singleton).set("Cookie", cookie);
      expect(empty.status).toBe(200);
      expect(empty.headers.etag).toBe('"v0"');
      expect(empty.body.data.content).toBeNull();
      const first = await unsafe(request(app()).put(singleton))
        .set("If-Match", '"v0"')
        .send({
          content: {
            type: "question",
            title: "First",
            bodyMarkdown: "Body",
            anonymous: false,
            tags: [],
          },
        });
      expect(first.status).toBe(200);
      expect(first.headers.etag).toBe('"v1"');
      const staleDevice = '"v1"';
      const second = await unsafe(request(app()).put(singleton))
        .set("If-Match", '"v1"')
        .send({
          content: {
            type: "question",
            title: "Second",
            bodyMarkdown: "Body",
            anonymous: false,
            tags: [],
          },
        });
      expect(second.status).toBe(200);
      expect(
        (
          await unsafe(request(app()).put(singleton))
            .set("If-Match", staleDevice)
            .send({ content: first.body.data.content })
        ).status,
      ).toBe(412);
      const published = await unsafe(
        request(app()).post(`/api/v1/courses/${ids.course}/posts`),
      ).send({
        type: "question",
        title: "Published",
        bodyMarkdown: "Body",
        draftVersion: 2,
      });
      expect(published.status).toBe(201);
      const cleared = await request(app()).get(singleton).set("Cookie", cookie);
      expect(cleared.body.data.content).toBeNull();
      expect(cleared.headers.etag).toBe('"v3"');
      expect(
        (
          await unsafe(request(app()).put(singleton))
            .set("If-Match", '"v2"')
            .send({ content: first.body.data.content })
        ).status,
      ).toBe(412);
      expect(
        (await request(app()).get(singleton).set("Cookie", cookie)).body.data
          .content,
      ).toBeNull();
    });
    const path = `/api/v1/courses/${ids.course}/post-draft`;
    const content = {
      type: "question",
      title: "Partial",
      bodyMarkdown: "",
      anonymous: false,
      tags: ["physics"],
    };
    const put = (userId: string, etag: string, next = content) =>
      unsafe(request(app(userId)).put(path))
        .set("If-Match", etag)
        .send({ content: next });

    it("requires conditional saves, isolates owners, and retains a marker on discard", async () => {
      const initial = await request(app()).get(path).set("Cookie", cookie);
      expect(initial.headers["cache-control"]).toBe("private, no-store");
      expect(initial.body.data.content).toBeNull();
      expect(
        (await unsafe(request(app()).put(path)).send({ content })).status,
      ).toBe(428);
      const saved = await put(ids.author, '"v0"');
      expect(saved.status).toBe(200);
      expect(saved.body.data.content).toEqual(content);
      expect(
        (await request(app(ids.staff)).get(path).set("Cookie", cookie)).body
          .data.content,
      ).toBeNull();
      expect(
        (await request(app(ids.outsider)).get(path).set("Cookie", cookie))
          .status,
      ).toBe(404);
      expect((await put(ids.author, '"v0"')).status).toBe(412);
      const discarded = await unsafe(request(app()).delete(path)).set(
        "If-Match",
        '"v1"',
      );
      expect(discarded.status).toBe(200);
      expect(discarded.body.data.content).toBeNull();
      expect(discarded.headers.etag).toBe('"v2"');
      expect((await put(ids.author, '"v1"')).status).toBe(412);
      expect((await put(ids.author, '"v2"')).status).toBe(200);
    });

    it("keeps incomplete metadata but rejects attachments and invalid text", async () => {
      const bad = await unsafe(request(app()).put(path))
        .set("If-Match", '"v0"')
        .send({ content: { ...content, attachments: [] } });
      expect(bad.status).toBe(422);
      expect(
        (await put(ids.author, '"v0"', { ...content, title: "a\u0000b" }))
          .status,
      ).toBe(422);
      const saved = await put(ids.author, '"v0"', {
        ...content,
        title: "",
        tags: ["", " foo "],
      });
      expect(saved.status).toBe(200);
      const invalidPublish = await unsafe(
        request(app()).post(`/api/v1/courses/${ids.course}/posts`),
      ).send({
        type: "question",
        title: "Published",
        bodyMarkdown: "Body",
        tags: ["", " foo "],
        draftVersion: 1,
      });
      expect(invalidPublish.status).toBe(422);
      expect(
        (await request(app()).get(path).set("Cookie", cookie)).body.data.content
          .tags,
      ).toEqual(["", " foo "]);
    });

    it("supports archived read/discard but blocks save and publish", async () => {
      expect((await put(ids.author, '"v0"')).status).toBe(200);
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        ids.course,
      ]);
      try {
        expect(
          (await request(app()).get(path).set("Cookie", cookie)).body.data
            .content,
        ).toEqual(content);
        expect((await put(ids.author, '"v1"')).status).toBe(409);
        expect(
          (
            await unsafe(
              request(app()).post(`/api/v1/courses/${ids.course}/posts`),
            ).send({
              type: "question",
              title: "Publish",
              bodyMarkdown: "Body",
              draftVersion: 1,
            })
          ).status,
        ).toBe(409);
        expect(
          (await unsafe(request(app()).delete(path)).set("If-Match", '"v1"'))
            .status,
        ).toBe(200);
      } finally {
        await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
          ids.course,
        ]);
      }
    });

    it("replays a published request without consuming the marker again", async () => {
      expect((await put(ids.author, '"v0"')).status).toBe(200);
      const key = uuidv7();
      const make = () =>
        unsafe(request(app()).post(`/api/v1/courses/${ids.course}/posts`))
          .set("Idempotency-Key", key)
          .send({
            type: "question",
            title: "Once",
            bodyMarkdown: "Body",
            draftVersion: 1,
          });
      const first = await make();
      expect(first.status).toBe(201);
      expect(
        (await request(app()).get(path).set("Cookie", cookie)).headers.etag,
      ).toBe('"v2"');
      const replay = await make();
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(
        (await request(app()).get(path).set("Cookie", cookie)).headers.etag,
      ).toBe('"v2"');
    });

    it("allows only one concurrent first save from version zero", async () => {
      const [left, right] = await Promise.all([
        put(ids.author, '"v0"', { ...content, title: "Left" }),
        put(ids.author, '"v0"', { ...content, title: "Right" }),
      ]);
      expect([left.status, right.status].sort()).toEqual([200, 412]);
      const saved = await request(app()).get(path).set("Cookie", cookie);
      expect(saved.headers.etag).toBe('"v1"');
      expect(["Left", "Right"]).toContain(saved.body.data.content.title);
    });

    it("rolls back draft clearing when post creation fails downstream", async () => {
      expect((await put(ids.author, '"v0"')).status).toBe(200);
      await pool.query(`CREATE FUNCTION reject_draft_publish_tag() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated tag failure'; END;
        $$ LANGUAGE plpgsql`);
      await pool.query(`CREATE TRIGGER reject_draft_publish_tag BEFORE INSERT ON post_tags
        FOR EACH ROW EXECUTE FUNCTION reject_draft_publish_tag()`);
      try {
        const failed = await unsafe(
          request(app()).post(`/api/v1/courses/${ids.course}/posts`),
        ).send({
          type: "question",
          title: "Failed atomic publish",
          bodyMarkdown: "Body",
          tags: ["rollback-check"],
          draftVersion: 1,
        });
        expect(failed.status).toBe(500);
        const retained = await request(app()).get(path).set("Cookie", cookie);
        expect(retained.headers.etag).toBe('"v1"');
        expect(retained.body.data.content).toEqual(content);
        const posts = await pool.query(
          "SELECT id FROM posts WHERE course_id=$1 AND title='Failed atomic publish'",
          [ids.course],
        );
        expect(posts.rowCount).toBe(0);
      } finally {
        await pool.query("DROP TRIGGER reject_draft_publish_tag ON post_tags");
        await pool.query("DROP FUNCTION reject_draft_publish_tag()");
      }
    });
  });
});
