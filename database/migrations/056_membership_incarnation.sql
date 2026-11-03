ALTER TABLE course_memberships ADD COLUMN incarnation uuid;
UPDATE course_memberships SET incarnation = gen_random_uuid();
ALTER TABLE course_memberships ALTER COLUMN incarnation SET NOT NULL;
ALTER TABLE course_memberships ALTER COLUMN incarnation SET DEFAULT gen_random_uuid();

-- Before this migration, join responses used the membership's version-only ETag.
-- Preserve that exact historical header for unexpired idempotency replays.
UPDATE idempotency_records
SET response_headers = jsonb_build_object(
  'ETag', '"v' || (response_body->>'version') || '"',
  'legacyMembershipEtag', true
)
WHERE scope LIKE 'course-join:%'
  AND response_headers IS NULL
  AND jsonb_typeof(response_body->'version') = 'number';
