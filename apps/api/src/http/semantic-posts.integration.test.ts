import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { runSemanticMigration } from "../database/migrate-semantic.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { PostService } from "../posts/service.js";
import { readEmbeddingConfig } from "../semantic/provider.js";
import { POST_REVISION_SQL, SemanticIndex } from "../semantic/index.js";
import { JobWorker } from "../jobs/worker.js";
import { createApp } from "./app.js";

const url = process.env.TEST_VECTOR_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `semantic_http_${process.pid}_${Date.now()}`;
const orgId = uuidv7();
const userId = uuidv7();
const courseId = uuidv7();
let admin: Pool;
let pool: Pool;
let service: PostService;
let index: SemanticIndex;
let worker: JobWorker;
let providerMock: ReturnType<typeof vi.fn>;
const config = readEmbeddingConfig({
  EMBEDDING_API_KEY: "test",
  EMBEDDING_MODEL: "test",
})!;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "long-secret-for-semantic-search-tests-only",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";
function app(viewerId = userId) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: viewerId,
          email: "member@example.edu",
          displayName: "Member",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: service,
  });
}
const list = (query: string) =>
  request(app())
    .get(`/api/v1/courses/${courseId}/posts?${query}`)
    .set("Cookie", cookie);

async function settleSemanticJobs() {
  for (let attempt = 0; attempt < 30 && !(await index.healthy()); attempt++) {
    if (!(await worker.runOnce())) break;
  }
  expect(await index.healthy()).toBe(true);
}

integration("semantic post search HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await runSemanticMigration(pool);
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'example.edu','Example')",
      [orgId],
    );
    await pool.query(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'member@example.edu','Member','x')",
      [userId, orgId],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','ABCDEFGH')",
      [courseId, orgId, userId],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
      [courseId, userId],
    );
    providerMock = vi.fn(async (inputs: string[]) =>
      inputs.map((text) =>
        text === "spectrometer" ||
        text.toLowerCase().includes("optical instrument")
          ? [1, 0]
          : [0, 1],
      ),
    );
    const provider = { embedMany: providerMock };
    index = new SemanticIndex(pool, config, provider);
    worker = new JobWorker(
      pool,
      "semantic-http-worker",
      undefined,
      undefined,
      undefined,
      undefined,
      index,
    );
    service = new PostService(pool, undefined, index);
    for (const title of [
      "Spectrometer overview",
      "Spectromter overview",
      "Optical instrument overview",
    ])
      await service.create(courseId, userId, {
        type: "question",
        title,
        bodyMarkdown: "Course text",
      });
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("falls back during initial and model-change backfill, then becomes ready through the worker", async () => {
    const initial = await list("q=spectrometer&sort=relevance");
    expect(initial.status).toBe(200);
    expect(
      initial.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Spectrometer overview", "Spectromter overview"]);
    expect(providerMock).not.toHaveBeenCalled();

    const nextConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test",
      EMBEDDING_MODEL: "next-http-generation",
    })!;
    const currentService = service;
    service = new PostService(
      pool,
      undefined,
      new SemanticIndex(pool, nextConfig, { embedMany: providerMock }),
    );
    try {
      const changed = await list("q=spectrometer&sort=relevance");
      expect(changed.status).toBe(200);
      expect(
        changed.body.data.map((post: { title: string }) => post.title),
      ).toEqual(["Spectrometer overview", "Spectromter overview"]);
      expect(providerMock).not.toHaveBeenCalled();
    } finally {
      service = currentService;
    }

    for (let attempt = 0; attempt < 30 && !(await index.healthy()); attempt++) {
      await index.queueBackfillOne();
      await worker.runOnce();
    }
    expect(await index.healthy()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(DISTINCT post_id)::integer AS count FROM post_embeddings WHERE generation=$1",
          [config.generation],
        )
      ).rows[0].count,
    ).toBe(3);
  });

  it("keeps FTS and fuzzy matches ahead of a closer semantic-only match", async () => {
    const response = await list("q=spectrometer&sort=relevance&limit=10");
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((post: { title: string }) => post.title),
    ).toEqual([
      "Spectrometer overview",
      "Spectromter overview",
      "Optical instrument overview",
    ]);
  });

  it("paginates every tier without repeats", async () => {
    const titles: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await list(
        `q=spectrometer&sort=relevance&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(response.status).toBe(200);
      titles.push(response.body.data[0].title);
      cursor = response.body.page.nextCursor;
    } while (cursor);
    expect(titles).toEqual([
      "Spectrometer overview",
      "Spectromter overview",
      "Optical instrument overview",
    ]);
  });

  it("preserves explicit OR meaning but permits a separate semantic query", async () => {
    const lexical = await list("q=spectrometer+OR+diffraction&sort=relevance");
    expect(lexical.status).toBe(200);
    expect(
      lexical.body.data.map((post: { title: string }) => post.title),
    ).not.toContain("Optical instrument overview");
    const expanded = await list(
      "q=spectrometer+OR+diffraction&semanticQuery=optical+instrument&sort=relevance",
    );
    expect(expanded.status).toBe(200);
    expect(
      expanded.body.data.map((post: { title: string }) => post.title),
    ).toContain("Optical instrument overview");
  });

  it("keeps explicit-query lexical order when semantic expansion succeeds or fails", async () => {
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    for (const [id, title, body] of [
      [ids[0], "Interference", "Diffraction"],
      [ids[1], "Lecture notes", "Interference diffraction diffraction"],
      [ids[2], "Diffraction examples", "Interference interference"],
    ])
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question',$4,$5)",
        [id, courseId, userId, title, body],
      );
    const expected = (
      await pool.query<{ id: string }>(
        `SELECT id FROM posts WHERE id=ANY($1::uuid[])
         ORDER BY round(ts_rank_cd(search_vector,websearch_to_tsquery('english',$2))::numeric,6) DESC,id DESC`,
        [ids, "interference OR diffraction"],
      )
    ).rows.map((row) => row.id);
    const query =
      "q=interference+OR+diffraction&semanticQuery=optical+instrument&sort=relevance&limit=10";
    const expanded = await list(query);
    expect(expanded.status).toBe(200);
    expect(
      expanded.body.data
        .map((post: { id: string }) => post.id)
        .filter((id: string) => ids.includes(id)),
    ).toEqual(expected);
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const fallback = await list(query);
    expect(fallback.status).toBe(200);
    expect(fallback.body.data.map((post: { id: string }) => post.id)).toEqual(
      expected,
    );
  });

  it("keeps ordinary title-aware lexical order with and without embeddings", async () => {
    const [titleId, bodyId] = [uuidv7(), uuidv7()].sort();
    for (const [id, title, body] of [
      [titleId, "Quasar", "Lecture notes"],
      [bodyId, "Lecture notes", "Quasar"],
    ])
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question',$4,$5)",
        [id, courseId, userId, title, body],
      );
    const matchingIds = (posts: { id: string }[]) =>
      posts
        .map((post) => post.id)
        .filter((id) => [titleId, bodyId].includes(id));
    const query = "q=quasar&sort=relevance&limit=10";
    const expanded = await list(query);
    expect(expanded.status).toBe(200);
    expect(matchingIds(expanded.body.data)).toEqual([titleId, bodyId]);

    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const failedProvider = await list(query);
    expect(failedProvider.status).toBe(200);
    expect(matchingIds(failedProvider.body.data)).toEqual([titleId, bodyId]);

    const noKey = await new PostService(pool).list(courseId, userId, {
      q: "quasar",
      sort: "relevance",
      limit: 10,
    });
    expect(matchingIds(noKey.data)).toEqual([titleId, bodyId]);
  });

  it("keeps short-query full-text ties in ID order with semantic search", async () => {
    const [titleId, bodyId] = [uuidv7(), uuidv7()].sort();
    for (const [id, title, body] of [
      [titleId, "AI", "A"],
      [bodyId, "A", "AI"],
    ])
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question',$4,$5)",
        [id, courseId, userId, title, body],
      );
    const ranks = await pool.query<{ id: string; rank: string }>(
      `SELECT id,round(ts_rank_cd(search_vector,websearch_to_tsquery('english','AI'))::numeric,6) AS rank
       FROM posts WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[titleId, bodyId]],
    );
    expect(ranks.rows[0]?.rank).toBe(ranks.rows[1]?.rank);
    const matchingIds = (posts: { id: string }[]) =>
      posts
        .map((post) => post.id)
        .filter((id) => [titleId, bodyId].includes(id));
    const query = "q=AI&sort=relevance&limit=20";
    const expanded = await list(query);
    expect(expanded.status).toBe(200);
    expect(matchingIds(expanded.body.data)).toEqual([bodyId, titleId]);
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const failedProvider = await list(query);
    expect(failedProvider.status).toBe(200);
    expect(matchingIds(failedProvider.body.data)).toEqual([bodyId, titleId]);
  });

  it("falls back to lexical and fuzzy matches on provider failure", async () => {
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await list("q=spectrometer&sort=relevance");
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Spectrometer overview", "Spectromter overview"]);
  });

  it("uses only lexical and fuzzy ranking while catch-up or a failed job is pending", async () => {
    const semanticPage = await list("q=spectrometer&sort=relevance&limit=1");
    expect(semanticPage.status).toBe(200);
    expect(semanticPage.body.page.nextCursor).toBeTruthy();
    const postId = (
      await pool.query<{ id: string }>(
        "SELECT id FROM posts WHERE title='Spectrometer overview'",
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [postId, config.generation],
    );
    const stale = await list(
      `q=spectrometer&sort=relevance&limit=1&cursor=${encodeURIComponent(semanticPage.body.page.nextCursor)}`,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("search_restart_required");
    const pending = await list("q=spectrometer&sort=relevance");
    expect(pending.status).toBe(200);
    expect(
      pending.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Spectrometer overview", "Spectromter overview"]);
    await pool.query("DELETE FROM semantic_post_catchup WHERE post_id=$1", [
      postId,
    ]);
    await pool.query(
      "UPDATE jobs SET status='queued',last_error='provider unavailable' WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    const failed = await list("q=spectrometer&sort=relevance");
    expect(failed.status).toBe(200);
    expect(
      failed.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Spectrometer overview", "Spectromter overview"]);
    await pool.query(
      "UPDATE jobs SET last_error=NULL WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    await settleSemanticJobs();
  });

  it("rejects a semantic cursor when the provider fails, then permits lexical restart", async () => {
    const first = await list("q=spectrometer&sort=relevance&limit=2");
    expect(first.status).toBe(200);
    expect(first.body.page.hasMore).toBe(true);
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const second = await list(
      `q=spectrometer&sort=relevance&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("search_restart_required");
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const restarted = await list("q=spectrometer&sort=relevance&limit=2");
    expect(restarted.status).toBe(200);
    expect(
      restarted.body.data.map((post: { title: string }) => post.title),
    ).toEqual(["Spectrometer overview", "Spectromter overview"]);
  });

  it("keeps chronological ordering across semantic and lexical results", async () => {
    const response = await list("q=spectrometer&sort=oldest");
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((post: { title: string }) => post.title),
    ).toEqual([
      "Spectrometer overview",
      "Spectromter overview",
      "Optical instrument overview",
    ]);
  });

  it("excludes other-course, deleted, and confirmed-duplicate vectors before pagination", async () => {
    const otherCourseId = uuidv7();
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Other','HGFEDCBA')",
      [otherCourseId, orgId, userId],
    );
    const hidden: string[] = [];
    for (const [course, title] of [
      [otherCourseId, "Other course optical instrument"],
      [courseId, "Deleted optical instrument"],
      [courseId, "Duplicate optical instrument"],
    ]) {
      const id = uuidv7();
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question',$4,'Private text')",
        [id, course, userId, title],
      );
      await index.indexPost(id);
      hidden.push(id);
    }
    await pool.query(
      "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now() WHERE id=$1",
      [hidden[1]],
    );
    const canonical = await pool.query<{ id: string }>(
      "SELECT id FROM posts WHERE title='Spectrometer overview'",
    );
    await pool.query(
      "UPDATE posts SET duplicate_of_post_id=$2,duplicate_status='confirmed' WHERE id=$1",
      [hidden[2], canonical.rows[0]!.id],
    );
    const titles: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await list(
        `q=spectrometer&sort=relevance&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(response.status).toBe(200);
      titles.push(response.body.data[0].title);
      cursor = response.body.page.nextCursor;
    } while (cursor);
    expect(titles).toEqual([
      "Spectrometer overview",
      "Spectromter overview",
      "Optical instrument overview",
    ]);
  });

  it("invalidates a changed post immediately and queues its new revision", async () => {
    const created = await service.create(courseId, userId, {
      type: "note",
      title: "Unrelated water",
      bodyMarkdown: "Before edit",
    });
    await settleSemanticJobs();
    const before = await list("q=spectrometer&sort=relevance");
    expect(before.body.data.map((post: { id: string }) => post.id)).toContain(
      created.value.id,
    );
    await service.update(created.value.id, userId, '"v1"', {
      bodyMarkdown: "After edit",
    });
    const after = await list("q=spectrometer&sort=relevance");
    expect(
      after.body.data.map((post: { id: string }) => post.id),
    ).not.toContain(created.value.id);
    const jobs = await pool.query(
      "SELECT payload FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1 ORDER BY created_at",
      [created.value.id],
    );
    expect(jobs.rowCount).toBe(2);
    await settleSemanticJobs();
  });

  it("applies pinned and tag filters before tiered pagination", async () => {
    const tagged = await service.create(courseId, userId, {
      type: "question",
      title: "Optical field guide",
      bodyMarkdown: "Course note",
      tags: ["semantic-tag"],
    });
    await settleSemanticJobs();
    await pool.query("UPDATE posts SET pinned=true WHERE id=$1", [
      tagged.value.id,
    ]);
    const filtered = await list(
      "q=spectrometer&sort=relevance&tag=semantic-tag&pinned=true&limit=1",
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((post: { id: string }) => post.id)).toEqual([
      tagged.value.id,
    ]);
    expect(filtered.body.page.hasMore).toBe(false);
    const all = await list("q=spectrometer&sort=relevance&limit=1");
    expect(all.body.data[0].id).toBe(tagged.value.id);
    const replay = await list(
      `q=spectrometer&sort=relevance&tag=semantic-tag&cursor=${encodeURIComponent(all.body.page.nextCursor)}`,
    );
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("invalid_request");
  });

  it("cleans up embeddings without a key and rolls back on cleanup failure", async () => {
    await pool.query(
      "UPDATE course_memberships SET role='instructor' WHERE course_id=$1 AND user_id=$2",
      [courseId, userId],
    );
    const canonical = await service.create(courseId, userId, {
      type: "question",
      title: "Canonical cleanup question",
      bodyMarkdown: "Canonical body",
    });
    const source = await service.create(courseId, userId, {
      type: "question",
      title: "Private duplicate text",
      bodyMarkdown: "Duplicate body",
    });
    const deleted = await service.create(courseId, userId, {
      type: "note",
      title: "Private deleted text",
      bodyMarkdown: "Deleted body",
    });
    await settleSemanticJobs();
    await pool.query(
      "CREATE FUNCTION fail_embedding_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'embedding cleanup failed'; END; $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_embedding_cleanup BEFORE DELETE ON post_embeddings FOR EACH ROW EXECUTE FUNCTION fail_embedding_cleanup()",
    );
    const noKey = new PostService(pool);
    try {
      await expect(
        noKey.update(source.value.id, userId, '"v1"', {
          duplicateStatus: "confirmed",
          duplicateOfPostId: canonical.value.id,
        }),
      ).rejects.toThrow("embedding cleanup failed");
      await expect(
        noKey.delete(deleted.value.id, userId, '"v1"'),
      ).rejects.toThrow("embedding cleanup failed");
    } finally {
      await pool.query(
        "DROP TRIGGER fail_embedding_cleanup ON post_embeddings",
      );
      await pool.query("DROP FUNCTION fail_embedding_cleanup()");
    }
    const unchanged = await pool.query<{
      id: string;
      duplicate_status: string;
      deleted_at: Date | null;
    }>(
      "SELECT id,duplicate_status,deleted_at FROM posts WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[source.value.id, deleted.value.id]],
    );
    expect(unchanged.rows).toHaveLength(2);
    expect(
      unchanged.rows.every(
        (post) => post.duplicate_status === "none" && post.deleted_at === null,
      ),
    ).toBe(true);
    const embeddingsBefore = await pool.query(
      "SELECT post_id FROM post_embeddings WHERE post_id=ANY($1::uuid[])",
      [[source.value.id, deleted.value.id]],
    );
    expect(embeddingsBefore.rowCount).toBe(2);

    await noKey.update(source.value.id, userId, '"v1"', {
      duplicateStatus: "confirmed",
      duplicateOfPostId: canonical.value.id,
    });
    await noKey.delete(deleted.value.id, userId, '"v1"');
    const embeddingsAfter = await pool.query(
      "SELECT post_id FROM post_embeddings WHERE post_id=ANY($1::uuid[])",
      [[source.value.id, deleted.value.id]],
    );
    expect(embeddingsAfter.rowCount).toBe(0);
  });

  it("filters private semantic matches before pagination for each current role and membership", async () => {
    const isolatedCourse = uuidv7();
    const [student, ta, instructor, outsider] = [
      uuidv7(),
      uuidv7(),
      uuidv7(),
      uuidv7(),
    ];
    for (const id of [student, ta, instructor, outsider])
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Compatibility member','x')",
        [id, orgId, `${id}@example.edu`],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Visibility course',$4)",
      [isolatedCourse, orgId, userId, uuidv7().slice(0, 8)],
    );
    for (const [id, role] of [
      [userId, "student"],
      [student, "student"],
      [ta, "ta"],
      [instructor, "instructor"],
    ])
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,$3)",
        [isolatedCourse, id, role],
      );
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    for (const [position, id] of ids.entries()) {
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,private) VALUES($1,$2,$3,'question',$4,'Visibility-sensitive optical text',$5)",
        [
          id,
          isolatedCourse,
          userId,
          `Optical visibility ${position}`,
          position < 2,
        ],
      );
      await index.indexPost(id);
    }
    const read = (viewer: string, cursor?: string) =>
      request(app(viewer))
        .get(
          `/api/v1/courses/${isolatedCourse}/posts?q=spectrometer&sort=relevance&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        )
        .set("Cookie", cookie);
    const publicPage = await read(student);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.data.map((post: { id: string }) => post.id)).toEqual(
      [ids[2]],
    );
    expect(publicPage.body.page).toEqual({ hasMore: false, nextCursor: null });
    for (const viewer of [userId, ta, instructor]) {
      const found: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await read(viewer, cursor ?? undefined);
        expect(response.status).toBe(200);
        found.push(
          ...response.body.data.map((post: { id: string }) => post.id),
        );
        cursor = response.body.page.nextCursor;
      } while (cursor);
      expect(found.sort()).toEqual([...ids].sort());
    }
    const forbidden = await read(outsider);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.data).toBeUndefined();
    expect(
      (
        await request(app(student))
          .get(`/api/v1/posts/${ids[0]}`)
          .set("Cookie", cookie)
      ).status,
    ).toBe(404);
    const published = await request(app(instructor))
      .patch(`/api/v1/posts/${ids[0]}`)
      .set("Cookie", cookie)
      .set("Origin", "https://app.example.edu")
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v1"')
      .send({ private: false, title: "Published optical current revision" });
    expect(published.status).toBe(200);
    const stale = await read(student);
    expect(
      stale.body.data.map((post: { id: string }) => post.id),
    ).not.toContain(ids[0]);
    await settleSemanticJobs();
    const first = await read(student);
    const second = await read(student, first.body.page.nextCursor);
    expect(
      [...first.body.data, ...second.body.data]
        .map((post: { id: string }) => post.id)
        .sort(),
    ).toEqual([ids[0], ids[2]].sort());
    expect(second.body.page.hasMore).toBe(false);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [isolatedCourse, ta],
    );
    expect((await read(ta)).status).toBe(404);
  });

  it("keeps polls lexical-only and excludes stale poll vectors from semantic candidates", async () => {
    const poll = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'poll','Optical ballot','Choose an instrument')",
      [poll, courseId, userId],
    );
    await pool.query("INSERT INTO poll_settings(post_id) VALUES($1)", [poll]);
    await pool.query(
      `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding) SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector FROM posts p WHERE p.id=$1`,
      [poll, config.generation],
    );
    providerMock.mockClear();
    const lexical = await list("q=ballot&type=poll&sort=relevance");
    expect(lexical.status).toBe(200);
    expect(lexical.body.data.map((post: { id: string }) => post.id)).toEqual([
      poll,
    ]);
    expect(providerMock).not.toHaveBeenCalled();
    const expanded = await list("q=spectrometer&sort=relevance&limit=100");
    expect(expanded.status).toBe(200);
    expect(
      expanded.body.data.map((post: { id: string }) => post.id),
    ).not.toContain(poll);
  });
});
