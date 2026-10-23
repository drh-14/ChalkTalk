UPDATE semantic_post_catchup SET generation='' WHERE generation IS NULL;
ALTER TABLE semantic_post_catchup ALTER COLUMN generation SET DEFAULT '';
ALTER TABLE semantic_post_catchup ALTER COLUMN generation SET NOT NULL;
ALTER TABLE semantic_post_catchup DROP CONSTRAINT semantic_post_catchup_pkey;
ALTER TABLE semantic_post_catchup ADD PRIMARY KEY (post_id, generation);
