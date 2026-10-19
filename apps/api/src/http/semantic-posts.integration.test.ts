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
import { SemanticIndex } from "../semantic/index.js";
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
function app() {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
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
    const semantic = await pool.query<{ id: string }>(
      "SELECT id FROM posts WHERE title='Optical instrument overview'",
    );
    await index.indexPost(semantic.rows[0]!.id);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
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
      posts.map((post) => post.id).filter((id) => [titleId, bodyId].includes(id));
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
      posts.map((post) => post.id).filter((id) => [titleId, bodyId].includes(id));
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

  it("does not repeat an earlier page if the provider fails mid-pagination", async () => {
    const first = await list("q=spectrometer&sort=relevance&limit=2");
    expect(first.status).toBe(200);
    expect(first.body.page.hasMore).toBe(true);
    providerMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const second = await list(
      `q=spectrometer&sort=relevance&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual([]);
    expect(second.body.page.hasMore).toBe(false);
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
    await index.indexPost(created.value.id);
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
  });

  it("applies pinned and tag filters before tiered pagination", async () => {
    const tagged = await service.create(courseId, userId, {
      type: "question",
      title: "Optical field guide",
      bodyMarkdown: "Course note",
      tags: ["semantic-tag"],
    });
    await index.indexPost(tagged.value.id);
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
});
