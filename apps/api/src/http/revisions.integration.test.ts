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
const schema = `revisions_${process.pid}_${Date.now()}`;
const ids = {
  organization: uuidv7(),
  course: uuidv7(),
  author: uuidv7(),
  student: uuidv7(),
  staff: uuidv7(),
  instructor: uuidv7(),
  outsider: uuidv7(),
};
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";
let admin: Pool;
let pool: Pool;

function app(userId = ids.author) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "user@example.edu",
          displayName: "User",
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
function write(agent: request.SuperTest<request.Test>) {
  return agent
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
}
function read(agent: request.SuperTest<request.Test>) {
  return agent.set("Cookie", cookie);
}
async function fullRevisions(
  base: string,
  list: { body: { data: { id: string }[] } },
  userId = ids.author,
) {
  return Promise.all(
    (list.body.data as { id: string }[]).map(
      async ({ id }) =>
        (await read(request(app(userId)).get(`${base}/${id}`))).body.data,
    ),
  );
}

integration("content revision history HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    for (const [name, id] of Object.entries({
      author: ids.author,
      student: ids.student,
      staff: ids.staff,
      instructor: ids.instructor,
      outsider: ids.outsider,
    }))
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.organization, `${name}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.organization, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta')",
      [ids.course, ids.author, ids.student, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.course, ids.instructor],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("marks failed history reads and restores private and no-store", async () => {
    const resourceId = uuidv7();
    const revisionId = uuidv7();
    for (const kind of ["posts", "answers", "followups"]) {
      const base = `/api/v1/${kind}/${resourceId}/revisions`;
      for (const path of [
        base,
        `${base}/${revisionId}`,
        `${base}/compare?left=${revisionId}&right=${revisionId}`,
      ]) {
        const failed = await read(request(app(ids.student)).get(path));
        expect(failed.status).toBe(404);
        expect(failed.headers["cache-control"]).toBe("private, no-store");
      }
      const failedRestore = await write(
        request(app(ids.staff)).post(`${base}/${revisionId}/restore`),
      )
        .set("If-Match", '"v1"')
        .send({});
      expect(failedRestore.status).toBe(404);
      expect(failedRestore.headers["cache-control"]).toBe("private, no-store");
      const malformed = await write(
        request(app(ids.staff)).post(`${base}/${revisionId}/restore`),
      )
        .set("If-Match", '"v1"')
        .set("Content-Type", "application/json")
        .send("{");
      expect(malformed.status).toBe(400);
      expect(malformed.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("pages metadata without returning stored bodies and fetches selected text", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Paged", bodyMarkdown: "Initial" });
    const id = created.body.data.id as string;
    await pool.query(
      `INSERT INTO content_text_revisions
       (course_id,kind,resource_id,ordinal,resource_version,editor_user_id,title,body_markdown,anonymous)
       SELECT $1,'post',$2,n,n,$3,'Paged',repeat('x',100000),false
       FROM generate_series(2,52) n`,
      [ids.course, id, ids.author],
    );
    const base = `/api/v1/posts/${id}/revisions`;
    const firstPage = await read(request(app()).get(base));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(50);
    expect(firstPage.body.data[0].ordinal).toBe(1);
    expect(firstPage.body.data[49].ordinal).toBe(50);
    expect(firstPage.body.data[49]).not.toHaveProperty("bodyMarkdown");
    expect(firstPage.body.data[49]).not.toHaveProperty("title");
    expect(firstPage.body.page.nextCursor).toBe("50");
    const secondPage = await read(request(app()).get(`${base}?cursor=50`));
    expect(
      secondPage.body.data.map((item: { ordinal: number }) => item.ordinal),
    ).toEqual([51, 52]);
    expect(secondPage.body.page.nextCursor).toBeNull();
    const selected = await read(
      request(app()).get(`${base}/${secondPage.body.data[0].id}`),
    );
    expect(selected.body.data.bodyMarkdown).toHaveLength(100000);
    const compared = await read(
      request(app()).get(
        `${base}/compare?left=${firstPage.body.data[0].id}&right=${secondPage.body.data[1].id}`,
      ),
    );
    expect(compared.body.data.left.bodyMarkdown).toBe("Initial");
    expect(compared.body.data.right.bodyMarkdown).toHaveLength(100000);
    for (const cursor of ["0", "-1", "invalid", "9007199254740992"])
      expect(
        (await read(request(app()).get(`${base}?cursor=${cursor}`))).status,
      ).toBe(400);
  });

  it("checks restore authority before ETag and rejects malformed revision IDs", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Restore access", bodyMarkdown: "Body" });
    const postId = post.body.data.id as string;
    const answer = await write(
      request(app()).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Answer" });
    const followup = await write(
      request(app()).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Followup" });
    for (const [kind, id] of [
      ["answers", answer.body.data.id],
      ["followups", followup.body.data.id],
    ]) {
      const base = `/api/v1/${kind}/${id}/revisions`;
      const list = await read(request(app()).get(base));
      const revisionId = list.body.data[0].id as string;
      const denied = await write(
        request(app()).post(`${base}/${revisionId}/restore`),
      ).send({});
      expect(denied.status).toBe(403);
      const malformed = await write(
        request(app(ids.staff)).post(`${base}/not-a-uuid/restore`),
      )
        .set("If-Match", '"v1"')
        .send({});
      expect(malformed.status).toBe(404);
      expect(
        (await read(request(app(ids.staff)).get(`${base}/not-a-uuid`))).status,
      ).toBe(404);
      expect(
        (
          await read(
            request(app(ids.staff)).get(
              `${base}/compare?left=${revisionId}&right=not-a-uuid`,
            ),
          )
        ).status,
      ).toBe(404);
    }
    const malformedPostRevision = await write(
      request(app(ids.staff)).post(
        `/api/v1/posts/${postId}/revisions/not-a-uuid/restore`,
      ),
    )
      .set("If-Match", '"v1"')
      .send({});
    expect(malformedPostRevision.status).toBe(404);
    const postBase = `/api/v1/posts/${postId}/revisions`;
    expect(
      (await read(request(app(ids.staff)).get(`${postBase}/not-a-uuid`)))
        .status,
    ).toBe(404);
    expect(
      (
        await read(
          request(app(ids.staff)).get(
            `${postBase}/compare?left=not-a-uuid&right=not-a-uuid`,
          ),
        )
      ).status,
    ).toBe(404);
    const malformedPostId = await write(
      request(app(ids.staff)).post(
        "/api/v1/posts/not-a-uuid/revisions/not-a-uuid/restore",
      ),
    )
      .set("If-Match", '"v1"')
      .send({});
    expect(malformedPostId.status).toBe(404);
  });

  it("records an initial post snapshot and a conditional text edit through the public routes", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Original", bodyMarkdown: "First body" });
    expect(created.status).toBe(201);
    const postId = created.body.data.id as string;
    const initial = await read(
      request(app()).get(`/api/v1/posts/${postId}/revisions`),
    );
    expect(initial.status).toBe(200);
    expect(initial.headers["cache-control"]).toBe("private, no-store");
    expect(initial.body.data[0]).not.toHaveProperty("bodyMarkdown");
    expect(
      await fullRevisions(`/api/v1/posts/${postId}/revisions`, initial),
    ).toMatchObject([
      {
        title: "Original",
        bodyMarkdown: "First body",
        editor: { id: ids.author },
      },
    ]);
    const edited = await write(request(app()).patch(`/api/v1/posts/${postId}`))
      .set("If-Match", created.headers.etag)
      .send({ title: "Second" });
    expect(edited.status).toBe(200);
    const history = await read(
      request(app()).get(`/api/v1/posts/${postId}/revisions`),
    );
    expect(
      await fullRevisions(`/api/v1/posts/${postId}/revisions`, history),
    ).toMatchObject([
      { title: "Original" },
      { title: "Second", bodyMarkdown: "First body" },
    ]);
  });

  it("projects editor identities from capture-time anonymity across history routes", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Visibility history",
      bodyMarkdown: "Anonymous text",
      anonymous: true,
    });
    expect(created.status).toBe(201);
    const postId = created.body.data.id as string;
    const named = await write(request(app()).patch(`/api/v1/posts/${postId}`))
      .set("If-Match", created.headers.etag)
      .send({ bodyMarkdown: "Named text", anonymous: false });
    expect(named.status).toBe(200);
    const base = `/api/v1/posts/${postId}/revisions`;
    const afterNaming = await read(request(app(ids.student)).get(base));
    expect(await fullRevisions(base, afterNaming, ids.student)).toMatchObject([
      { bodyMarkdown: "Anonymous text", editor: null },
      { bodyMarkdown: "Named text", editor: { id: ids.author } },
    ]);
    const anonymousAgain = await write(
      request(app()).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", named.headers.etag)
      .send({ bodyMarkdown: "Anonymous again", anonymous: true });
    expect(anonymousAgain.status).toBe(200);
    const studentHistory = await read(request(app(ids.student)).get(base));
    expect(studentHistory.status).toBe(200);
    expect(
      await fullRevisions(base, studentHistory, ids.student),
    ).toMatchObject([
      { bodyMarkdown: "Anonymous text", editor: null },
      { bodyMarkdown: "Named text", editor: { id: ids.author } },
      { bodyMarkdown: "Anonymous again", editor: null },
    ]);
    const [first, second] = studentHistory.body.data as {
      id: string;
    }[];
    const single = await read(
      request(app(ids.student)).get(`${base}/${first.id}`),
    );
    expect(single.body.data.editor).toBeNull();
    const compared = await read(
      request(app(ids.student)).get(
        `${base}/compare?left=${first.id}&right=${second.id}`,
      ),
    );
    expect(compared.body.data).toMatchObject({
      left: { editor: null },
      right: { editor: { id: ids.author } },
    });
    const staffHistory = await read(request(app(ids.staff)).get(base));
    expect(
      staffHistory.body.data.map(
        (item: { editor: { id: string } }) => item.editor.id,
      ),
    ).toEqual([ids.author, ids.author, ids.author]);

    const root = await write(
      request(app()).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Anonymous root", anonymous: true });
    expect(root.status).toBe(201);
    const reply = await write(
      request(app()).post(`/api/v1/followups/${root.body.data.id}/replies`),
    ).send({ bodyMarkdown: "Anonymous reply", anonymous: true });
    expect(reply.status).toBe(201);
    for (const id of [root.body.data.id, reply.body.data.id]) {
      const path = `/api/v1/followups/${id}/revisions`;
      const student = await read(request(app(ids.student)).get(path));
      const staff = await read(request(app(ids.staff)).get(path));
      expect(student.body.data[0].editor).toBeNull();
      expect(staff.body.data[0].editor.id).toBe(ids.author);
    }
  });

  it("captures answer, followup, and reply text while redacting anonymous editors for students", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Discussion", bodyMarkdown: "Body" });
    const postId = post.body.data.id as string;
    const answer = await write(
      request(app()).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Old answer", anonymous: true });
    expect(answer.status).toBe(201);
    const answerId = answer.body.data.id as string;
    const answerEdit = await write(
      request(app()).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: "New answer" });
    expect(answerEdit.status).toBe(200);
    const studentAnswerHistory = await read(
      request(app(ids.student)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    expect(studentAnswerHistory.status).toBe(200);
    expect(
      await fullRevisions(
        `/api/v1/answers/${answerId}/revisions`,
        studentAnswerHistory,
        ids.student,
      ),
    ).toMatchObject([
      { bodyMarkdown: "Old answer", editor: null },
      { bodyMarkdown: "New answer", editor: null },
    ]);
    const answerRevisions = studentAnswerHistory.body.data as { id: string }[];
    const uppercaseAnswerCompare = await read(
      request(app(ids.student)).get(
        `/api/v1/answers/${answerId}/revisions/compare?left=${answerRevisions[0].id.toUpperCase()}&right=${answerRevisions[1].id.toUpperCase()}`,
      ),
    );
    expect(uppercaseAnswerCompare.status).toBe(200);
    expect(uppercaseAnswerCompare.body.data.left.bodyMarkdown).toBe(
      "Old answer",
    );
    expect(uppercaseAnswerCompare.body.data.right.bodyMarkdown).toBe(
      "New answer",
    );
    const staffAnswerHistory = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    expect(staffAnswerHistory.body.data[1].editor.id).toBe(ids.author);

    const followup = await write(
      request(app()).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "First followup" });
    expect(followup.status).toBe(201);
    const followupId = followup.body.data.id as string;
    const reply = await write(
      request(app()).post(`/api/v1/followups/${followupId}/replies`),
    ).send({ bodyMarkdown: "First reply" });
    expect(reply.status).toBe(201);
    const replyId = reply.body.data.id as string;
    const replyHistory = await read(
      request(app(ids.student)).get(`/api/v1/followups/${replyId}/revisions`),
    );
    expect(
      await fullRevisions(
        `/api/v1/followups/${replyId}/revisions`,
        replyHistory,
        ids.student,
      ),
    ).toMatchObject([{ bodyMarkdown: "First reply" }]);
    const edited = await write(
      request(app()).patch(`/api/v1/followups/${followupId}`),
    )
      .set("If-Match", followup.headers.etag)
      .send({ bodyMarkdown: "Second followup" });
    expect(edited.status).toBe(200);
    const followupHistory = await read(
      request(app(ids.student)).get(
        `/api/v1/followups/${followupId}/revisions`,
      ),
    );
    expect(
      await fullRevisions(
        `/api/v1/followups/${followupId}/revisions`,
        followupHistory,
        ids.student,
      ),
    ).toMatchObject([
      { bodyMarkdown: "First followup" },
      { bodyMarkdown: "Second followup" },
    ]);
    const followupRevisions = followupHistory.body.data as { id: string }[];
    const uppercaseFollowupCompare = await read(
      request(app(ids.student)).get(
        `/api/v1/followups/${followupId}/revisions/compare?left=${followupRevisions[0].id.toUpperCase()}&right=${followupRevisions[1].id.toUpperCase()}`,
      ),
    );
    expect(uppercaseFollowupCompare.status).toBe(200);
    expect(uppercaseFollowupCompare.body.data.left.bodyMarkdown).toBe(
      "First followup",
    );
    expect(uppercaseFollowupCompare.body.data.right.bodyMarkdown).toBe(
      "Second followup",
    );
  });

  it("compares revisions and lets staff restore text with a current ETag only", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Before", bodyMarkdown: "Old body" });
    const id = created.body.data.id as string;
    const edited = await write(request(app()).patch(`/api/v1/posts/${id}`))
      .set("If-Match", created.headers.etag)
      .send({ title: "After" });
    expect(edited.status).toBe(200);
    const history = await read(
      request(app()).get(`/api/v1/posts/${id}/revisions`),
    );
    const [first, second] = history.body.data as { id: string }[];
    const compare = await read(
      request(app(ids.student)).get(
        `/api/v1/posts/${id}/revisions/compare?left=${first.id}&right=${second.id}`,
      ),
    );
    expect(compare.status).toBe(200);
    expect(compare.body.data).toMatchObject({
      left: { title: "Before" },
      right: { title: "After" },
    });
    const uppercaseCompare = await read(
      request(app(ids.student)).get(
        `/api/v1/posts/${id}/revisions/compare?left=${first.id.toUpperCase()}&right=${second.id.toUpperCase()}`,
      ),
    );
    expect(uppercaseCompare.status).toBe(200);
    expect(uppercaseCompare.body.data).toEqual(compare.body.data);
    const studentRestore = await write(
      request(app(ids.student)).post(
        `/api/v1/posts/${id}/revisions/${first.id}/restore`,
      ),
    )
      .set("If-Match", edited.headers.etag)
      .send({});
    expect(studentRestore.status).toBe(403);
    const staleRestore = await write(
      request(app(ids.staff)).post(
        `/api/v1/posts/${id}/revisions/${first.id}/restore`,
      ),
    )
      .set("If-Match", created.headers.etag)
      .send({});
    expect(staleRestore.status).toBe(412);
    const restored = await write(
      request(app(ids.staff)).post(
        `/api/v1/posts/${id}/revisions/${first.id}/restore`,
      ),
    )
      .set("If-Match", edited.headers.etag)
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.headers.etag).toBe('"v3"');
    expect(restored.body.data).toMatchObject({
      title: "Before",
      bodyMarkdown: "Old body",
    });
    const after = await read(
      request(app()).get(`/api/v1/posts/${id}/revisions`),
    );
    expect(after.body.data).toHaveLength(3);
    expect(
      (await fullRevisions(`/api/v1/posts/${id}/revisions`, after))[2],
    ).toMatchObject({
      restoredFromRevisionId: first.id,
      editor: { id: ids.staff },
    });
  });

  it("rejects invalid legacy post snapshots without changing the post or history", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Valid title",
      bodyMarkdown: "Valid body",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const initial = await read(
      request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
    );
    const revisionId = initial.body.data[0].id as string;

    for (const [title, bodyMarkdown] of [
      ["x".repeat(201), "Valid body"],
      ["", "Valid body"],
      ["Valid title", "x".repeat(100001)],
      ["Valid title", ""],
    ]) {
      await pool.query(
        "UPDATE content_text_revisions SET baseline=true,title=$2,body_markdown=$3 WHERE id=$1",
        [revisionId, title, bodyMarkdown],
      );
      const restored = await write(
        request(app(ids.staff)).post(
          `/api/v1/posts/${id}/revisions/${revisionId}/restore`,
        ),
      )
        .set("If-Match", created.headers.etag)
        .send({});
      expect(restored.status).toBe(422);
      expect(restored.body.error.code).toBe("validation_failed");
      const saved = await pool.query(
        "SELECT title,body_markdown,version::int AS version FROM posts WHERE id=$1",
        [id],
      );
      expect(saved.rows[0]).toMatchObject({
        title: "Valid title",
        body_markdown: "Valid body",
        version: 1,
      });
      const history = await pool.query(
        "SELECT count(*)::int AS count FROM content_text_revisions WHERE kind='post' AND resource_id=$1",
        [id],
      );
      expect(history.rows[0].count).toBe(1);
    }
  });

  it("rejects invalid legacy answer, root, and reply snapshots without writes", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "question", title: "Discussion", bodyMarkdown: "Body" });
    expect(post.status).toBe(201);
    const postId = post.body.data.id as string;
    const answer = await write(
      request(app()).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Valid answer" });
    const root = await write(
      request(app()).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Valid root" });
    const reply = await write(
      request(app()).post(`/api/v1/followups/${root.body.data.id}/replies`),
    ).send({ bodyMarkdown: "Valid reply" });
    expect(answer.status).toBe(201);
    expect(root.status).toBe(201);
    expect(reply.status).toBe(201);
    for (const [kind, id, etag, original, table, route] of [
      [
        "answer",
        answer.body.data.id,
        answer.headers.etag,
        "Valid answer",
        "answers",
        "answers",
      ],
      [
        "followup",
        root.body.data.id,
        root.headers.etag,
        "Valid root",
        "followups",
        "followups",
      ],
      [
        "followup",
        reply.body.data.id,
        reply.headers.etag,
        "Valid reply",
        "followups",
        "followups",
      ],
    ] as const) {
      const initial = await read(
        request(app(ids.staff)).get(`/api/v1/${route}/${id}/revisions`),
      );
      const revisionId = initial.body.data[0].id as string;
      for (const bodyMarkdown of ["   ", "x".repeat(100001)]) {
        await pool.query(
          "UPDATE content_text_revisions SET baseline=true,body_markdown=$2 WHERE id=$1",
          [revisionId, bodyMarkdown],
        );
        const restored = await write(
          request(app(ids.staff)).post(
            `/api/v1/${route}/${id}/revisions/${revisionId}/restore`,
          ),
        )
          .set("If-Match", etag)
          .send({});
        expect(restored.status).toBe(422);
        expect(restored.body.error.code).toBe("validation_failed");
        const saved = await pool.query(
          `SELECT body_markdown,version::int AS version FROM ${table} WHERE id=$1`,
          [id],
        );
        expect(saved.rows[0]).toMatchObject({
          body_markdown: original,
          version: 1,
        });
        const history = await pool.query(
          "SELECT count(*)::int AS count FROM content_text_revisions WHERE kind=$1 AND resource_id=$2",
          [kind, id],
        );
        expect(history.rows[0].count).toBe(1);
      }
    }
  });

  it("lets a TA restore an instructor answer without lowering its ordinary edit floor", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Staff answer",
      bodyMarkdown: "Question",
    });
    expect(post.status).toBe(201);
    const answer = await write(
      request(app(ids.instructor)).post(
        `/api/v1/posts/${post.body.data.id}/answers`,
      ),
    ).send({ bodyMarkdown: "Original answer" });
    expect(answer.status).toBe(201);
    const answerId = answer.body.data.id as string;
    const firstRevision = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    const revisionId = firstRevision.body.data[0].id as string;
    const edited = await write(
      request(app(ids.instructor)).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: "Revised answer" });
    expect(edited.status).toBe(200);
    const endorsed = await write(
      request(app(ids.instructor)).put(
        `/api/v1/answers/${answerId}/endorsement`,
      ),
    ).set("If-Match", edited.headers.etag);
    expect(endorsed.status).toBe(200);
    expect(endorsed.body.data.endorsedAt).not.toBeNull();
    const creditedBefore = await pool.query(
      "SELECT user_id FROM answer_contributors WHERE answer_id=$1 ORDER BY user_id",
      [answerId],
    );
    const eventsBefore = await pool.query(
      "SELECT user_id FROM answer_contribution_events WHERE answer_id=$1 ORDER BY contributed_at",
      [answerId],
    );
    expect(creditedBefore.rows).toEqual([{ user_id: ids.instructor }]);
    expect(eventsBefore.rows).toEqual([
      { user_id: ids.instructor },
      { user_id: ids.instructor },
    ]);
    const deniedEdit = await write(
      request(app(ids.staff)).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", endorsed.headers.etag)
      .send({ bodyMarkdown: "TA edit" });
    expect(deniedEdit.status).toBe(403);
    const restored = await write(
      request(app(ids.staff)).post(
        `/api/v1/answers/${answerId}/revisions/${revisionId}/restore`,
      ),
    )
      .set("If-Match", endorsed.headers.etag)
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.data.bodyMarkdown).toBe("Original answer");
    expect(restored.body.data.endorsedAt).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT user_id FROM answer_contributors WHERE answer_id=$1 ORDER BY user_id",
          [answerId],
        )
      ).rows,
    ).toEqual(creditedBefore.rows);
    expect(
      (
        await pool.query(
          "SELECT user_id FROM answer_contribution_events WHERE answer_id=$1 ORDER BY contributed_at",
          [answerId],
        )
      ).rows,
    ).toEqual(eventsBefore.rows);
    const deniedAfterRestore = await write(
      request(app(ids.staff)).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", restored.headers.etag)
      .send({ bodyMarkdown: "TA edit" });
    expect(deniedAfterRestore.status).toBe(403);
    const saved = await pool.query(
      "SELECT edit_role_floor FROM answers WHERE id=$1",
      [answerId],
    );
    expect(saved.rows[0].edit_role_floor).toBe("instructor");
    const history = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    expect(history.body.data).toHaveLength(3);
    expect(
      (
        await fullRevisions(
          `/api/v1/answers/${answerId}/revisions`,
          history,
          ids.staff,
        )
      )[2],
    ).toMatchObject({
      bodyMarkdown: "Original answer",
      restoredFromRevisionId: revisionId,
      editor: { id: ids.staff },
    });
  });

  it("audits identical answer restore without clearing endorsement", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Endorsed answer",
      bodyMarkdown: "Question",
    });
    expect(post.status).toBe(201);
    const answer = await write(
      request(app()).post(`/api/v1/posts/${post.body.data.id}/answers`),
    ).send({ bodyMarkdown: "First answer" });
    expect(answer.status).toBe(201);
    const answerId = answer.body.data.id as string;
    const firstRevision = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    const revisionId = firstRevision.body.data[0].id as string;
    const second = await write(
      request(app()).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: "Second answer" });
    const third = await write(
      request(app()).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", second.headers.etag)
      .send({ bodyMarkdown: "First answer" });
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    const endorsed = await write(
      request(app(ids.staff)).put(`/api/v1/answers/${answerId}/endorsement`),
    ).set("If-Match", third.headers.etag);
    expect(endorsed.status).toBe(200);
    const restored = await write(
      request(app(ids.staff)).post(
        `/api/v1/answers/${answerId}/revisions/${revisionId}/restore`,
      ),
    )
      .set("If-Match", endorsed.headers.etag)
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.headers.etag).toBe('"v5"');
    expect(restored.body.data).toMatchObject({
      bodyMarkdown: "First answer",
      endorsedAt: endorsed.body.data.endorsedAt,
      endorsedBy: endorsed.body.data.endorsedBy,
    });
    const history = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    expect(history.body.data).toHaveLength(4);
    expect(
      (
        await fullRevisions(
          `/api/v1/answers/${answerId}/revisions`,
          history,
          ids.staff,
        )
      )[3],
    ).toMatchObject({
      bodyMarkdown: "First answer",
      restoredFromRevisionId: revisionId,
      editor: { id: ids.staff },
    });
    const endorsementEvents = await pool.query(
      "SELECT count(*)::int AS count FROM answer_endorsement_events WHERE answer_id=$1",
      [answerId],
    );
    expect(endorsementEvents.rows[0].count).toBe(1);
  });

  it("restores answer and reply text, then purges deleted content history", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Restore discussion",
      bodyMarkdown: "Body",
    });
    const postId = post.body.data.id as string;
    const answer = await write(
      request(app()).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "Answer first" });
    const answerId = answer.body.data.id as string;
    const answerEdited = await write(
      request(app()).patch(`/api/v1/answers/${answerId}`),
    )
      .set("If-Match", answer.headers.etag)
      .send({ bodyMarkdown: "Answer second" });
    const answerHistory = await read(
      request(app(ids.staff)).get(`/api/v1/answers/${answerId}/revisions`),
    );
    const answerRevisionId = answerHistory.body.data[0].id as string;
    const answerRestore = await write(
      request(app(ids.staff)).post(
        `/api/v1/answers/${answerId}/revisions/${answerRevisionId}/restore`,
      ),
    )
      .set("If-Match", answerEdited.headers.etag)
      .send({});
    expect(answerRestore.status).toBe(200);
    expect(answerRestore.body.data.bodyMarkdown).toBe("Answer first");

    const root = await write(
      request(app()).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Root" });
    const reply = await write(
      request(app()).post(`/api/v1/followups/${root.body.data.id}/replies`),
    ).send({ bodyMarkdown: "Reply first" });
    const replyId = reply.body.data.id as string;
    const replyEdited = await write(
      request(app()).patch(`/api/v1/followups/${replyId}`),
    )
      .set("If-Match", reply.headers.etag)
      .send({ bodyMarkdown: "Reply second" });
    const replyHistory = await read(
      request(app(ids.staff)).get(`/api/v1/followups/${replyId}/revisions`),
    );
    const replyRevisionId = replyHistory.body.data[0].id as string;
    const replyRestore = await write(
      request(app(ids.staff)).post(
        `/api/v1/followups/${replyId}/revisions/${replyRevisionId}/restore`,
      ),
    )
      .set("If-Match", replyEdited.headers.etag)
      .send({});
    expect(replyRestore.status).toBe(200);
    expect(replyRestore.body.data.bodyMarkdown).toBe("Reply first");
    const replyDeleted = await write(
      request(app()).delete(`/api/v1/followups/${replyId}`),
    ).set("If-Match", replyRestore.headers.etag);
    expect(replyDeleted.status).toBe(204);
    expect(
      (
        await read(
          request(app(ids.staff)).get(`/api/v1/followups/${replyId}/revisions`),
        )
      ).status,
    ).toBe(404);
    const stored = await pool.query(
      "SELECT 1 FROM content_text_revisions WHERE kind='followup' AND resource_id=$1",
      [replyId],
    );
    expect(stored.rowCount).toBe(0);
  });

  it("never discloses private, foreign, merged, or deleted post history", async () => {
    const privatePost = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Private history",
      bodyMarkdown: "Secret",
      private: true,
      anonymous: true,
    });
    const id = privatePost.body.data.id as string;
    expect(
      (
        await read(
          request(app(ids.student)).get(`/api/v1/posts/${id}/revisions`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await read(
          request(app(ids.outsider)).get(`/api/v1/posts/${id}/revisions`),
        )
      ).status,
    ).toBe(404);
    const authorHistory = await read(
      request(app()).get(`/api/v1/posts/${id}/revisions`),
    );
    expect(authorHistory.status).toBe(200);
    expect(authorHistory.body.data[0].editor).toBeNull();
    const staffHistory = await read(
      request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
    );
    expect(staffHistory.body.data[0].editor.id).toBe(ids.author);
    const other = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Other", bodyMarkdown: "Other body" });
    const foreignRevision = (
      await read(
        request(app(ids.staff)).get(
          `/api/v1/posts/${other.body.data.id}/revisions`,
        ),
      )
    ).body.data[0].id as string;
    expect(
      (
        await read(
          request(app(ids.staff)).get(
            `/api/v1/posts/${id}/revisions/${foreignRevision}`,
          ),
        )
      ).status,
    ).toBe(404);
    const deleted = await write(
      request(app()).delete(`/api/v1/posts/${id}`),
    ).set("If-Match", privatePost.headers.etag);
    expect(deleted.status).toBe(204);
    expect(
      (await read(request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`)))
        .status,
    ).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM content_text_revisions WHERE resource_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("does not append snapshots for metadata or text-identical saves", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Unchanged", bodyMarkdown: "The same text" });
    const id = created.body.data.id as string;
    const pinned = await write(
      request(app(ids.staff)).patch(`/api/v1/posts/${id}`),
    )
      .set("If-Match", created.headers.etag)
      .send({ pinned: true });
    expect(pinned.status).toBe(200);
    const identical = await write(request(app()).patch(`/api/v1/posts/${id}`))
      .set("If-Match", pinned.headers.etag)
      .send({ title: "Unchanged" });
    expect(identical.status).toBe(200);
    const history = await read(
      request(app()).get(`/api/v1/posts/${id}/revisions`),
    );
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].resourceVersion).toBe(1);
  });

  it("reads history after archive but rejects restore without changing its trail", async () => {
    const created = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Archive", bodyMarkdown: "Stored" });
    const id = created.body.data.id as string;
    const history = await read(
      request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
    );
    const revisionId = history.body.data[0].id as string;
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect(
        (
          await read(
            request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
          )
        ).status,
      ).toBe(200);
      const denied = await write(
        request(app(ids.staff)).post(
          `/api/v1/posts/${id}/revisions/${revisionId}/restore`,
        ),
      )
        .set("If-Match", created.headers.etag)
        .send({});
      expect(denied.status).toBe(409);
      expect(denied.body.error.code).toBe("course_archived");
      expect(
        (
          await read(
            request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
          )
        ).body.data,
      ).toHaveLength(1);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });

  it("hides a confirmed duplicate's retained history until staff unmerge it", async () => {
    const target = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Canonical",
      bodyMarkdown: "Canonical body",
    });
    const source = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Original source",
      bodyMarkdown: "Source body",
    });
    const sourceId = source.body.data.id as string;
    const merged = await write(
      request(app(ids.staff)).patch(`/api/v1/posts/${sourceId}`),
    )
      .set("If-Match", source.headers.etag)
      .send({
        duplicateStatus: "confirmed",
        duplicateOfPostId: target.body.data.id,
      });
    expect(merged.status).toBe(200);
    expect(
      (await read(request(app()).get(`/api/v1/posts/${sourceId}/revisions`)))
        .status,
    ).toBe(404);
    const unmerged = await write(
      request(app(ids.staff)).patch(`/api/v1/posts/${sourceId}`),
    )
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null });
    expect(unmerged.status).toBe(200);
    const history = await read(
      request(app()).get(`/api/v1/posts/${sourceId}/revisions`),
    );
    expect(history.status).toBe(200);
    expect(
      (await fullRevisions(`/api/v1/posts/${sourceId}/revisions`, history))[0]
        .bodyMarkdown,
    ).toBe("Source body");
  });

  it("purges nested answer and reply text when their post is deleted", async () => {
    const post = await write(
      request(app()).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({
      type: "question",
      title: "Delete tree",
      bodyMarkdown: "Parent body",
    });
    const id = post.body.data.id as string;
    const answer = await write(
      request(app()).post(`/api/v1/posts/${id}/answers`),
    ).send({ bodyMarkdown: "Answer history" });
    const root = await write(
      request(app()).post(`/api/v1/posts/${id}/followups`),
    ).send({ bodyMarkdown: "Root history" });
    const reply = await write(
      request(app()).post(`/api/v1/followups/${root.body.data.id}/replies`),
    ).send({ bodyMarkdown: "Reply history" });
    const deleted = await write(
      request(app()).delete(`/api/v1/posts/${id}`),
    ).set("If-Match", post.headers.etag);
    expect(deleted.status).toBe(204);
    const oldIds = [
      id,
      answer.body.data.id,
      root.body.data.id,
      reply.body.data.id,
    ];
    const retained = await pool.query(
      "SELECT resource_id FROM content_text_revisions WHERE resource_id=ANY($1::uuid[])",
      [oldIds],
    );
    expect(retained.rowCount).toBe(0);
    for (const [kind, resourceId] of [
      ["posts", id],
      ["answers", answer.body.data.id],
      ["followups", root.body.data.id],
      ["followups", reply.body.data.id],
    ])
      expect(
        (
          await read(
            request(app(ids.staff)).get(
              `/api/v1/${kind}/${resourceId}/revisions`,
            ),
          )
        ).status,
      ).toBe(404);
  });

  it("redacts an editor whose account is deleted instead of retaining their identifier", async () => {
    const created = await write(
      request(app(ids.student)).post(`/api/v1/courses/${ids.course}/posts`),
    ).send({ type: "note", title: "Editor identity", bodyMarkdown: "Text" });
    const id = created.body.data.id as string;
    const before = await read(
      request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
    );
    expect(before.body.data[0].editor.id).toBe(ids.student);
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.student,
    ]);
    try {
      const after = await read(
        request(app(ids.staff)).get(`/api/v1/posts/${id}/revisions`),
      );
      expect(after.status).toBe(200);
      expect(after.body.data[0].editor).toBeNull();
    } finally {
      await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
        ids.student,
      ]);
    }
  });
});
