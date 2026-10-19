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
  for (let offset = 0; offset < content.length; offset += 1_000)
    parts.push(content.slice(offset, offset + 1_000));
  return parts;
}

export class SemanticIndex {
  constructor(
    private readonly pool: Pool,
    readonly config: EmbeddingConfig,
    private readonly provider: BatchProvider,
  ) {}

  async available(db: Db = this.pool): Promise<boolean> {
    const result = await db.query<{ relation: string | null }>(
      "SELECT to_regclass('post_embeddings')::text AS relation",
    );
    return Boolean(result.rows[0]?.relation);
  }

  async enqueue(db: Db, postId: string): Promise<boolean> {
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
         locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=now()
       WHERE jobs.status='dead' AND jobs.updated_at < now()-interval '1 hour'
       RETURNING id`,
      [uuidv7(), { postId, generation: this.config.generation, revision }, key],
    );
    return queued.rowCount === 1;
  }

  async removePost(db: Db, postId: string): Promise<void> {
    if (await this.available(db))
      await db.query("DELETE FROM post_embeddings WHERE post_id=$1", [postId]);
  }

  async queueBackfillOne(): Promise<boolean> {
    if (!(await this.available())) return false;
    const candidate = await this.pool.query<{ id: string }>(
      `SELECT p.id FROM posts p
       WHERE p.deleted_at IS NULL AND p.duplicate_status <> 'confirmed'
         AND NOT EXISTS (
           SELECT 1 FROM post_embeddings e WHERE e.post_id=p.id
             AND e.generation=$1 AND e.source_revision=${POST_REVISION_SQL}
         )
         AND NOT EXISTS (
           SELECT 1 FROM jobs j WHERE j.kind='index_post'
             AND j.deduplication_key=p.id::text||':'||$1||':'||${POST_REVISION_SQL}
             AND (j.status <> 'dead' OR j.updated_at >= now()-interval '1 hour')
         )
       ORDER BY p.created_at,p.id LIMIT 1`,
      [this.config.generation],
    );
    return candidate.rows[0]
      ? this.enqueue(this.pool, candidate.rows[0].id)
      : false;
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
