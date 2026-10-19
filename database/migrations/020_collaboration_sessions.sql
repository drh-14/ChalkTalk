CREATE TABLE collaboration_sessions (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND title = btrim(title)),
  language text NOT NULL DEFAULT 'plaintext' CHECK (
    language IN ('plaintext', 'python', 'java', 'c', 'cpp', 'javascript', 'typescript', 'sql')
  ),
  lifecycle_state text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'ending', 'ended')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (course_id, id),
  CHECK ((lifecycle_state = 'ended') = (ended_at IS NOT NULL)),
  FOREIGN KEY (course_id, post_id) REFERENCES posts(course_id, id) ON DELETE CASCADE
);
CREATE INDEX collaboration_sessions_post_idx ON collaboration_sessions (post_id, created_at DESC, id DESC);
CREATE INDEX collaboration_sessions_course_idx ON collaboration_sessions (course_id, created_at DESC, id DESC);
CREATE INDEX collaboration_sessions_active_idx ON collaboration_sessions (course_id) WHERE lifecycle_state <> 'ended';

CREATE TABLE collaboration_documents (
  collaboration_session_id uuid PRIMARY KEY REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  yjs_state bytea NOT NULL,
  text_projection text NOT NULL DEFAULT '' CHECK (length(text_projection) <= 200000),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  persistence_revision bigint NOT NULL DEFAULT 0 CHECK (persistence_revision >= 0)
);

-- Leaving a course deletes the membership row, which removes session access.
CREATE TABLE collaboration_participants (
  collaboration_session_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collaboration_session_id, user_id),
  FOREIGN KEY (course_id, collaboration_session_id) REFERENCES collaboration_sessions(course_id, id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
CREATE INDEX collaboration_participants_user_idx ON collaboration_participants (course_id, user_id);

CREATE TABLE collaboration_connection_tickets (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  collaboration_session_id uuid NOT NULL,
  course_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  auth_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('read', 'write')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at),
  FOREIGN KEY (course_id, collaboration_session_id) REFERENCES collaboration_sessions(course_id, id) ON DELETE CASCADE
);
CREATE INDEX collaboration_tickets_session_user_idx ON collaboration_connection_tickets (collaboration_session_id, user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
