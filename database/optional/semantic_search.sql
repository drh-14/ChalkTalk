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
