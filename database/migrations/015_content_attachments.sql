CREATE TABLE content_attachments (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  post_id uuid,
  answer_id uuid,
  followup_id uuid,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  checksum_sha256 bytea NOT NULL CHECK (octet_length(checksum_sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CHECK (num_nonnulls(post_id,answer_id,followup_id) = 1),
  FOREIGN KEY (course_id,post_id) REFERENCES posts(course_id,id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,answer_id) REFERENCES answers(course_id,id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,followup_id) REFERENCES followups(course_id,id) ON DELETE CASCADE
);
CREATE INDEX content_attachments_post_live_idx ON content_attachments(post_id,id) WHERE deleted_at IS NULL;
CREATE INDEX content_attachments_answer_live_idx ON content_attachments(answer_id,id) WHERE deleted_at IS NULL;
CREATE INDEX content_attachments_followup_live_idx ON content_attachments(followup_id,id) WHERE deleted_at IS NULL;
