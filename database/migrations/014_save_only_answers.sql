-- Migration runner checks each active Yjs document against the Markdown row
-- while holding an exclusive table lock before executing this statement.
DROP TABLE IF EXISTS collaboration_tickets;
DROP TABLE answer_collaboration_documents;

-- A former live edit may have saved a temporarily empty active answer. Keep
-- that historical state, but the REST API requires nonblank new writes.
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
END $$;
ALTER TABLE answers ADD CONSTRAINT answers_body_save_only_check
  CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) <= 100000)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL));
