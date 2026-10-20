CREATE TABLE semantic_embedding_generations (
  generation text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX semantic_embedding_generations_last_seen_idx ON semantic_embedding_generations(last_seen_at);

INSERT INTO semantic_embedding_generations(generation)
SELECT DISTINCT payload->>'generation' FROM jobs
WHERE kind='index_post' AND updated_at >= now()-interval '1 day'
  AND payload->>'generation' IS NOT NULL AND payload->>'generation' <> ''
ON CONFLICT DO NOTHING;

INSERT INTO semantic_post_catchup(post_id,generation)
SELECT d.post_id,g.generation FROM semantic_post_catchup d
CROSS JOIN semantic_embedding_generations g
WHERE d.generation=''
ON CONFLICT (post_id,generation) DO NOTHING;
DELETE FROM semantic_post_catchup WHERE generation='';
ALTER TABLE semantic_post_catchup ALTER COLUMN generation DROP DEFAULT;
