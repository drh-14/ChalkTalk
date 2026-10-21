ALTER TABLE posts DROP CONSTRAINT posts_type_check;
ALTER TABLE posts ADD CONSTRAINT posts_type_check CHECK (type IN ('question', 'note', 'poll'));

ALTER TABLE posts
  ADD COLUMN announcement boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT posts_announcement_check CHECK (NOT announcement OR (type = 'note' AND NOT anonymous));

CREATE TABLE poll_options (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  post_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  label varchar(200) NOT NULL CHECK (length(label) >= 1),
  UNIQUE (course_id, id),
  UNIQUE (course_id, post_id, id),
  UNIQUE (post_id, position),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE
);

CREATE TABLE poll_votes (
  course_id uuid NOT NULL,
  post_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  option_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, post_id, option_id) REFERENCES poll_options(course_id, post_id, id) ON DELETE CASCADE
);
CREATE INDEX poll_votes_option_idx ON poll_votes (option_id);
