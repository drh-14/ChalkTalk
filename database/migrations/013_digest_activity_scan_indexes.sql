CREATE INDEX posts_digest_created_idx ON posts(created_at)
  WHERE type IN ('question', 'note') AND deleted_at IS NULL
    AND duplicate_status <> 'confirmed';

CREATE INDEX answers_digest_created_idx ON answers(created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX followups_digest_created_idx ON followups(created_at)
  WHERE deleted_at IS NULL;
