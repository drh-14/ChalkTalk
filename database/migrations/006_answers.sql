CREATE TABLE answers (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  post_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('student', 'staff')),
  body_markdown text,
  anonymous boolean NOT NULL DEFAULT false,
  endorsed_at timestamptz,
  endorsed_by_user_id uuid REFERENCES users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (course_id, id),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id),
  CHECK ((deleted_at IS NULL AND length(body_markdown) BETWEEN 1 AND 100000)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL)),
  CHECK ((endorsed_at IS NULL) = (endorsed_by_user_id IS NULL))
);
CREATE UNIQUE INDEX answers_one_active_kind_idx ON answers(post_id, kind) WHERE deleted_at IS NULL;
CREATE TABLE answer_contributors (
  answer_id uuid NOT NULL REFERENCES answers(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (answer_id, user_id)
);
CREATE TABLE answer_collaboration_documents (
  answer_id uuid PRIMARY KEY REFERENCES answers(id),
  yjs_state bytea NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'finalizing', 'closed')),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  persistence_revision bigint NOT NULL DEFAULT 0 CHECK (persistence_revision >= 0)
);
