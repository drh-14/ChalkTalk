ALTER TABLE posts
  ADD COLUMN private boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT posts_private_check CHECK (NOT private OR (type <> 'poll' AND NOT announcement));

CREATE INDEX posts_course_private_idx ON posts (course_id, last_activity_at DESC) WHERE private AND deleted_at IS NULL;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'answer_created', 'answer_edited', 'answer_endorsed',
  'followup_created', 'reply_created', 'announcement', 'post_published'
));
