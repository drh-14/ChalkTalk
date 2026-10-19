import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { EmbeddingConfig } from "./provider.js";

type Db = Pool | PoolClient;
type BatchProvider = {
  embedMany(inputs: string[], timeoutMs?: number): Promise<number[][]>;
};
export type SearchEmbedding = {
  generation: string;
  vector: string;
  dimensions: number;
};
export const POST_REVISION_SQL =
  "encode(sha256(convert_to(length(p.title)::text || ':' || p.title || p.body_markdown,'UTF8')),'hex')";

function chunks(title: string, body: string): string[] {
  const content = `${title}\n${body}`;
  const parts: string[] = [];
  for (let offset = 0; offset < content.length; offset += 1_000) {
    const part = content.slice(offset, offset + 1_000);
    if (part.trim()) parts.push(part);
  }
  return parts;
}

export class SemanticIndex {
  private backfillCursor?: { updatedAt: Date; id: string };

  constructor(
    private readonly pool: Pool,
    readonly config: EmbeddingConfig,
    private readonly provider: BatchProvider,
  ) {}

  private async registerGeneration(db: Db): Promise<void> {
    const active = await db.query<{ fresh: boolean }>(
      "SELECT last_seen_at >= now()-interval '1 minute' AS fresh FROM semantic_embedding_generations WHERE generation=$1",
      [this.config.generation],
    );
    if (active.rows[0]?.fresh) return;
    const ownTransaction = db === this.pool;
    const client = ownTransaction ? await this.pool.connect() : db;
    try {
      if (ownTransaction) await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('semantic_embedding_generations'))",
      );
      const previous = await client.query<{ stale: boolean; fresh: boolean }>(
        "SELECT last_seen_at < now()-interval '1 day' AS stale, last_seen_at >= now()-interval '1 minute' AS fresh FROM semantic_embedding_generations WHERE generation=$1",
        [this.config.generation],
      );
      if (!previous.rowCount || previous.rows[0]?.stale)
        this.backfillCursor = undefined;
      if (!previous.rows[0]?.fresh)
        await client.query(
          "INSERT INTO semantic_embedding_generations(generation) VALUES($1) ON CONFLICT (generation) DO UPDATE SET last_seen_at=now()",
          [this.config.generation],
        );
      if (ownTransaction) await client.query("COMMIT");
    } catch (error) {
      if (ownTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownTransaction) (client as PoolClient).release();
    }
  }

  async available(db: Db = this.pool): Promise<boolean> {
    const result = await db.query<{ relation: string | null }>(
      "SELECT to_regclass('post_embeddings')::text AS relation",
    );
    return Boolean(result.rows[0]?.relation);
  }

  async healthy(): Promise<boolean> {
    await this.registerGeneration(this.pool);
    const result = await this.pool.query<{ unhealthy: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM semantic_post_catchup
                      WHERE generation=$1 LIMIT 1)
         OR EXISTS (
           SELECT 1 FROM jobs j JOIN posts p ON p.id=(j.payload->>'postId')::uuid
           WHERE j.kind='index_post' AND j.status <> 'succeeded'
             AND j.last_error IS NOT NULL AND j.payload->>'generation'=$1
             AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
             AND j.deduplication_key=p.id::text||':'||$1||':'||${POST_REVISION_SQL}
           LIMIT 1
         ) AS unhealthy`,
      [this.config.generation],
    );
    return !result.rows[0]?.unhealthy;
  }

  async enqueue(db: Db, postId: string): Promise<boolean> {
    await this.registerGeneration(db);
    if (!(await this.available(db))) return false;
    const source = await db.query<{ source_revision: string }>(
      `SELECT ${POST_REVISION_SQL} AS source_revision FROM posts p
       WHERE p.id=$1 AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'`,
      [postId],
    );
    const revision = source.rows[0]?.source_revision;
    if (!revision) return false;
    const key = `${postId}:${this.config.generation}:${revision}`;
    const queued = await db.query(
      `INSERT INTO jobs (id,kind,payload,deduplication_key)
       VALUES ($1,'index_post',$2,$3)
       ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL
       DO UPDATE SET status='queued', attempts=0, available_at=now(),
         locked_by=NULL,locked_until=NULL,finished_at=NULL,updated_at=now()
       WHERE (jobs.status='dead' AND jobs.updated_at < now()-interval '1 hour')
          OR (jobs.status='succeeded' AND (
            EXISTS (SELECT 1 FROM semantic_post_catchup d
                    WHERE d.post_id=$4 AND d.generation=$5)
            OR NOT EXISTS (
              SELECT 1 FROM post_embeddings e WHERE e.post_id=$4
                AND e.generation=$5 AND e.source_revision=$6
            )
          ))
       RETURNING id`,
      [
        uuidv7(),
        { postId, generation: this.config.generation, revision },
        key,
        postId,
        this.config.generation,
        revision,
      ],
    );
    return queued.rowCount === 1;
  }

  async queueBackfillOne(): Promise<boolean> {
    await this.registerGeneration(this.pool);
    if (!(await this.available())) return false;
    const pending = await this.pool.query<{
      post_id: string;
    }>(
      `SELECT d.post_id FROM semantic_post_catchup d
       JOIN posts p ON p.id=d.post_id
       WHERE p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
         AND d.generation=$1
         AND NOT EXISTS (
           SELECT 1 FROM jobs j WHERE j.kind='index_post'
             AND j.deduplication_key=p.id::text||':'||$1||':'||${POST_REVISION_SQL}
             AND (j.status IN ('queued','running')
               OR (j.status='dead' AND j.updated_at >= now()-interval '1 hour'))
         )
       ORDER BY d.post_id LIMIT 1`,
      [this.config.generation],
    );
    if (pending.rows[0]) {
      const postId = pending.rows[0].post_id;
      if (await this.enqueue(this.pool, postId)) return true;
    }
    const after = this.backfillCursor;
    const scanned = await this.pool.query<{
      id: string;
      updated_at: Date;
      needs_enqueue: boolean;
    }>(
      `WITH batch AS MATERIALIZED (
         SELECT p.id,p.updated_at,p.title,p.body_markdown
         FROM posts p
         WHERE p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
           ${after ? "AND (p.updated_at,p.id)>($2::timestamptz,$3::uuid)" : ""}
         ORDER BY p.updated_at,p.id LIMIT 100
       ), revisions AS MATERIALIZED (
         SELECT p.id,p.updated_at,${POST_REVISION_SQL} AS source_revision
         FROM batch p
       )
       SELECT p.id,p.updated_at,
         NOT EXISTS (
           SELECT 1 FROM post_embeddings e WHERE e.post_id=p.id
             AND e.generation=$1 AND e.source_revision=p.source_revision
         ) AND NOT EXISTS (
           SELECT 1 FROM jobs j WHERE j.kind='index_post'
             AND j.deduplication_key=p.id::text||':'||$1||':'||p.source_revision
             AND (j.status IN ('queued','running')
               OR (j.status='dead' AND j.updated_at >= now()-interval '1 hour'))
         ) AS needs_enqueue
       FROM revisions p ORDER BY p.updated_at,p.id`,
      after
        ? [this.config.generation, after.updatedAt, after.id]
        : [this.config.generation],
    );
    const last = scanned.rows.at(-1);
    if (!last) {
      const retry = await this.pool.query<{ id: string }>(
        `SELECT p.id FROM jobs j JOIN posts p ON p.id=(j.payload->>'postId')::uuid
         WHERE j.kind='index_post' AND j.status='dead'
           AND j.updated_at < now()-interval '1 hour'
           AND j.payload->>'generation'=$1
           AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
           AND j.deduplication_key=p.id::text||':'||$1||':'||${POST_REVISION_SQL}
           AND NOT EXISTS (
             SELECT 1 FROM post_embeddings e WHERE e.post_id=p.id
               AND e.generation=$1 AND e.source_revision=${POST_REVISION_SQL}
           )
         ORDER BY j.updated_at,j.id LIMIT 1`,
        [this.config.generation],
      );
      return retry.rows[0]
        ? this.enqueue(this.pool, retry.rows[0].id)
        : false;
    }
    for (const row of scanned.rows)
      if (row.needs_enqueue && (await this.enqueue(this.pool, row.id))) {
        this.backfillCursor = { updatedAt: row.updated_at, id: row.id };
        return true;
      }
    this.backfillCursor = { updatedAt: last.updated_at, id: last.id };
    return false;
  }

  async indexPost(postId: string): Promise<boolean> {
    if (!(await this.available())) return false;
    const source = await this.pool.query<{
      title: string;
      body_markdown: string;
      source_revision: string;
    }>(
      `SELECT p.title,p.body_markdown,${POST_REVISION_SQL} AS source_revision
       FROM posts p WHERE p.id=$1 AND p.deleted_at IS NULL
         AND p.duplicate_status <> 'confirmed'`,
      [postId],
    );
    const post = source.rows[0];
    if (!post) return false;
    const inputs = chunks(post.title, post.body_markdown);
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i += 8)
      vectors.push(...(await this.provider.embedMany(inputs.slice(i, i + 8))));
    if (
      vectors.length !== inputs.length ||
      vectors.some((vector) => vector.length !== vectors[0]!.length)
    )
      throw new Error("Embedding dimensions changed within a post");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ source_revision: string }>(
        `SELECT ${POST_REVISION_SQL} AS source_revision FROM posts p
         WHERE p.id=$1 AND p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
         FOR UPDATE OF p`,
        [postId],
      );
      if (current.rows[0]?.source_revision !== post.source_revision) {
        await client.query("COMMIT");
        await this.enqueue(this.pool, postId);
        return false;
      }
      await client.query(
        "DELETE FROM post_embeddings WHERE post_id=$1 AND generation=$2",
        [postId, this.config.generation],
      );
      for (const [ordinal, vector] of vectors.entries())
        await client.query(
          `INSERT INTO post_embeddings
           (post_id,generation,source_revision,chunk_ordinal,embedding)
           VALUES ($1,$2,$3,$4,$5::public.vector)`,
          [
            postId,
            this.config.generation,
            post.source_revision,
            ordinal,
            `[${vector.join(",")}]`,
          ],
        );
      await client.query(
        "DELETE FROM semantic_post_catchup WHERE post_id=$1 AND generation=$2",
        [postId, this.config.generation],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async embedQuery(query: string): Promise<SearchEmbedding | undefined> {
    if (!(await this.available())) return undefined;
    try {
      const vector = (await this.provider.embedMany([query], 2_000))[0];
      if (!vector) return undefined;
      return {
        generation: this.config.generation,
        vector: `[${vector.join(",")}]`,
        dimensions: vector.length,
      };
    } catch {
      return undefined;
    }
  }
}
