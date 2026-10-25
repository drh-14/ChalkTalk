CREATE TABLE post_drafts (
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content jsonb CHECK (content IS NULL OR jsonb_typeof(content) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (course_id, user_id),
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
