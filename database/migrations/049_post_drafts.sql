CREATE TABLE post_drafts (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);

CREATE INDEX post_drafts_owner_updated_idx
  ON post_drafts (course_id, user_id, updated_at DESC, id DESC);
