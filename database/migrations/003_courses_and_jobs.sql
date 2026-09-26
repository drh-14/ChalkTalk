ALTER TABLE courses ADD COLUMN created_by_user_id uuid REFERENCES users(id);
ALTER TABLE courses ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleting'));
ALTER TABLE courses ADD COLUMN join_code char(8);
ALTER TABLE courses ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE courses ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

UPDATE courses c SET created_by_user_id = (
  SELECT user_id FROM course_memberships
  WHERE course_id = c.id AND role = 'instructor' ORDER BY user_id LIMIT 1
) WHERE c.created_by_user_id IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM courses WHERE created_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate legacy courses: every existing course needs an instructor membership before migration 003';
  END IF;
END $$;

ALTER TABLE courses ALTER COLUMN created_by_user_id SET NOT NULL;
UPDATE courses SET join_code = upper(substr(md5(id::text || random()::text), 1, 8)) WHERE join_code IS NULL;
ALTER TABLE courses ALTER COLUMN join_code SET NOT NULL;
ALTER TABLE organizations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE organizations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE course_memberships DROP CONSTRAINT course_memberships_role_check;
UPDATE course_memberships SET role = 'ta' WHERE role = 'teaching_assistant';
ALTER TABLE course_memberships ADD CONSTRAINT course_memberships_role_check CHECK (role IN ('student', 'ta', 'instructor'));
ALTER TABLE course_memberships ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE course_memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  kind varchar(100) NOT NULL,
  payload jsonb NOT NULL,
  deduplication_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  locked_by text,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON jobs (status, available_at) WHERE status IN ('queued', 'running');
CREATE UNIQUE INDEX jobs_kind_deduplication_key_idx ON jobs (kind, deduplication_key) WHERE deduplication_key IS NOT NULL;
