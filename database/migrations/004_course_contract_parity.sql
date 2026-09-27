DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE domain <> lower(btrim(domain)) OR length(domain) > 253 OR length(domain) = 0) THEN
    RAISE EXCEPTION 'Cannot migrate organizations: domain must be normalized and 1-253 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE length(name) > 200 OR length(name) = 0) THEN
    RAISE EXCEPTION 'Cannot migrate organizations: name must be 1-200 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM courses WHERE length(name) > 200 OR length(name) = 0) THEN
    RAISE EXCEPTION 'Cannot migrate courses: name must be 1-200 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM idempotency_records WHERE length(key) < 1 OR length(key) > 255) THEN
    RAISE EXCEPTION 'Cannot migrate idempotency records: key must be 1-255 characters';
  END IF;
END $$;

ALTER TABLE organizations
  ALTER COLUMN domain TYPE varchar(253),
  ALTER COLUMN name TYPE varchar(200),
  ALTER COLUMN version TYPE bigint;
ALTER TABLE organizations ADD CONSTRAINT organizations_domain_normalized
  CHECK (domain = lower(btrim(domain)) AND length(domain) > 0);
ALTER TABLE organizations ADD CONSTRAINT organizations_name_nonempty CHECK (length(name) > 0);

ALTER TABLE courses
  ALTER COLUMN name TYPE varchar(200),
  ALTER COLUMN version TYPE bigint;
ALTER TABLE courses ADD CONSTRAINT courses_name_nonempty CHECK (length(name) > 0);
ALTER TABLE course_memberships ALTER COLUMN version TYPE bigint;

ALTER TABLE idempotency_records
  ADD COLUMN state text NOT NULL DEFAULT 'completed',
  ADD COLUMN response_status integer,
  ADD COLUMN response_headers jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE idempotency_records SET response_status = status_code, updated_at = created_at;
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_state_check
  CHECK (state IN ('processing', 'completed'));
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_key_nonempty
  CHECK (length(key) > 0);
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_completed_response_check
  CHECK (state <> 'completed' OR response_status IS NOT NULL);
ALTER TABLE idempotency_records ALTER COLUMN key TYPE varchar(255);
ALTER TABLE idempotency_records DROP CONSTRAINT idempotency_records_pkey;
ALTER TABLE idempotency_records DROP CONSTRAINT idempotency_records_scope_key_key;
ALTER TABLE idempotency_records DROP COLUMN id;
ALTER TABLE idempotency_records DROP COLUMN status_code;
ALTER TABLE idempotency_records ADD PRIMARY KEY (scope, key);
