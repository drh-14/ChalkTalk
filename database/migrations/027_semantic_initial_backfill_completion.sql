ALTER TABLE semantic_embedding_generations
  ADD COLUMN initial_backfill_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN backfill_epoch bigint NOT NULL DEFAULT 0;
