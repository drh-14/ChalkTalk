DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM answers a LEFT JOIN answer_contributors c ON c.answer_id=a.id
    GROUP BY a.id HAVING count(c.user_id) <> 1
  ) THEN
    RAISE EXCEPTION 'Cannot infer legacy answer creator: expected exactly one contributor per answer';
  END IF;
END $$;

ALTER TABLE answers ADD COLUMN created_by_user_id uuid REFERENCES users(id);
ALTER TABLE answers ADD COLUMN edit_role_floor text CHECK (edit_role_floor IN ('student','ta','instructor'));
UPDATE answers a SET
  created_by_user_id = c.user_id,
  edit_role_floor = COALESCE(
    (SELECT m.role FROM course_memberships m WHERE m.course_id=a.course_id AND m.user_id=c.user_id),
    CASE a.kind WHEN 'student' THEN 'student' ELSE 'instructor' END
  )
FROM answer_contributors c
WHERE c.answer_id = a.id;
ALTER TABLE answers ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE answers ALTER COLUMN edit_role_floor SET NOT NULL;
DROP INDEX answers_one_active_kind_idx;

CREATE TABLE followups (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  post_id uuid NOT NULL,
  parent_followup_id uuid,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body_markdown text,
  anonymous boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (course_id, id),
  UNIQUE (course_id, post_id, id),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id),
  FOREIGN KEY (course_id, post_id, parent_followup_id)
    REFERENCES followups(course_id, post_id, id) ON DELETE CASCADE,
  CHECK ((deleted_at IS NULL AND length(body_markdown) BETWEEN 1 AND 100000)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL))
);
CREATE INDEX followups_tree_idx ON followups(post_id,parent_followup_id,created_at,id);

CREATE TABLE answer_upvotes (
  answer_id uuid NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id,user_id)
);
CREATE TABLE followup_upvotes (
  followup_id uuid NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (followup_id,user_id)
);
