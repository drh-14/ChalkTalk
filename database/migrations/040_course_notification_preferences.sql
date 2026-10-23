-- Per-course email choices. Existing memberships inherit the account's former
-- activity preference; all memberships keep existing announcement/digest mail.
ALTER TABLE course_memberships
  ADD COLUMN activity_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN announcement_emails boolean NOT NULL DEFAULT true,
  ADD COLUMN digest_emails boolean NOT NULL DEFAULT true;
UPDATE course_memberships m SET activity_emails=u.notification_emails
  FROM users u WHERE u.id=m.user_id;
