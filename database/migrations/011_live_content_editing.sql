-- The live editor may temporarily contain an empty string. Deleted rows still
-- have no body; REST input validation continues to require nonblank text.
DO $$
DECLARE body_constraint text;
BEGIN
  SELECT conname INTO body_constraint
  FROM pg_constraint
  WHERE conrelid = 'answers'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%body_markdown%'
  LIMIT 1;
  IF body_constraint IS NULL THEN RAISE EXCEPTION 'Answer body constraint missing'; END IF;
  EXECUTE format('ALTER TABLE answers DROP CONSTRAINT %I', body_constraint);
  SELECT conname INTO body_constraint
  FROM pg_constraint
  WHERE conrelid = 'followups'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%body_markdown%'
  LIMIT 1;
  IF body_constraint IS NULL THEN RAISE EXCEPTION 'Followup body constraint missing'; END IF;
  EXECUTE format('ALTER TABLE followups DROP CONSTRAINT %I', body_constraint);
END $$;

ALTER TABLE answers ADD CONSTRAINT answers_body_live_check
  CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) <= 100000)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL));
ALTER TABLE followups ADD CONSTRAINT followups_body_live_check
  CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) <= 100000)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL));

-- Endorsement no longer freezes the shared answer body. Previously endorsed
-- answers may have closed document rows from the older lifecycle rule.
UPDATE answer_collaboration_documents d SET lifecycle_state='active'
FROM answers a WHERE a.id=d.answer_id AND a.deleted_at IS NULL;

CREATE TABLE followup_collaboration_documents (
  followup_id uuid PRIMARY KEY REFERENCES followups(id) ON DELETE CASCADE,
  yjs_state bytea NOT NULL,
  persistence_revision bigint NOT NULL DEFAULT 0 CHECK (persistence_revision >= 0),
  persisted_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- The migration runner backfills complete Yjs states in bounded batches in
-- this same transaction; SQL alone cannot encode arbitrary Yjs text safely.

CREATE TABLE collaboration_tickets (
  token_hash bytea PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  document_type text NOT NULL CHECK (document_type IN ('answer','followup')),
  document_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX collaboration_tickets_expiry_idx ON collaboration_tickets(expires_at);
