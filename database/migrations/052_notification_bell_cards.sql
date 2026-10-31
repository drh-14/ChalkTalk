ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'answer_created', 'answer_edited', 'answer_endorsed',
  'followup_created', 'reply_created', 'announcement', 'post_published',
  'mentioned', 'post_staff_edited', 'post_merged', 'post_staff_deleted'
));

ALTER TABLE notifications
  ADD COLUMN response_kind text,
  ADD COLUMN response_id uuid,
  ADD COLUMN canonical_post_id uuid,
  ADD COLUMN source_version bigint;
ALTER TABLE notifications ADD CONSTRAINT notifications_response_target_check CHECK (
  (response_kind IS NULL) = (response_id IS NULL)
  AND (response_kind IS NULL OR response_kind IN ('answer', 'followup'))
  AND (response_kind IS NULL OR kind IN ('answer_created', 'answer_edited', 'followup_created', 'reply_created', 'mentioned'))
);
ALTER TABLE notifications ADD CONSTRAINT notifications_merge_target_check CHECK (
  ((kind = 'post_merged') = (canonical_post_id IS NOT NULL))
  AND ((kind = 'post_merged') = (source_version IS NOT NULL))
);
