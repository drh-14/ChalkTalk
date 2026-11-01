-- Preserve existing session IDs, documents, tickets, and exact participant rosters
-- while removing the post as an ownership and authorization boundary.
ALTER TABLE collaboration_sessions
  DROP CONSTRAINT collaboration_sessions_course_id_post_id_fkey;
DROP INDEX collaboration_sessions_post_idx;
ALTER TABLE collaboration_sessions
  DROP COLUMN post_id,
  ADD COLUMN final_snapshot_confirmed boolean NOT NULL DEFAULT false;

-- Historical ended sessions have no durable evidence of a final Yjs flush.
-- The default deliberately marks them as last-saved-only.
