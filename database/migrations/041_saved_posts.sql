CREATE TABLE saved_posts (
  post_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
CREATE INDEX saved_posts_user_course_idx ON saved_posts (user_id, course_id);
CREATE INDEX posts_course_created_idx ON posts (course_id, created_at DESC, id DESC);
