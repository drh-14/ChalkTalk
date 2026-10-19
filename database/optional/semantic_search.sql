-- Run explicitly only on deployments that enable semantic search and provide pgvector.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS post_embeddings (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  generation text NOT NULL,
  source_revision text NOT NULL CHECK (length(source_revision) = 64),
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal >= 0),
  embedding public.vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, generation, chunk_ordinal)
);
CREATE INDEX IF NOT EXISTS post_embeddings_generation_post_idx
  ON post_embeddings (generation, post_id, source_revision);
DROP INDEX IF EXISTS posts_semantic_backfill_idx;
CREATE INDEX IF NOT EXISTS posts_semantic_backfill_updated_idx
  ON posts (updated_at, id)
  WHERE deleted_at IS NULL AND duplicate_status <> 'confirmed';
CREATE INDEX IF NOT EXISTS jobs_semantic_dead_idx
  ON jobs (updated_at, id)
  WHERE kind='index_post' AND status='dead';
