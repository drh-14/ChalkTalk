-- A text-only audit trail. Resource writes and revision inserts share a transaction.
CREATE TABLE content_text_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('post','answer','followup')),
  resource_id uuid NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  resource_version bigint NOT NULL CHECK (resource_version > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  editor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text,
  body_markdown text NOT NULL,
  anonymous boolean NOT NULL,
  restored_from_revision_id uuid,
  baseline boolean NOT NULL DEFAULT false,
  UNIQUE (kind,resource_id,ordinal),
  CHECK ((kind='post' AND title IS NOT NULL) OR (kind<>'post' AND title IS NULL))
);
CREATE INDEX content_text_revisions_course_idx ON content_text_revisions(course_id);

-- A baseline captures the currently saved text, not reconstructed historical edits.
-- Include live merged sources so an unmerge can reveal their retained history.
INSERT INTO content_text_revisions(course_id,kind,resource_id,ordinal,resource_version,title,body_markdown,anonymous,baseline)
SELECT course_id,'post',id,1,version,title,body_markdown,anonymous,true
FROM posts WHERE deleted_at IS NULL
ON CONFLICT (kind,resource_id,ordinal) DO NOTHING;
INSERT INTO content_text_revisions(course_id,kind,resource_id,ordinal,resource_version,body_markdown,anonymous,baseline)
SELECT a.course_id,'answer',a.id,1,a.version,a.body_markdown,a.anonymous,true
FROM answers a JOIN posts p ON p.id=a.post_id
WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL
ON CONFLICT (kind,resource_id,ordinal) DO NOTHING;
INSERT INTO content_text_revisions(course_id,kind,resource_id,ordinal,resource_version,body_markdown,anonymous,baseline)
SELECT f.course_id,'followup',f.id,1,f.version,f.body_markdown,f.anonymous,true
FROM followups f JOIN posts p ON p.id=f.post_id
WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL
ON CONFLICT (kind,resource_id,ordinal) DO NOTHING;
