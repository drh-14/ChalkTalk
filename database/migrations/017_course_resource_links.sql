CREATE TABLE course_resource_links (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  url text NOT NULL CHECK (length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX course_resource_links_course_created_idx ON course_resource_links(course_id,created_at DESC,id DESC);
