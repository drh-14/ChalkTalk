CREATE TABLE post_folders (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  name varchar(64) NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, id)
);
CREATE UNIQUE INDEX post_folders_course_name_ci_idx ON post_folders (course_id, lower(name));
ALTER TABLE posts ADD COLUMN folder_id uuid;
ALTER TABLE posts ADD CONSTRAINT posts_folder_same_course_fk
  FOREIGN KEY (course_id, folder_id) REFERENCES post_folders(course_id, id);
CREATE INDEX posts_course_folder_idx ON posts(course_id, folder_id, last_activity_at DESC, id DESC)
  WHERE deleted_at IS NULL;
