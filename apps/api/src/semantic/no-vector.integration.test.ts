import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { PostService } from "../posts/service.js";
import { SemanticIndex } from "./index.js";
import { readEmbeddingConfig } from "./provider.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `semantic_fallback_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const orgId = uuidv7();
const userId = uuidv7();
const courseId = uuidv7();

integration("configured embeddings without optional schema", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
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
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("keeps the lexical path and skips provider calls and jobs", async () => {
    const provider = {
      embedMany: vi.fn(async () => {
        throw new Error("Provider must not be called");
      }),
    };
    const config = readEmbeddingConfig({
      EMBEDDING_API_KEY: "configured",
      EMBEDDING_MODEL: "test",
    })!;
    const semantic = new SemanticIndex(pool, config, provider);
    const service = new PostService(pool, undefined, semantic);
    const post = await service.create(courseId, userId, {
      type: "question",
      title: "Spectrometer",
      bodyMarkdown: "Lab instructions",
    });
    const results = await service.list(courseId, userId, {
      q: "spectrometer",
      semanticQuery: "optical instrument",
      sort: "relevance",
      limit: 10,
    });
    expect(results.data.map((item) => item.id)).toEqual([post.value.id]);
    expect(provider.embedMany).not.toHaveBeenCalled();
    const jobs = await pool.query("SELECT 1 FROM jobs WHERE kind='index_post'");
    expect(jobs.rowCount).toBe(0);
    const pending = await pool.query(
      "SELECT generation FROM semantic_post_catchup WHERE post_id=$1",
      [post.value.id],
    );
    expect(pending.rowCount).toBe(1);
    expect(pending.rows[0]?.generation).toBe(config.generation);
  });

  it("fans out no-key catch-up to a registered generation", async () => {
    const created = await new PostService(pool).create(courseId, userId, {
      type: "note",
      title: "No-key note",
      bodyMarkdown: "Index after enabling a provider",
    });
    const pending = await pool.query(
      "SELECT generation FROM semantic_post_catchup WHERE post_id=$1",
      [created.value.id],
    );
    expect(pending.rows).toEqual([
      {
        generation: readEmbeddingConfig({
          EMBEDDING_API_KEY: "configured",
          EMBEDDING_MODEL: "test",
        })!.generation,
      },
    ]);
  });

  it("does not fail a post write when optional indexing is unavailable", async () => {
    const unavailable = {
      config: readEmbeddingConfig({ EMBEDDING_API_KEY: "configured" }),
      enqueue: vi.fn(async () => {
        throw new Error("optional index unavailable");
      }),
    } as unknown as SemanticIndex;
    const service = new PostService(pool, undefined, unavailable);
    const created = await service.create(courseId, userId, {
      type: "note",
      title: "Fallback note",
      bodyMarkdown: "Still saved",
    });
    expect(created.status).toBe(201);
    const row = await pool.query("SELECT title FROM posts WHERE id=$1", [
      created.value.id,
    ]);
    expect(row.rows[0]?.title).toBe("Fallback note");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
          [created.value.id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
