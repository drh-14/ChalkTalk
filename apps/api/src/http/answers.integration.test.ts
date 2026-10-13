import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import * as Y from "yjs";
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
    followupService: new FollowupService(pool),
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

function pauseAfterBegin() {
  let started = () => {};
  let resume = () => {};
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const pausedPool = {
    connect: async () => {
      const db = await pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          const result = await db.query(sql, values);
          if (sql === "BEGIN") {
            started();
            await released;
          }
          return result;
        },
        release: () => db.release(),
      };
    },
  } as unknown as Pool;
  return { pausedPool, begun, resume };
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

  it("creates independent answer cards from students and staff", async () => {
    const postId = await insertPost();
    const first = await answer(ids.author, postId, { bodyMarkdown: "First" });
    const second = await answer(ids.student, postId, {
      bodyMarkdown: "Second",
    });
    const third = await answer(ids.staff, postId, { bodyMarkdown: "Third" });
    expect([first.status, second.status, third.status]).toEqual([
      201, 201, 201,
    ]);
    const listed = await read(ids.author, `/api/v1/posts/${postId}/answers`);
    expect(
      listed.body.data.map(
        (item: { bodyMarkdown: string }) => item.bodyMarkdown,
      ),
    ).toEqual(["First", "Second", "Third"]);
    expect(listed.body.data[0]).toMatchObject({
      canEdit: true,
      upvoteCount: 0,
      viewerUpvoted: false,
    });
    expect(listed.body.data[0]).not.toHaveProperty("kind");
  });

  it("edits an answer by current role with a versioned REST save", async () => {
    const postId = await insertPost();
    const created = await answer(ids.author, postId, { bodyMarkdown: "Old" });
    const path = `/api/v1/answers/${created.body.data.id}`;
    const saved = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "New $x^2$" });
    expect(saved.status).toBe(200);
    expect(saved.headers.etag).toBe('"v2"');
    expect(saved.body.data).toMatchObject({
      bodyMarkdown: "New $x^2$",
      version: 2,
      contributors: [
        { id: ids.author, displayName: "Author" },
        { id: ids.student, displayName: "Student" },
      ],
    });
    const stale = await unsafe(request(app(ids.author)).patch(path))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "Stale" });
    expect(stale.status).toBe(412);
    const persisted = await pool.query(
      "SELECT body_markdown FROM answers WHERE id=$1",
      [created.body.data.id],
    );
    expect(persisted.rows[0].body_markdown).toBe("New $x^2$");
    const document = await pool.query(
      "SELECT yjs_state FROM answer_collaboration_documents WHERE answer_id=$1",
      [created.body.data.id],
    );
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, document.rows[0].yjs_state);
    expect(ydoc.getText("content").toString()).toBe("New $x^2$");
  });

  it("keeps the creator-role floor stable and uses the editor's current role", async () => {
    const postId = await insertPost();
    const studentCard = await answer(ids.author, postId, {
      bodyMarkdown: "Student",
    });
    const instructorEdit = await unsafe(
      request(app(ids.instructor)).patch(studentCard.headers.location),
    )
      .set("If-Match", studentCard.headers.etag)
      .send({ bodyMarkdown: "Instructor edit" });
    expect(instructorEdit.status).toBe(200);
    const peerEdit = await unsafe(
      request(app(ids.student)).patch(studentCard.headers.location),
    )
      .set("If-Match", instructorEdit.headers.etag)
      .send({ bodyMarkdown: "Peer edit" });
    expect(peerEdit.status).toBe(200);
    const taCard = await answer(ids.staff, postId, { bodyMarkdown: "TA" });
    const studentDenied = await unsafe(
      request(app(ids.student)).patch(taCard.headers.location),
    )
      .set("If-Match", taCard.headers.etag)
      .send({ bodyMarkdown: "No" });
    expect(studentDenied.status).toBe(403);
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.staff],
    );
    try {
      const downgraded = await read(ids.staff, taCard.headers.location);
      expect(downgraded.body.data.canEdit).toBe(false);
      const denied = await unsafe(
        request(app(ids.staff)).patch(taCard.headers.location),
      )
        .set("If-Match", taCard.headers.etag)
        .send({ bodyMarkdown: "Downgraded" });
      expect(denied.status).toBe(403);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.staff],
      );
    }
  });

  it("creates question-level followups before answers and counts roots", async () => {
    const postId = await insertPost();
    const path = `/api/v1/posts/${postId}/followups`;
    const empty = await read(ids.author, path);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.total).toBe(0);
    const created = await unsafe(request(app(ids.author)).post(path)).send({
      bodyMarkdown: "What about $x$?",
    });
    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      `/api/v1/followups/${created.body.data.id}`,
    );
    const listed = await read(ids.student, path);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0]).toMatchObject({
      bodyMarkdown: "What about $x$?",
      upvoteCount: 0,
      viewerUpvoted: false,
    });
  });

  it("rejects followup creation on notes with 409 while listing uses 422", async () => {
    const note = await insertPost("note");
    const path = `/api/v1/posts/${note}/followups`;
    const created = await unsafe(request(app(ids.author)).post(path)).send({
      bodyMarkdown: "Question on a note",
    });
    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe("not_a_question");
    const listed = await read(ids.author, path);
    expect(listed.status).toBe(422);
    expect(listed.body.error.code).toBe("not_a_question");
  });

  it.each(["root", "reply"])(
    "rejects invalid %s followup cursors instead of returning the first page",
    async (kind) => {
      const postId = await insertPost();
      const root = await unsafe(
        request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Root" });
      expect(root.status).toBe(201);
      const path =
        kind === "root"
          ? `/api/v1/posts/${postId}/followups`
          : `/api/v1/followups/${root.body.data.id}/replies`;
      for (const query of [
        "cursor=one&cursor=two",
        "cursor=",
        "cursor[]=one",
      ]) {
        const response = await read(ids.author, `${path}?${query}`);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("invalid_request");
      }
    },
  );

  it.each(["root", "reply"])(
    "rejects impossible calendar dates in %s followup cursors",
    async (kind) => {
      const postId = await insertPost();
      const root = await unsafe(
        request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Root" });
      expect(root.status).toBe(201);
      const path =
        kind === "root"
          ? `/api/v1/posts/${postId}/followups`
          : `/api/v1/followups/${root.body.data.id}/replies`;
      for (const timestamp of [
        "2026-02-31T00:00:00.000000Z",
        "2025-02-29T00:00:00.000000Z",
        "0000-01-01T00:00:00.000000Z",
      ]) {
        const cursor = Buffer.from(
          JSON.stringify([timestamp, root.body.data.id]),
        ).toString("base64url");
        const response = await read(ids.author, `${path}?cursor=${cursor}`);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("invalid_cursor");
      }
      const leapDay = Buffer.from(
        JSON.stringify(["2024-02-29T00:00:00.000000Z", root.body.data.id]),
      ).toString("base64url");
      expect((await read(ids.author, `${path}?cursor=${leapDay}`)).status).toBe(
        200,
      );
    },
  );

  it("batches visible reply counts for root and reply pages", async () => {
    const postId = await insertPost();
    const createAt = async (path: string, bodyMarkdown: string) => {
      const response = await unsafe(request(app(ids.author)).post(path)).send({
        bodyMarkdown,
      });
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const rootsPath = `/api/v1/posts/${postId}/followups`;
    const firstRoot = await createAt(rootsPath, "First root");
    const secondRoot = await createAt(rootsPath, "Second root");
    const firstReply = await createAt(
      `/api/v1/followups/${firstRoot}/replies`,
      "First reply",
    );
    const secondReply = await createAt(
      `/api/v1/followups/${firstRoot}/replies`,
      "Second reply",
    );
    await createAt(`/api/v1/followups/${secondRoot}/replies`, "Other reply");
    await createAt(`/api/v1/followups/${firstReply}/replies`, "Nested reply");

    let recursiveQueries = 0;
    const trackedPool = {
      query: (sql: string, values?: unknown[]) => {
        if (sql.startsWith("WITH RECURSIVE visible")) recursiveQueries++;
        return pool.query(sql, values);
      },
    } as unknown as Pool;
    const service = new FollowupService(trackedPool);
    const roots = await service.list(
      postId,
      ids.author,
      undefined,
      undefined,
      2,
    );
    expect(
      roots.data.map(({ id, replyCount }) => ({ id, replyCount })),
    ).toEqual([
      { id: firstRoot, replyCount: 2 },
      { id: secondRoot, replyCount: 1 },
    ]);
    expect(recursiveQueries).toBe(3);

    recursiveQueries = 0;
    const replies = await service.list(
      postId,
      ids.author,
      firstRoot,
      undefined,
      2,
    );
    expect(
      replies.data.map(({ id, replyCount }) => ({ id, replyCount })),
    ).toEqual([
      { id: firstReply, replyCount: 1 },
      { id: secondReply, replyCount: 0 },
    ]);
    expect(recursiveQueries).toBe(3);
  });

  it.each(["root", "reply"])(
    "retains microsecond creation order for %s pagination",
    async (kind) => {
      const postId = await insertPost();
      const root =
        kind === "reply"
          ? await unsafe(
              request(app(ids.author)).post(
                `/api/v1/posts/${postId}/followups`,
              ),
            ).send({ bodyMarkdown: "Parent" })
          : undefined;
      const path = root
        ? `/api/v1/followups/${root.body.data.id}/replies`
        : `/api/v1/posts/${postId}/followups`;
      const first = await unsafe(request(app(ids.author)).post(path)).send({
        bodyMarkdown: "First",
      });
      const second = await unsafe(request(app(ids.author)).post(path)).send({
        bodyMarkdown: "Second",
      });
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.data.createdAt).toMatch(/\.\d{6}Z$/);
      await pool.query(
        "UPDATE followups SET created_at=$2::timestamptz WHERE id=$1",
        [first.body.data.id, "2026-10-01T00:00:00.000200Z"],
      );
      await pool.query(
        "UPDATE followups SET created_at=$2::timestamptz WHERE id=$1",
        [second.body.data.id, "2026-10-01T00:00:00.000100Z"],
      );
      const firstPage = await read(ids.student, `${path}?limit=1`);
      expect(firstPage.body.data[0]).toMatchObject({
        id: second.body.data.id,
        createdAt: "2026-10-01T00:00:00.000100Z",
      });
      const secondPage = await read(
        ids.student,
        `${path}?limit=1&cursor=${encodeURIComponent(firstPage.body.meta.nextCursor)}`,
      );
      expect(secondPage.body.data[0]).toMatchObject({
        id: first.body.data.id,
        createdAt: "2026-10-01T00:00:00.000200Z",
      });
      expect(
        (await read(ids.student, first.headers.location)).body.data.createdAt,
      ).toBe("2026-10-01T00:00:00.000200Z");
    },
  );

  it("keeps threaded replies after a parent is deleted and hides anonymous authors from students", async () => {
    const postId = await insertPost();
    const root = await unsafe(
      request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Root", anonymous: true });
    expect(root.status).toBe(201);
    const reply = await unsafe(
      request(app(ids.student)).post(
        `/api/v1/followups/${root.body.data.id}/replies`,
      ),
    ).send({ bodyMarkdown: "Reply" });
    expect(reply.status).toBe(201);
    const studentRoot = await read(
      ids.student,
      `/api/v1/followups/${root.body.data.id}`,
    );
    expect(studentRoot.body.data.author).toBeNull();
    const staffRoot = await read(
      ids.staff,
      `/api/v1/followups/${root.body.data.id}`,
    );
    expect(staffRoot.body.data.author).toMatchObject({ id: ids.author });
    const denied = await unsafe(
      request(app(ids.student)).patch(`/api/v1/followups/${root.body.data.id}`),
    )
      .set("If-Match", root.headers.etag)
      .send({ bodyMarkdown: "Hijack" });
    expect(denied.status).toBe(403);
    const deleted = await unsafe(
      request(app(ids.author)).delete(`/api/v1/followups/${root.body.data.id}`),
    ).set("If-Match", root.headers.etag);
    expect(deleted.status).toBe(204);
    const tree = await read(ids.student, `/api/v1/posts/${postId}/followups`);
    expect(tree.body.data[0]).toMatchObject({
      id: root.body.data.id,
      bodyMarkdown: null,
      deleted: true,
    });
    const replies = await read(
      ids.student,
      `/api/v1/followups/${root.body.data.id}/replies`,
    );
    expect(replies.body.data[0].id).toBe(reply.body.data.id);
  });

  it("paginates roots and replies without skipping after earlier items are deleted", async () => {
    const postId = await insertPost();
    const roots = [];
    for (const bodyMarkdown of ["First", "Second", "Third"]) {
      const created = await unsafe(
        request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown });
      expect(created.status).toBe(201);
      roots.push(created);
    }
    const rootPath = `/api/v1/posts/${postId}/followups`;
    const firstPage = await read(ids.author, `${rootPath}?limit=1`);
    expect(firstPage.body.data.map((item: { id: string }) => item.id)).toEqual([
      roots[0].body.data.id,
    ]);
    expect(firstPage.body.meta.nextCursor).toBeTruthy();
    expect(
      (
        await unsafe(
          request(app(ids.author)).delete(roots[0].headers.location),
        ).set("If-Match", roots[0].headers.etag)
      ).status,
    ).toBe(204);
    const secondPage = await read(
      ids.author,
      `${rootPath}?limit=1&cursor=${encodeURIComponent(firstPage.body.meta.nextCursor)}`,
    );
    expect(secondPage.body.data[0].id).toBe(roots[1].body.data.id);
    expect(secondPage.body.meta.nextCursor).toBeTruthy();
    const thirdPage = await read(
      ids.author,
      `${rootPath}?limit=1&cursor=${encodeURIComponent(secondPage.body.meta.nextCursor)}`,
    );
    expect(thirdPage.body.data[0].id).toBe(roots[2].body.data.id);

    const replyPath = `/api/v1/followups/${roots[1].body.data.id}/replies`;
    const replies = [];
    for (const bodyMarkdown of ["A", "B", "C"]) {
      const created = await unsafe(
        request(app(ids.student)).post(replyPath),
      ).send({ bodyMarkdown });
      expect(created.status).toBe(201);
      replies.push(created);
    }
    const firstReplyPage = await read(ids.author, `${replyPath}?limit=1`);
    expect(firstReplyPage.body.data[0].id).toBe(replies[0].body.data.id);
    expect(
      (
        await unsafe(
          request(app(ids.student)).delete(replies[0].headers.location),
        ).set("If-Match", replies[0].headers.etag)
      ).status,
    ).toBe(204);
    const nextReplyPage = await read(
      ids.author,
      `${replyPath}?limit=1&cursor=${encodeURIComponent(firstReplyPage.body.meta.nextCursor)}`,
    );
    expect(nextReplyPage.body.data[0].id).toBe(replies[1].body.data.id);
    expect(nextReplyPage.body.meta.nextCursor).toBeTruthy();
  });

  it("keeps deleted ancestors only while a live descendant remains", async () => {
    const postId = await insertPost();
    const root = await unsafe(
      request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Root" });
    const child = await unsafe(
      request(app(ids.author)).post(
        `/api/v1/followups/${root.body.data.id}/replies`,
      ),
    ).send({ bodyMarkdown: "Child" });
    const leaf = await unsafe(
      request(app(ids.author)).post(
        `/api/v1/followups/${child.body.data.id}/replies`,
      ),
    ).send({ bodyMarkdown: "Leaf" });
    for (const item of [root, child])
      expect(
        (
          await unsafe(
            request(app(ids.author)).delete(item.headers.location),
          ).set("If-Match", item.headers.etag)
        ).status,
      ).toBe(204);
    const roots = await read(ids.author, `/api/v1/posts/${postId}/followups`);
    expect(roots.body.data[0]).toMatchObject({
      id: root.body.data.id,
      replyCount: 1,
    });
    const children = await read(
      ids.author,
      `/api/v1/followups/${root.body.data.id}/replies`,
    );
    expect(children.body.data[0]).toMatchObject({
      id: child.body.data.id,
      replyCount: 1,
    });
    expect(
      (
        await unsafe(
          request(app(ids.author)).delete(leaf.headers.location),
        ).set("If-Match", leaf.headers.etag)
      ).status,
    ).toBe(204);
    const emptyRoots = await read(
      ids.author,
      `/api/v1/posts/${postId}/followups`,
    );
    expect(emptyRoots.body).toMatchObject({ data: [], meta: { total: 0 } });
    for (const item of [root, child, leaf])
      expect((await read(ids.author, item.headers.location)).status).toBe(404);
    expect(
      (await read(ids.author, `/api/v1/followups/${root.body.data.id}/replies`))
        .status,
    ).toBe(404);
  });

  it("reuses expired idempotency keys for new roots and replies", async () => {
    const postId = await insertPost();
    const rootPath = `/api/v1/posts/${postId}/followups`;
    const root = await unsafe(request(app(ids.author)).post(rootPath))
      .set("Idempotency-Key", "expired-root")
      .send({ bodyMarkdown: "Original root" });
    expect(root.status).toBe(201);
    const replyPath = `/api/v1/followups/${root.body.data.id}/replies`;
    for (const [path, key] of [
      [rootPath, "expired-root"],
      [replyPath, "expired-reply"],
    ]) {
      const first =
        path === rootPath
          ? root
          : await unsafe(request(app(ids.author)).post(path))
              .set("Idempotency-Key", key)
              .send({ bodyMarkdown: "Original reply" });
      expect(first.status).toBe(201);
      await pool.query(
        "UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE key=$1",
        [key],
      );
      const second = await unsafe(request(app(ids.author)).post(path))
        .set("Idempotency-Key", key)
        .send({ bodyMarkdown: "Fresh content" });
      expect(second.status).toBe(201);
      expect(second.body.data.id).not.toBe(first.body.data.id);
      expect(second.body.data.bodyMarkdown).toBe("Fresh content");
      const records = await pool.query(
        "SELECT count(*)::integer AS count FROM idempotency_records WHERE key=$1 AND expires_at>now()",
        [key],
      );
      expect(records.rows[0].count).toBe(1);
    }
  });

  it("replays created roots and replies after write eligibility changes", async () => {
    const postId = await insertPost();
    const rootPath = `/api/v1/posts/${postId}/followups`;
    const rootBody = { bodyMarkdown: "Root" };
    const root = await unsafe(request(app(ids.author)).post(rootPath))
      .set("Idempotency-Key", "root-before-archive")
      .send(rootBody);
    expect(root.status).toBe(201);
    const replyPath = `/api/v1/followups/${root.body.data.id}/replies`;
    const replyBody = { bodyMarkdown: "Reply" };
    const reply = await unsafe(request(app(ids.author)).post(replyPath))
      .set("Idempotency-Key", "reply-before-delete")
      .send(replyBody);
    expect(reply.status).toBe(201);

    expect(
      (
        await unsafe(
          request(app(ids.author)).delete(root.headers.location),
        ).set("If-Match", root.headers.etag)
      ).status,
    ).toBe(204);
    const replayedReply = await unsafe(request(app(ids.author)).post(replyPath))
      .set("Idempotency-Key", "reply-before-delete")
      .send(replyBody);
    expect(replayedReply.status).toBe(201);
    expect(replayedReply.body.data.id).toBe(reply.body.data.id);
    const newReply = await unsafe(
      request(app(ids.author)).post(replyPath),
    ).send({
      bodyMarkdown: "Too late",
    });
    expect(newReply.status).toBe(404);

    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      const replayedRoot = await unsafe(request(app(ids.author)).post(rootPath))
        .set("Idempotency-Key", "root-before-archive")
        .send(rootBody);
      expect(replayedRoot.status).toBe(201);
      expect(replayedRoot.body.data.id).toBe(root.body.data.id);
      const replayedArchivedReply = await unsafe(
        request(app(ids.author)).post(replyPath),
      )
        .set("Idempotency-Key", "reply-before-delete")
        .send(replyBody);
      expect(replayedArchivedReply.status).toBe(201);
      expect(replayedArchivedReply.body.data.id).toBe(reply.body.data.id);
      const newRoot = await unsafe(
        request(app(ids.author)).post(rootPath),
      ).send({
        bodyMarkdown: "Too late",
      });
      expect(newRoot.status).toBe(409);
      expect(newRoot.body.error.code).toBe("course_archived");
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });

  it("rejects replay when a question is deleted or merged", async () => {
    for (const hidden of ["deleted", "merged"] as const) {
      const postId = await insertPost();
      const path = `/api/v1/posts/${postId}/followups`;
      const body = { bodyMarkdown: "Root" };
      const created = await unsafe(request(app(ids.author)).post(path))
        .set("Idempotency-Key", `hidden-question-${hidden}`)
        .send(body);
      expect(created.status).toBe(201);
      if (hidden === "deleted") {
        await pool.query(
          "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now() WHERE id=$1",
          [postId],
        );
      } else {
        await pool.query(
          "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
          [postId, await insertPost()],
        );
      }
      expect((await read(ids.author, created.headers.location)).status).toBe(
        404,
      );
      const replay = await unsafe(request(app(ids.author)).post(path))
        .set("Idempotency-Key", `hidden-question-${hidden}`)
        .send(body);
      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe("not_found");
    }
  });

  it("rejects replay of deleted leaf roots and replies", async () => {
    const postId = await insertPost();
    const rootPath = `/api/v1/posts/${postId}/followups`;
    const root = await unsafe(request(app(ids.author)).post(rootPath))
      .set("Idempotency-Key", "deleted-root")
      .send({ bodyMarkdown: "Root" });
    expect(root.status).toBe(201);
    const parent = await unsafe(request(app(ids.author)).post(rootPath)).send({
      bodyMarkdown: "Parent",
    });
    expect(parent.status).toBe(201);
    const replyPath = `/api/v1/followups/${parent.body.data.id}/replies`;
    const reply = await unsafe(request(app(ids.author)).post(replyPath))
      .set("Idempotency-Key", "deleted-reply")
      .send({ bodyMarkdown: "Reply" });
    expect(reply.status).toBe(201);

    for (const [created, path, key, bodyMarkdown] of [
      [root, rootPath, "deleted-root", "Root"],
      [reply, replyPath, "deleted-reply", "Reply"],
    ] as const) {
      expect(
        (
          await unsafe(
            request(app(ids.author)).delete(created.headers.location),
          ).set("If-Match", created.headers.etag)
        ).status,
      ).toBe(204);
      expect((await read(ids.author, created.headers.location)).status).toBe(
        404,
      );
      const replay = await unsafe(request(app(ids.author)).post(path))
        .set("Idempotency-Key", key)
        .send({ bodyMarkdown });
      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe("not_found");
    }
  });

  it("serializes concurrent followup writes on the same question", async () => {
    const postId = await insertPost();
    const path = `/api/v1/posts/${postId}/followups`;
    const first = await unsafe(request(app(ids.author)).post(path)).send({
      bodyMarkdown: "First",
    });
    const second = await unsafe(request(app(ids.student)).post(path)).send({
      bodyMarkdown: "Second",
    });
    expect([first.status, second.status]).toEqual([201, 201]);
    await pool.query(`CREATE FUNCTION delay_followup_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END
    $$`);
    await pool.query(`CREATE TRIGGER followup_write_delay BEFORE INSERT OR UPDATE ON followups
      FOR EACH ROW EXECUTE FUNCTION delay_followup_write()`);
    try {
      const creations = await Promise.all([
        unsafe(request(app(ids.author)).post(path)).send({
          bodyMarkdown: "Third",
        }),
        unsafe(request(app(ids.student)).post(path)).send({
          bodyMarkdown: "Fourth",
        }),
      ]);
      expect(creations.map((result) => result.status)).toEqual([201, 201]);
      const edits = await Promise.all([
        unsafe(request(app(ids.author)).patch(first.headers.location))
          .set("If-Match", first.headers.etag)
          .send({ bodyMarkdown: "Edited" }),
        unsafe(request(app(ids.student)).delete(second.headers.location)).set(
          "If-Match",
          second.headers.etag,
        ),
      ]);
      expect(edits.map((result) => result.status)).toEqual([200, 204]);
    } finally {
      await pool.query("DROP TRIGGER followup_write_delay ON followups");
      await pool.query("DROP FUNCTION delay_followup_write()");
    }
  });

  it("orders followups by write time after a transaction waits", async () => {
    const postId = await insertPost();
    const { pausedPool, begun, resume } = pauseAfterBegin();
    const waiting = new FollowupService(pausedPool).create(postId, ids.author, {
      bodyMarkdown: "Waiting",
    });
    await begun;
    const first = await new FollowupService(pool)
      .create(postId, ids.student, {
        bodyMarkdown: "First",
      })
      .finally(resume);
    const second = await waiting;
    const listed = await read(ids.author, `/api/v1/posts/${postId}/followups`);
    expect(listed.body.data.map((item: { id: string }) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
    const timestamps = await pool.query<{
      first_created: Date;
      second_created: Date;
      activity: Date;
    }>(
      "SELECT a.created_at AS first_created,b.created_at AS second_created,p.last_activity_at AS activity FROM followups a,followups b,posts p WHERE a.id=$1 AND b.id=$2 AND p.id=$3",
      [first.id, second.id, postId],
    );
    expect(timestamps.rows[0].second_created.getTime()).toBeGreaterThanOrEqual(
      timestamps.rows[0].first_created.getTime(),
    );
    expect(timestamps.rows[0].activity.getTime()).toBeGreaterThanOrEqual(
      timestamps.rows[0].second_created.getTime(),
    );
  });

  it("orders answer creation and activity after a transaction waits", async () => {
    const postId = await insertPost();
    const { pausedPool, begun, resume } = pauseAfterBegin();
    const waiting = new AnswerService(pausedPool).create(postId, ids.author, {
      bodyMarkdown: "Waiting",
    });
    await begun;
    const first = await new AnswerService(pool)
      .create(postId, ids.student, {
        bodyMarkdown: "First",
      })
      .finally(resume);
    const second = await waiting;
    const listed = await read(ids.author, `/api/v1/posts/${postId}/answers`);
    expect(listed.body.data.map((item: { id: string }) => item.id)).toEqual([
      first.value.id,
      second.value.id,
    ]);
    const timestamps = await pool.query<{
      first_created: Date;
      second_created: Date;
      activity: Date;
    }>(
      "SELECT a.created_at AS first_created,b.created_at AS second_created,p.last_activity_at AS activity FROM answers a,answers b,posts p WHERE a.id=$1 AND b.id=$2 AND p.id=$3",
      [first.value.id, second.value.id, postId],
    );
    expect(timestamps.rows[0].second_created.getTime()).toBeGreaterThanOrEqual(
      timestamps.rows[0].first_created.getTime(),
    );
    expect(timestamps.rows[0].activity.getTime()).toBeGreaterThanOrEqual(
      timestamps.rows[0].second_created.getTime(),
    );
  });

  it("keeps post activity increasing after delayed edits and deletes", async () => {
    for (const action of ["edit", "delete"] as const) {
      const postId = await insertPost();
      const current = await read(ids.author, `/api/v1/posts/${postId}`);
      expect(current.status).toBe(200);
      const { pausedPool, begun, resume } = pauseAfterBegin();
      const postService = new PostService(pausedPool);
      const waiting =
        action === "edit"
          ? postService.update(postId, ids.author, current.headers.etag, {
              title: "Edited title",
            })
          : postService.delete(postId, ids.author, current.headers.etag);
      await begun;
      const created = await new FollowupService(pool)
        .create(postId, ids.student, { bodyMarkdown: "Discussion" })
        .finally(resume);
      expect(created.postId).toBe(postId);
      const before = await pool.query<{ activity: string }>(
        "SELECT last_activity_at::text AS activity FROM posts WHERE id=$1",
        [postId],
      );
      await waiting;
      const after = await pool.query<{ increased: boolean }>(
        "SELECT last_activity_at > $2::timestamptz AS increased FROM posts WHERE id=$1",
        [postId, before.rows[0].activity],
      );
      expect(after.rows[0].increased).toBe(true);
    }
  });

  it("idempotently votes on followups without changing their ETag", async () => {
    const postId = await insertPost();
    const created = await unsafe(
      request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Discussion" });
    const path = `/api/v1/followups/${created.body.data.id}/upvote`;
    expect((await unsafe(request(app(ids.student)).put(path))).status).toBe(
      200,
    );
    expect((await unsafe(request(app(ids.student)).put(path))).status).toBe(
      200,
    );
    const fetched = await read(
      ids.student,
      `/api/v1/followups/${created.body.data.id}`,
    );
    expect(fetched.headers.etag).toBe(created.headers.etag);
    expect(fetched.body.data).toMatchObject({
      upvoteCount: 1,
      viewerUpvoted: true,
    });
  });

  it("requires a current followup ETag and lets the author or staff edit", async () => {
    const postId = await insertPost();
    const created = await unsafe(
      request(app(ids.author)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Original" });
    const path = created.headers.location;
    const missing = await unsafe(request(app(ids.author)).patch(path)).send({
      bodyMarkdown: "Missing",
    });
    expect(missing.status).toBe(428);
    const denied = await unsafe(request(app(ids.student)).patch(path))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "Hijack" });
    expect(denied.status).toBe(403);
    const edited = await unsafe(request(app(ids.staff)).patch(path))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "Staff edit" });
    expect(edited.status).toBe(200);
    expect(edited.headers.etag).toBe('"v2"');
    const stale = await unsafe(request(app(ids.author)).patch(path))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "Stale" });
    expect(stale.status).toBe(412);
    expect((await read(ids.author, path)).body.data.bodyMarkdown).toBe(
      "Staff edit",
    );
  });

  it("idempotently upvotes answers and followups without changing content ETags", async () => {
    const postId = await insertPost();
    const created = await answer(ids.author, postId);
    const path = `/api/v1/answers/${created.body.data.id}/upvote`;
    expect((await unsafe(request(app(ids.student)).put(path))).status).toBe(
      200,
    );
    expect((await unsafe(request(app(ids.student)).put(path))).status).toBe(
      200,
    );
    const fetched = await read(
      ids.student,
      `/api/v1/answers/${created.body.data.id}`,
    );
    expect(fetched.headers.etag).toBe(created.headers.etag);
    expect(fetched.body.data).toMatchObject({
      upvoteCount: 1,
      viewerUpvoted: true,
    });
    expect((await unsafe(request(app(ids.student)).delete(path))).status).toBe(
      200,
    );
    expect(
      (await read(ids.student, `/api/v1/answers/${created.body.data.id}`)).body
        .data.upvoteCount,
    ).toBe(0);
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
      canEdit: true,
      upvoteCount: 0,
      viewerUpvoted: false,
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

  it("lists independent answers in creation order", async () => {
    const postId = await insertPost();
    const staff = await answer(ids.staff, postId, { bodyMarkdown: "Staff." });
    expect(staff.status).toBe(201);
    expect(staff.body.data).not.toHaveProperty("kind");
    const student = await answer(ids.student, postId);
    expect(student.status).toBe(201);
    const listed = await read(ids.author, `/api/v1/posts/${postId}/answers`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((item: { id: string }) => item.id)).toEqual([
      staff.body.data.id,
      student.body.data.id,
    ]);
    const empty = await read(
      ids.author,
      `/api/v1/posts/${await insertPost()}/answers`,
    );
    expect(empty.body).toEqual({ data: [] });
  });

  it("allows independent cards, including concurrent attempts", async () => {
    const postId = await insertPost();
    const results = await Promise.all([
      answer(ids.author, postId),
      answer(ids.student, postId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 201]);
    await answer(ids.staff, postId);
    const second = await answer(ids.instructor, postId);
    expect(second.status).toBe(201);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM answers WHERE post_id=$1",
      [postId],
    );
    expect(count.rows[0].n).toBe(4);
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
        canEdit: false,
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

  it("hides anonymous endorsement identity from students across answer reads", async () => {
    const postId = await insertPost();
    const created = await answer(ids.staff, postId, {
      bodyMarkdown: "Anonymous staff answer",
      anonymous: true,
    });
    expect(created.status).toBe(201);
    const endorsed = await endorse(
      ids.staff,
      created.headers.location,
      created.headers.etag,
    );
    expect(endorsed.status).toBe(200);
    expect(endorsed.body.data.endorsedBy).toBe(ids.staff);
    for (const viewer of [ids.author, ids.student]) {
      const direct = await read(viewer, created.headers.location);
      expect(direct.body.data).toMatchObject({
        contributors: null,
        endorsedBy: null,
      });
      const listed = await read(viewer, `/api/v1/posts/${postId}/answers`);
      expect(listed.body.data[0]).toMatchObject({
        contributors: null,
        endorsedBy: null,
      });
    }
    for (const viewer of [ids.staff, ids.instructor]) {
      const direct = await read(viewer, created.headers.location);
      expect(direct.body.data.endorsedBy).toBe(ids.staff);
      const listed = await read(viewer, `/api/v1/posts/${postId}/answers`);
      expect(listed.body.data[0].endorsedBy).toBe(ids.staff);
    }
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

  it("validates answer text edits", async () => {
    const created = await answer(ids.author, await insertPost());
    const patch = await unsafe(
      request(app(ids.author)).patch(created.headers.location),
    )
      .set("If-Match", '"v1"')
      .send({ anonymous: true });
    expect(patch.status).toBe(422);
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
