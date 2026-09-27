CREATE TABLE posts (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  author_user_id uuid REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('question', 'note')),
  title varchar(200),
  body_markdown text,
  anonymous boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  duplicate_of_post_id uuid,
  duplicate_status text NOT NULL DEFAULT 'none' CHECK (duplicate_status IN ('none', 'suggested', 'confirmed')),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  search_vector tsvector GENERATED ALWAYS AS (
    CASE WHEN deleted_at IS NULL THEN to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_markdown, '')) ELSE NULL END
  ) STORED,
  UNIQUE (course_id, id),
  FOREIGN KEY (course_id, duplicate_of_post_id) REFERENCES posts(course_id, id),
  CHECK ((deleted_at IS NULL AND author_user_id IS NOT NULL AND length(title) BETWEEN 1 AND 200 AND length(body_markdown) BETWEEN 1 AND 100000)
    OR (deleted_at IS NOT NULL AND author_user_id IS NULL AND title IS NULL AND body_markdown IS NULL)),
  CHECK ((duplicate_status = 'none' AND duplicate_of_post_id IS NULL) OR (duplicate_status <> 'none' AND duplicate_of_post_id IS NOT NULL)),
  CHECK (duplicate_of_post_id IS NULL OR duplicate_of_post_id <> id)
);
CREATE INDEX posts_search_idx ON posts USING gin(search_vector);
CREATE INDEX posts_course_activity_idx ON posts(course_id, last_activity_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TABLE tags (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  name varchar(100) NOT NULL CHECK (name = lower(btrim(name)) AND length(name) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (course_id, name)
);
CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id),
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);
