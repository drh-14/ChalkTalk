ALTER TABLE users
  ADD COLUMN daily_digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN daily_digest_enabled_date date,
  ADD CONSTRAINT users_daily_digest_enabled_date_check
    CHECK (daily_digest_enabled = (daily_digest_enabled_date IS NOT NULL));

CREATE TABLE digest_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'sent', 'canceled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  locked_by text,
  locked_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, course_id, activity_date),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

CREATE INDEX digest_outbox_claim_idx
  ON digest_outbox(status, available_at, locked_until)
  WHERE status IN ('queued', 'running');

CREATE TABLE digest_schedule_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_scanned_date date NOT NULL
);
INSERT INTO digest_schedule_state(singleton,last_scanned_date)
VALUES (true, '1970-01-01');
