ALTER TABLE followups
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by_user_id uuid REFERENCES users(id),
  ADD CONSTRAINT followups_resolution_root_check CHECK (parent_followup_id IS NULL OR resolved_at IS NULL),
  ADD CONSTRAINT followups_resolution_pair_check CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL));

CREATE INDEX followups_unresolved_idx ON followups (post_id)
  WHERE parent_followup_id IS NULL AND deleted_at IS NULL AND resolved_at IS NULL;
