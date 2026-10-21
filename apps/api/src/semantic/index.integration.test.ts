import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { runSemanticMigration } from "../database/migrate-semantic.js";
import { readEmbeddingConfig } from "./provider.js";
import { POST_REVISION_SQL, SemanticIndex } from "./index.js";
import { JobWorker } from "../jobs/worker.js";
import { PostService, postEtag } from "../posts/service.js";

const url = process.env.TEST_VECTOR_DATABASE_URL;
const integration = url ? describe : describe.skip;
let schema: string;
let schemaSequence = 0;
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
  beforeEach(async () => {
    schema = `semantic_${process.pid}_${Date.now()}_${schemaSequence++}`;
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
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
      [courseId, userId],
    );
  });
  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("waits for each generation's bounded initial scan and current jobs before becoming healthy", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Legacy question','Needs an embedding')",
      [postId, courseId, userId],
    );
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const first = new SemanticIndex(pool, config, provider);
    expect(await first.healthy()).toBe(false);
    expect(await first.queueBackfillOne()).toBe(true);
    expect(await first.healthy()).toBe(false);
    const firstWorker = new JobWorker(
      pool,
      "first-generation",
      undefined,
      undefined,
      undefined,
      undefined,
      first,
    );
    expect(await firstWorker.runOnce()).toBe(true);
    expect(await first.healthy()).toBe(false);
    expect(await first.queueBackfillOne()).toBe(false);
    expect(await first.healthy()).toBe(true);
    expect(await new SemanticIndex(pool, config, provider).healthy()).toBe(
      true,
    );

    const nextConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "next-generation",
    })!;
    const next = new SemanticIndex(pool, nextConfig, provider);
    expect(await next.healthy()).toBe(false);
    expect(await next.queueBackfillOne()).toBe(true);
    expect(await firstWorker.runOnce()).toBe(false);
    expect(await next.healthy()).toBe(false);
    const nextWorker = new JobWorker(
      pool,
      "next-generation",
      undefined,
      undefined,
      undefined,
      undefined,
      next,
    );
    expect(await nextWorker.runOnce()).toBe(true);
    expect(await next.healthy()).toBe(false);
    expect(await next.queueBackfillOne()).toBe(false);
    expect(await next.healthy()).toBe(true);
  });

  it("keeps a completed scan unhealthy during a current-revision write and failed job", async () => {
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    expect(await index.healthy()).toBe(false);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.healthy()).toBe(true);

    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'note','New note','Updated while ready')",
      [postId, courseId, userId],
    );
    expect(await index.enqueue(pool, postId)).toBe(true);
    expect(await index.healthy()).toBe(false);
    await pool.query(
      "UPDATE jobs SET status='dead',last_error='provider failed' WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(await index.healthy()).toBe(false);
    expect(await index.indexPost(postId)).toBe(true);
    await pool.query(
      "UPDATE jobs SET status='succeeded',last_error=NULL WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(await index.healthy()).toBe(true);
  });

  it("restarts an old worker cursor after a generation lease expires", async () => {
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const workerIndex = new SemanticIndex(pool, config, provider);
    expect(await workerIndex.queueBackfillOne()).toBe(false);
    expect(await workerIndex.healthy()).toBe(true);
    await pool.query(
      "UPDATE semantic_embedding_generations SET last_seen_at=now()-interval '2 days' WHERE generation=$1",
      [config.generation],
    );
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,updated_at) VALUES($1,$2,$3,'note','While absent','Needs backfill','1980-01-01')",
      [postId, courseId, userId],
    );
    const apiIndex = new SemanticIndex(pool, config, provider);
    expect(await apiIndex.healthy()).toBe(false);
    expect(await workerIndex.queueBackfillOne()).toBe(true);
    expect(await workerIndex.healthy()).toBe(false);
    const worker = new JobWorker(
      pool,
      "resumed-worker",
      undefined,
      undefined,
      undefined,
      undefined,
      workerIndex,
    );
    expect(await worker.runOnce()).toBe(true);
    expect(await workerIndex.queueBackfillOne()).toBe(false);
    expect(await apiIndex.healthy()).toBe(true);
  });

  it("does not write or wait on registration for repeated health checks", async () => {
    const heartbeatConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "heartbeat-test-model",
    })!;
    const index = new SemanticIndex(pool, heartbeatConfig, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    await index.healthy();
    const seenAt = async () =>
      (
        await pool.query<{ last_seen_at: string }>(
          "SELECT last_seen_at::text FROM semantic_embedding_generations WHERE generation=$1",
          [heartbeatConfig.generation],
        )
      ).rows[0]!.last_seen_at;
    const before = await seenAt();
    await pool.query("SELECT pg_sleep(0.02)");
    await index.healthy();
    await index.healthy();
    expect(await index.enqueue(pool, uuidv7())).toBe(false);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await seenAt()).toBe(before);

    const blocker = await pool.connect();
    let checking: Promise<boolean> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('semantic_embedding_generations'))",
      );
      checking = index.healthy();
      completed = await Promise.race([
        checking.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1_000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await checking;
    expect(completed).toBe(true);

    await pool.query(
      "UPDATE semantic_embedding_generations SET last_seen_at=now()-interval '2 minutes' WHERE generation=$1",
      [heartbeatConfig.generation],
    );
    const expired = await seenAt();
    await index.healthy();
    expect(await seenAt()).not.toBe(expired);
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

  it("skips whitespace-only chunks of otherwise valid post text", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'note','Chunk',$4)",
      [postId, courseId, userId, `${" ".repeat(2_000)}tail`],
    );
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) =>
        inputs.map((input) => {
          if (!input.trim()) throw new Error("Embedding input is invalid");
          return [1, 0];
        }),
      ),
    };
    const index = new SemanticIndex(pool, config, provider);
    expect(await index.indexPost(postId)).toBe(true);
    expect(
      provider.embedMany.mock.calls.flatMap(([inputs]) => inputs),
    ).toHaveLength(2);
    expect(
      (
        await pool.query(
          "SELECT chunk_ordinal FROM post_embeddings WHERE post_id=$1 ORDER BY chunk_ordinal",
          [postId],
        )
      ).rows,
    ).toEqual([{ chunk_ordinal: 0 }, { chunk_ordinal: 1 }]);
  });

  it("lets only the matching generation worker claim and clear catch-up", async () => {
    const nextConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "rolling-next-model",
    })!;
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const oldIndex = new SemanticIndex(pool, config, provider);
    const nextIndex = new SemanticIndex(pool, nextConfig, provider);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student') ON CONFLICT DO NOTHING",
      [courseId, userId],
    );
    vi.spyOn(nextIndex, "enqueue").mockRejectedValueOnce(
      new Error("enqueue unavailable"),
    );
    const created = await new PostService(pool, undefined, nextIndex).create(
      courseId,
      userId,
      {
        type: "note",
        title: "Rolling generation note",
        bodyMarkdown: "Catch-up belongs to new model",
      },
    );
    const postId = created.value.id;
    vi.spyOn(oldIndex, "enqueue").mockRejectedValueOnce(
      new Error("old enqueue unavailable"),
    );
    const oldEdit = await new PostService(pool, undefined, oldIndex).update(
      postId,
      userId,
      postEtag(created.value),
      { bodyMarkdown: "Old API edit" },
    );
    const noKeyEdit = await new PostService(pool).update(
      postId,
      userId,
      postEtag(oldEdit as typeof created.value),
      { bodyMarkdown: "No-key API edit" },
    );
    expect(noKeyEdit.version).toBe(created.value.version + 2);
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1 ORDER BY generation",
          [postId],
        )
      ).rows,
    ).toEqual(
      [
        { generation: config.generation },
        { generation: nextConfig.generation },
      ].sort((a, b) => a.generation.localeCompare(b.generation)),
    );
    expect(await nextIndex.healthy()).toBe(false);
    expect(await nextIndex.queueBackfillOne()).toBe(true);
    const oldWorker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oldIndex,
    );
    await oldWorker.runOnce();
    expect(
      (
        await pool.query(
          "SELECT status FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1 AND payload->>'generation'=$2",
          [postId, nextConfig.generation],
        )
      ).rows,
    ).toEqual([{ status: "queued" }]);
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
          [postId, nextConfig.generation],
        )
      ).rows,
    ).toEqual([{ generation: nextConfig.generation }]);
    const nextWorker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      nextIndex,
    );
    expect(await nextWorker.runOnce()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT generation FROM post_embeddings WHERE post_id=$1",
          [postId],
        )
      ).rows,
    ).toEqual([{ generation: nextConfig.generation }]);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
          [postId, nextConfig.generation],
        )
      ).rowCount,
    ).toBe(0);
    expect(await nextIndex.queueBackfillOne()).toBe(false);
    expect(await nextIndex.healthy()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1",
          [postId],
        )
      ).rows,
    ).toEqual([{ generation: config.generation }]);
    await pool.query("DELETE FROM semantic_post_catchup WHERE post_id=$1", [
      postId,
    ]);
  });

  it("backfills no-key writes for a newly registered generation", async () => {
    const enabledConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "enabled-after-no-key",
    })!;
    const index = new SemanticIndex(pool, enabledConfig, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    await index.healthy();
    const created = await new PostService(pool).create(courseId, userId, {
      type: "note",
      title: "Previously no key",
      bodyMarkdown: "Stored for later indexing",
    });
    const postId = created.value.id;
    expect(await index.queueBackfillOne()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
          [postId, enabledConfig.generation],
        )
      ).rows,
    ).toEqual([{ generation: enabledConfig.generation }]);
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
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
          [postId, enabledConfig.generation],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT generation FROM post_embeddings WHERE post_id=$1",
          [postId],
        )
      ).rows,
    ).toEqual([{ generation: enabledConfig.generation }]);
    await pool.query("DELETE FROM semantic_post_catchup WHERE post_id=$1", [
      postId,
    ]);
  });

  it("keeps new-generation no-key work after an old worker succeeds", async () => {
    const oldConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "no-key-race-old",
    })!;
    const nextConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "no-key-race-new",
    })!;
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const oldIndex = new SemanticIndex(pool, oldConfig, provider);
    const nextIndex = new SemanticIndex(pool, nextConfig, provider);
    const created = await new PostService(pool, undefined, oldIndex).create(
      courseId,
      userId,
      {
        type: "note",
        title: "No-key rolling race",
        bodyMarkdown: "Before edit",
      },
    );
    const postId = created.value.id;
    await nextIndex.healthy();
    expect(await nextIndex.indexPost(postId)).toBe(true);
    const oldRevision = (
      await pool.query(
        "SELECT source_revision FROM post_embeddings WHERE post_id=$1 AND generation=$2",
        [postId, nextConfig.generation],
      )
    ).rows[0]!.source_revision;
    await new PostService(pool).update(
      postId,
      userId,
      postEtag(created.value),
      { bodyMarkdown: "After no-key edit" },
    );
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1 AND generation IN ($2,$3) ORDER BY generation",
          [postId, oldConfig.generation, nextConfig.generation],
        )
      ).rows,
    ).toHaveLength(2);
    const oldWorker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oldIndex,
    );
    expect(await oldWorker.runOnce()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT generation FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
          [postId, nextConfig.generation],
        )
      ).rows,
    ).toEqual([{ generation: nextConfig.generation }]);
    expect(await nextIndex.healthy()).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT source_revision FROM post_embeddings WHERE post_id=$1 AND generation=$2",
          [postId, nextConfig.generation],
        )
      ).rows[0]!.source_revision,
    ).toBe(oldRevision);
    expect(await nextIndex.queueBackfillOne()).toBe(true);
    const nextWorker = new JobWorker(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      nextIndex,
    );
    expect(await nextWorker.runOnce()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT e.source_revision FROM post_embeddings e WHERE e.post_id=$1 AND e.generation=$2",
          [postId, nextConfig.generation],
        )
      ).rows[0]!.source_revision,
    ).not.toBe(oldRevision);
    expect(await nextIndex.queueBackfillOne()).toBe(false);
    expect(await nextIndex.healthy()).toBe(true);
  });

  it("backfills an existing post through the durable job worker", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at) VALUES($1,$2,$3,'note','Legacy note','Already existed before opt-in','1970-01-01','1970-01-01')",
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

  it("recovers an enqueue failure committed behind the backfill high-water mark", async () => {
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    let reachedEnqueue!: () => void;
    let resumeEnqueue!: () => void;
    const reached = new Promise<void>((resolve) => (reachedEnqueue = resolve));
    const resume = new Promise<void>((resolve) => (resumeEnqueue = resolve));
    vi.spyOn(index, "enqueue").mockImplementationOnce(async () => {
      reachedEnqueue();
      await resume;
      throw new Error("enqueue unavailable");
    });
    const service = new PostService(pool, undefined, index);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student') ON CONFLICT DO NOTHING",
      [courseId, userId],
    );
    const creating = service.create(courseId, userId, {
      type: "note",
      title: "In-flight catch-up",
      bodyMarkdown: "Persist despite enqueue failure",
    });
    await reached;
    const anchorId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,updated_at) VALUES($1,$2,$3,'note','Cursor anchor','Already indexed',now()+interval '1 minute')",
      [anchorId, courseId, userId],
    );
    await pool.query(
      `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding)
       SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector FROM posts p WHERE p.id=$1`,
      [anchorId, config.generation],
    );
    for (let i = 0; i < 20; i++) await index.queueBackfillOne();
    resumeEnqueue();
    const created = await creating;
    const postId = created.value.id;
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
          [postId],
        )
      ).rowCount,
    ).toBe(1);
    expect(await index.queueBackfillOne()).toBe(true);
    expect(await index.indexPost(postId)).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
          [postId],
        )
      ).rowCount,
    ).toBe(0);
    await pool.query(
      "DELETE FROM jobs WHERE kind='index_post' AND status='queued'",
    );
  });

  it("advances across bounded indexed batches before enqueuing a later post", async () => {
    const indexedIds = Array.from({ length: 100 }, () => uuidv7());
    await pool.query(
      `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at)
       SELECT input.id,$1,$2,'note','Indexed batch','Already embedded','1990-01-01'::timestamptz,'1990-01-01'::timestamptz
       FROM unnest($3::uuid[]) AS input(id)`,
      [courseId, userId, indexedIds],
    );
    await pool.query(
      `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding)
       SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector
       FROM posts p WHERE p.id=ANY($1::uuid[])`,
      [indexedIds, config.generation],
    );
    const targetId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at) VALUES($1,$2,$3,'note','Later post','Needs backfill','1990-01-02','1990-01-02')",
      [targetId, courseId, userId],
    );
    const nextId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at) VALUES($1,$2,$3,'note','Next post','Also needs backfill','1990-01-03','1990-01-03')",
      [nextId, courseId, userId],
    );
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.queueBackfillOne()).toBe(true);
    expect(await index.queueBackfillOne()).toBe(true);
    const queued = await pool.query(
      "SELECT payload->>'postId' AS post_id FROM jobs WHERE kind='index_post' AND payload->>'postId'=ANY($1::text[]) AND status='queued' ORDER BY payload->>'postId'",
      [[targetId, nextId]],
    );
    expect(queued.rows.map((row) => row.post_id)).toEqual(
      [targetId, nextId].sort(),
    );
    await pool.query(
      "UPDATE posts SET body_markdown='Revised after scan',updated_at='1990-01-04' WHERE id=$1",
      [indexedIds[0]],
    );
    expect(await index.queueBackfillOne()).toBe(true);
    const edited = await pool.query(
      "SELECT 1 FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1 AND status='queued'",
      [indexedIds[0]],
    );
    expect(edited.rowCount).toBe(1);
    await pool.query(
      "DELETE FROM jobs WHERE kind='index_post' AND payload->>'postId'=ANY($1::text[])",
      [[targetId, nextId, indexedIds[0]]],
    );
  });

  it("completes bounded backfill across equal microsecond timestamps", async () => {
    const ids = Array.from({ length: 101 }, () => uuidv7());
    await pool.query(
      `INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at)
       SELECT input.id,$1,$2,'note','Indexed note','Already embedded',$4::timestamptz,$4::timestamptz
       FROM unnest($3::uuid[]) AS input(id)`,
      [courseId, userId, ids, "2000-01-01T00:00:00.123456Z"],
    );
    await pool.query(
      `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding)
       SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector
       FROM posts p WHERE p.id=ANY($1::uuid[])`,
      [ids, config.generation],
    );
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    expect(await index.healthy()).toBe(false);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.healthy()).toBe(false);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.healthy()).toBe(true);

    const nextConfig = readEmbeddingConfig({
      EMBEDDING_API_KEY: "test-key",
      EMBEDDING_MODEL: "microsecond-next-generation",
    })!;
    const ordered = [...ids].sort();
    await pool.query(
      `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding)
       SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector
       FROM posts p WHERE p.id=ANY($1::uuid[])`,
      [ordered.slice(0, 100), nextConfig.generation],
    );
    const nextIndex = new SemanticIndex(pool, nextConfig, {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    });
    expect(await nextIndex.queueBackfillOne()).toBe(false);
    expect(await nextIndex.queueBackfillOne()).toBe(true);
    const nextWorker = new JobWorker(
      pool,
      "microsecond-next-worker",
      undefined,
      undefined,
      undefined,
      undefined,
      nextIndex,
    );
    expect(await nextWorker.runOnce()).toBe(true);
    expect(await nextIndex.queueBackfillOne()).toBe(false);
    expect(await nextIndex.healthy()).toBe(true);
  });

  it("stays idle after a complete sweep and processes newly updated posts", async () => {
    const idleSchema = `${schema}_idle`;
    await admin.query(`CREATE SCHEMA "${idleSchema}"`);
    const isolated = new Pool({
      connectionString: url,
      options: `--search_path="${idleSchema}"`,
    });
    try {
      await runMigrations(isolated, getMigrationDirectory());
      await runSemanticMigration(isolated);
      await isolated.query(
        "INSERT INTO organizations(id,domain,name) VALUES($1,'idle.example.edu','Idle')",
        [orgId],
      );
      await isolated.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'idle@example.edu','Idle','x')",
        [userId, orgId],
      );
      await isolated.query(
        "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Idle course','HGFEDCBA')",
        [courseId, orgId, userId],
      );
      const indexedId = uuidv7();
      await isolated.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,updated_at) VALUES($1,$2,$3,'note','Indexed post','Already covered','1970-01-01')",
        [indexedId, courseId, userId],
      );
      await isolated.query(
        `INSERT INTO post_embeddings(post_id,generation,source_revision,chunk_ordinal,embedding)
         SELECT p.id,$2,${POST_REVISION_SQL},0,'[1,0]'::public.vector
         FROM posts p WHERE p.id=$1`,
        [indexedId, config.generation],
      );
      const index = new SemanticIndex(isolated, config, {
        embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
      });
      expect(await index.queueBackfillOne()).toBe(false);
      expect(await index.queueBackfillOne()).toBe(false);

      const oldId = uuidv7();
      await isolated.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,updated_at) VALUES($1,$2,$3,'note','Old timestamp','Not a new change','1960-01-01')",
        [oldId, courseId, userId],
      );
      expect(await index.queueBackfillOne()).toBe(false);
      const freshId = uuidv7();
      await isolated.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,updated_at) VALUES($1,$2,$3,'note','Fresh update','Needs a job','1980-01-01')",
        [freshId, courseId, userId],
      );
      expect(await index.queueBackfillOne()).toBe(true);
      const jobs = await isolated.query<{ post_id: string }>(
        "SELECT payload->>'postId' AS post_id FROM jobs WHERE kind='index_post'",
      );
      expect(jobs.rows).toEqual([{ post_id: freshId }]);
      await isolated.query(
        "UPDATE jobs SET status='dead',updated_at=now()-interval '2 hours' WHERE kind='index_post' AND payload->>'postId'=$1",
        [freshId],
      );
      expect(await index.queueBackfillOne()).toBe(true);
      const retried = await isolated.query<{ status: string }>(
        "SELECT status FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1",
        [freshId],
      );
      expect(retried.rows).toEqual([{ status: "queued" }]);
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${idleSchema}" CASCADE`);
    }
  });

  it("requeues a succeeded revision after reversion or duplicate unmerge removes its embeddings", async () => {
    const postId = uuidv7();
    const canonicalId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,created_at,updated_at) VALUES($1,$2,$3,'question','Returning revision','Original body','1980-01-01','1980-01-01')",
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

    await pool.query(
      "UPDATE posts SET body_markdown='Edited body' WHERE id=$1",
      [postId],
    );
    expect(await index.indexPost(postId)).toBe(true);
    await pool.query(
      "UPDATE posts SET body_markdown='Original body' WHERE id=$1",
      [postId],
    );
    expect(await index.enqueue(pool, postId)).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT status FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1",
          [postId],
        )
      ).rows[0]?.status,
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
    await pool.query("DELETE FROM post_embeddings WHERE post_id=$1", [postId]);
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
    await pool.query(
      "DELETE FROM jobs WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
  });

  it("retries a provider failure without rolling back the post", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Retry note','Still searchable lexically')",
      [postId, courseId, userId],
    );
    let unavailable = true;
    const index = new SemanticIndex(pool, config, {
      embedMany: vi.fn(async () => {
        if (unavailable) throw new Error("provider unavailable");
        return [[1, 0]];
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
    expect(await index.healthy()).toBe(false);
    expect(
      (await pool.query("SELECT title FROM posts WHERE id=$1", [postId]))
        .rows[0].title,
    ).toBe("Retry note");
    await pool.query(
      "UPDATE jobs SET status='dead',updated_at=now()-interval '2 hours' WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(await index.enqueue(pool, postId)).toBe(true);
    expect(await index.healthy()).toBe(false);
    unavailable = false;
    await pool.query(
      "UPDATE jobs SET available_at=now() WHERE kind='index_post' AND payload->>'postId'=$1",
      [postId],
    );
    expect(await worker.runOnce()).toBe(true);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.healthy()).toBe(true);
  });

  it("keeps poll writes, stale indexing jobs and backfill outside semantic ownership", async () => {
    await pool.query(
      "UPDATE course_memberships SET role='instructor' WHERE course_id=$1 AND user_id=$2",
      [courseId, userId],
    );
    const provider = {
      embedMany: vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0])),
    };
    const index = new SemanticIndex(pool, config, provider);
    const poll = await new PostService(pool, undefined, index).create(
      courseId,
      userId,
      {
        type: "poll",
        title: "Instrument ballot",
        bodyMarkdown: "Choose a device",
        options: ["Alpha", "Beta"],
      },
    );
    expect(
      (await pool.query("SELECT 1 FROM jobs WHERE kind='index_post'")).rowCount,
    ).toBe(0);
    expect(await index.enqueue(pool, poll.value.id)).toBe(false);
    expect(await index.indexPost(poll.value.id)).toBe(false);
    expect(await index.queueBackfillOne()).toBe(false);
    expect(provider.embedMany).not.toHaveBeenCalled();
    await pool.query(
      "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2)",
      [poll.value.id, config.generation],
    );
    await pool.query(
      `INSERT INTO jobs(id,kind,payload,deduplication_key,last_error,status) SELECT $1,'index_post',$2,p.id::text||':'||$3||':'||${POST_REVISION_SQL},'obsolete poll failure','dead' FROM posts p WHERE p.id=$4`,
      [
        uuidv7(),
        JSON.stringify({
          postId: poll.value.id,
          generation: config.generation,
        }),
        config.generation,
        poll.value.id,
      ],
    );
    expect(await index.queueBackfillOne()).toBe(false);
    expect(await index.healthy()).toBe(true);
    await pool.query(
      "UPDATE jobs SET status='queued',last_error=NULL WHERE kind='index_post'",
    );
    const worker = new JobWorker(
      pool,
      "poll-filter-worker",
      undefined,
      undefined,
      undefined,
      undefined,
      index,
    );
    expect(await worker.runOnce()).toBe(true);
    expect(provider.embedMany).not.toHaveBeenCalled();
    expect(
      (
        await pool.query("SELECT 1 FROM post_embeddings WHERE post_id=$1", [
          poll.value.id,
        ])
      ).rowCount,
    ).toBe(0);
    const noKey = await new PostService(pool).create(courseId, userId, {
      type: "poll",
      title: "No-key ballot",
      bodyMarkdown: "Choose again",
      options: ["One", "Two"],
    });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM semantic_post_catchup WHERE post_id=$1",
          [noKey.value.id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
