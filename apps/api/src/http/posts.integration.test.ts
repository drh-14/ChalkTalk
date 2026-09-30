import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(filtered.status).toBe(400);
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
    expect(pinned.body.data.lastActivityAt).toBe("2026-01-01T00:00:00.000Z");
    for (const sort of sorts)
      expect(await titleOrder(sort)).toEqual(["Toggle older", "Toggle newer"]);
    const unpinned = await unsafe(
      request(app(ids.staff)).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", pinned.headers.etag)
      .send({ pinned: false })
      .expect(200);
    expect(unpinned.body.data.lastActivityAt).toBe("2026-01-01T00:00:00.000Z");
    for (const sort of sorts) {
      expect(await titleOrder(sort)).toEqual(
        sort === "oldest"
          ? ["Toggle older", "Toggle newer"]
          : ["Toggle newer", "Toggle older"],
      );
    }
    const suggested = await unsafe(
      request(app()).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", unpinned.headers.etag)
      .send({
        duplicateStatus: "suggested",
        duplicateOfPostId: newer.body.data.id,
      })
      .expect(200);
    expect(suggested.body.data.lastActivityAt).toBe("2026-01-01T00:00:00.000Z");
    const merged = await unsafe(
      request(app(ids.staff)).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", suggested.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: newer.body.data.id,
      })
      .expect(200);
    const activityAfterMerge = await pool.query<{ last_activity_at: Date }>(
      "SELECT last_activity_at FROM posts WHERE id=$1",
      [older.body.data.id],
    );
    expect(activityAfterMerge.rows[0]?.last_activity_at.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    const restored = await unsafe(
      request(app(ids.staff)).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null })
      .expect(200);
    expect(restored.body.data.lastActivityAt).toBe("2026-01-01T00:00:00.000Z");
    for (const sort of sorts)
      expect(await titleOrder(sort)).toEqual(
        sort === "oldest"
          ? ["Toggle older", "Toggle newer"]
          : ["Toggle newer", "Toggle older"],
      );
    const defaultOrder = await request(app())
      .get(`/api/v1/courses/${courseId}/posts?limit=2`)
      .set("Cookie", cookie);
    expect(
      defaultOrder.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Toggle newer", "Toggle older"]);
    const edited = await unsafe(
      request(app()).patch(`/api/v1/posts/${older.body.data.id}`),
    )
      .set("If-Match", restored.headers.etag)
      .send({ bodyMarkdown: "Edited content" })
      .expect(200);
    expect(Date.parse(edited.body.data.lastActivityAt)).toBeGreaterThan(
      Date.parse(restored.body.data.lastActivityAt),
    );
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
});
