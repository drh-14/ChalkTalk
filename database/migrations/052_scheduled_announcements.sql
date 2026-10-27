ALTER TABLE posts
  ADD COLUMN scheduled_for timestamptz,
  ADD CONSTRAINT posts_scheduled_announcement_check CHECK (scheduled_for IS NULL OR announcement);

CREATE INDEX posts_scheduled_idx ON posts (course_id) WHERE scheduled_for IS NOT NULL;
