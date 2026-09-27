import { Pool } from "pg";
import request from "supertest";
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
  organization: "33333333-3333-4333-8333-333333333333",
  course: "44444444-4444-4444-8444-444444444444",
  author: "11111111-1111-4111-8111-111111111111",
  student: "22222222-2222-4222-8222-222222222222",
  staff: "55555555-5555-4555-8555-555555555555",
  instructor: "88888888-8888-4888-8888-888888888888",
  outsider: "66666666-6666-4666-8666-666666666666",
  otherCourse: "77777777-7777-4777-8777-777777777777",
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
        id: "session",
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
      .get("/api/v1/posts/99999999-9999-4999-8999-999999999999")
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
    expect(staff.body.data).toMatchObject({
      pinned: true,
      duplicateOfPostId: target.body.data.id,
      duplicateStatus: "confirmed",
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
});
