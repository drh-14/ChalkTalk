CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX posts_title_trgm_idx ON posts USING gin (title public.gin_trgm_ops)
  WHERE deleted_at IS NULL;
CREATE INDEX posts_body_trgm_idx ON posts USING gin (body_markdown public.gin_trgm_ops)
  WHERE deleted_at IS NULL;
