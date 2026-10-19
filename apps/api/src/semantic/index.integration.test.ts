import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { runSemanticMigration } from "../database/migrate-semantic.js";
import { readEmbeddingConfig } from "./provider.js";
import { SemanticIndex } from "./index.js";
import { JobWorker } from "../jobs/worker.js";

const url = process.env.TEST_VECTOR_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `semantic_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
const courseId = uuidv7();
const userId = uuidv7();
const orgId = uuidv7();
const config = readEmbeddingConfig({
  EMBEDDING_API_KEY: "test-key",
  EMBEDDING_MODEL: "test-model",
})!;

integration("semantic post indexing", () => {
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
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'test@example.edu','Test','x')",
      [userId, orgId],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','ABCDEFGH')",
      [courseId, orgId, userId],
    );
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("stores chunks but not stale vectors after a concurrent text edit", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Wave mechanics','Interference patterns')",
      [postId, courseId, userId],
    );
    const provider = {
      embedMany: vi.fn(async () => {
        await pool.query(
          "UPDATE posts SET body_markdown='Diffraction instead',version=version+1 WHERE id=$1",
          [postId],
        );
        return [[1, 0]];
      }),
    };
    const index = new SemanticIndex(pool, config, provider);
    await index.indexPost(postId);
    const rows = await pool.query(
      "SELECT * FROM post_embeddings WHERE post_id=$1",
      [postId],
    );
    expect(rows.rows).toHaveLength(0);
    expect(provider.embedMany).toHaveBeenCalled();
  });

  it("stores current bounded post chunks and generation", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'note','Wave notes','Interference patterns')",
      [postId, courseId, userId],
    );
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const index = new SemanticIndex(pool, config, provider);
    await index.indexPost(postId);
    const rows = await pool.query(
      "SELECT generation,source_revision,chunk_ordinal,embedding::text AS vector FROM post_embeddings WHERE post_id=$1",
      [postId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      generation: config.generation,
      chunk_ordinal: 0,
      vector: "[1,0]",
    });
    expect(provider.embedMany.mock.calls[0]![0][0]).toContain("Wave notes");
    expect(provider.embedMany.mock.calls[0]![0][0]).not.toContain(userId);
  });

  it("backfills an existing post through the durable job worker", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'note','Legacy note','Already existed before opt-in')",
      [postId, courseId, userId],
    );
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const index = new SemanticIndex(pool, config, provider);
    expect(await index.queueBackfillOne()).toBe(true);
    const worker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      index,
    );
    for (let i = 0; i < 5; i++) await worker.runOnce();
    const stored = await pool.query(
      "SELECT 1 FROM post_embeddings WHERE post_id=$1",
      [postId],
    );
    expect(stored.rowCount).toBeGreaterThan(0);
    expect(provider.embedMany).toHaveBeenCalled();
  });

  it("requeues a succeeded revision after reversion or duplicate unmerge removes its embeddings", async () => {
    const postId = uuidv7();
    const canonicalId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at) VALUES($1,$2,$3,'question','Returning revision','Original body','2000-01-01')",
      [postId, courseId, userId],
    );
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Canonical question','Canonical body')",
      [canonicalId, courseId, userId],
    );
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    expect(await index.enqueue(pool, postId)).toBe(true);
    expect(await index.indexPost(postId)).toBe(true);
    await pool.query(
      "UPDATE jobs SET status='succeeded' WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(await index.enqueue(pool, postId)).toBe(false);

    await pool.query("UPDATE posts SET body_markdown='Edited body' WHERE id=$1", [postId]);
    expect(await index.indexPost(postId)).toBe(true);
    await pool.query("UPDATE posts SET body_markdown='Original body' WHERE id=$1", [postId]);
    expect(await index.enqueue(pool, postId)).toBe(true);
    expect(
      (await pool.query(
        "SELECT status FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1",
        [postId],
      )).rows[0]?.status,
    ).toBe("queued");

    expect(await index.indexPost(postId)).toBe(true);
    await pool.query(
      "UPDATE jobs SET status='succeeded' WHERE kind='index_post' AND payload->>'postId'=$1 AND status='queued'",
      [postId],
    );
    await pool.query(
      "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
      [postId, canonicalId],
    );
    await index.removePost(pool, postId);
    await pool.query(
      "UPDATE posts SET duplicate_status='none',duplicate_of_post_id=NULL WHERE id=$1",
      [postId],
    );
    expect(await index.queueBackfillOne()).toBe(true);
    const jobs = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1 AND status='queued'",
      [postId],
    );
    expect(jobs.rowCount).toBe(1);
  });

  it("retries a provider failure without rolling back the post", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Retry note','Still searchable lexically')",
      [postId, courseId, userId],
    );
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });
    expect(await index.enqueue(pool, postId)).toBe(true);
    const worker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      index,
    );
    expect(await worker.runOnce()).toBe(true);
    const job = await pool.query(
      "SELECT status,attempts FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(job.rows).toEqual([{ status: "queued", attempts: 1 }]);
    expect(
      (await pool.query("SELECT title FROM posts WHERE id=$1", [postId]))
        .rows[0].title,
    ).toBe("Retry note");
  });
});
