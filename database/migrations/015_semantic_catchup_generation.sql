ALTER TABLE semantic_post_catchup ADD COLUMN generation text;
CREATE INDEX semantic_post_catchup_generation_idx ON semantic_post_catchup(generation, post_id);
