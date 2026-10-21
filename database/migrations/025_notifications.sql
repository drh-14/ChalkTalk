CREATE TABLE post_follows (
  post_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  following boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
CREATE INDEX post_follows_user_idx ON post_follows (user_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  course_id uuid NOT NULL,
  post_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'answer_created', 'answer_edited', 'answer_endorsed',
    'followup_created', 'reply_created', 'announcement'
  )),
  actor_user_id uuid REFERENCES users(id),
  actor_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_recent_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_post_idx ON notifications (post_id, user_id);

CREATE TABLE post_reads (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  read_at timestamptz NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE course_read_marks (
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_before timestamptz NOT NULL,
  PRIMARY KEY (course_id, user_id),
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);

ALTER TABLE users ADD COLUMN notification_emails boolean NOT NULL DEFAULT false;
