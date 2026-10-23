CREATE TABLE private_post_groups (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL CHECK (name = btrim(name) AND length(name) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, id)
);
CREATE UNIQUE INDEX private_post_groups_name_idx ON private_post_groups (course_id, lower(name));

CREATE TABLE private_post_group_members (
  group_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (course_id, group_id) REFERENCES private_post_groups(course_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
CREATE INDEX private_post_group_members_user_idx ON private_post_group_members (course_id, user_id, group_id);

ALTER TABLE posts ADD COLUMN audience text NOT NULL DEFAULT 'class',
  ADD COLUMN audience_group_id uuid,
  ADD CONSTRAINT posts_audience_check CHECK (
    audience IN ('class', 'staff', 'selected_staff', 'group')
    AND ((audience = 'group' AND (audience_group_id IS NOT NULL OR deleted_at IS NOT NULL))
      OR (audience <> 'group' AND audience_group_id IS NULL))
    AND (audience = 'class' OR (type <> 'poll' AND NOT announcement))
  ),
  ADD CONSTRAINT posts_audience_group_fk FOREIGN KEY (course_id, audience_group_id)
    REFERENCES private_post_groups(course_id, id) ON DELETE SET NULL (audience_group_id);
UPDATE posts SET audience = 'staff' WHERE private;

CREATE TABLE post_staff_recipients (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_staff_recipients_user_idx ON post_staff_recipients (user_id, post_id);

-- The legacy private column remains a supported database alias for existing
-- writers, while audience is the canonical representation of new requests.
CREATE FUNCTION sync_post_audience_private() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.private AND NEW.audience = 'class')
     OR (TG_OP = 'UPDATE' AND NEW.private IS DISTINCT FROM OLD.private
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience) THEN
    NEW.audience := CASE WHEN NEW.private THEN 'staff' ELSE 'class' END;
    NEW.audience_group_id := NULL;
  ELSE
    NEW.private := NEW.audience <> 'class';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_post_audience_private_before_write
  BEFORE INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION sync_post_audience_private();
