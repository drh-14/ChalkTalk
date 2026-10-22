ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'answer_created', 'answer_edited', 'answer_endorsed',
  'followup_created', 'reply_created', 'announcement', 'post_published',
  'mentioned'
));
