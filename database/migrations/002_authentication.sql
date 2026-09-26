CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_active_email_unique ON users (email) WHERE deleted_at IS NULL;

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_email_idx ON email_verification_tokens (email, created_at DESC);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  credential_hash bytea NOT NULL UNIQUE,
  csrf_token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_active_user_idx ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);

CREATE TABLE rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_memberships (
  course_id uuid NOT NULL REFERENCES courses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('student', 'teaching_assistant', 'instructor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);
CREATE INDEX course_memberships_instructor_idx ON course_memberships (user_id, course_id) WHERE role = 'instructor';
