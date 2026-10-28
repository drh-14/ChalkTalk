CREATE TABLE thread_boards (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (course_id,id)
);
CREATE INDEX thread_boards_course_live_idx ON thread_boards(course_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;

CREATE TABLE thread_conversations (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  board_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  next_message_ordinal bigint NOT NULL DEFAULT 1 CHECK (next_message_ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (course_id,board_id) REFERENCES thread_boards(course_id,id) ON DELETE CASCADE,
  UNIQUE (course_id,id),
  UNIQUE (course_id,board_id,id)
);
CREATE INDEX thread_conversations_board_recent_idx ON thread_conversations(board_id,updated_at DESC,id DESC);

CREATE TABLE thread_messages (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  board_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role_at_posting text NOT NULL CHECK (author_role_at_posting IN ('student','ta','instructor')),
  body_markdown text NOT NULL CHECK (length(body_markdown) <= 100000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  FOREIGN KEY (course_id,board_id,conversation_id) REFERENCES thread_conversations(course_id,board_id,id) ON DELETE CASCADE,
  UNIQUE (course_id,id),
  UNIQUE (course_id,conversation_id,id),
  UNIQUE (course_id,board_id,conversation_id,id),
  UNIQUE (conversation_id,ordinal)
);
CREATE INDEX thread_messages_conversation_order_idx ON thread_messages(conversation_id,ordinal,id);

CREATE TABLE thread_watches (
  course_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  notices_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (conversation_id,user_id),
  FOREIGN KEY (course_id,user_id) REFERENCES course_memberships(course_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,conversation_id) REFERENCES thread_conversations(course_id,id) ON DELETE CASCADE
);
CREATE INDEX thread_watches_user_idx ON thread_watches(course_id,user_id);

CREATE TABLE thread_message_reads (
  course_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (message_id,user_id),
  FOREIGN KEY (course_id,message_id) REFERENCES thread_messages(course_id,id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,user_id) REFERENCES course_memberships(course_id,user_id) ON DELETE CASCADE
);

CREATE TABLE thread_attachments (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  board_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  checksum_sha256 bytea NOT NULL CHECK (octet_length(checksum_sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  FOREIGN KEY (course_id,board_id,conversation_id,message_id) REFERENCES thread_messages(course_id,board_id,conversation_id,id) ON DELETE CASCADE
);
CREATE INDEX thread_attachments_message_live_idx ON thread_attachments(message_id,id) WHERE deleted_at IS NULL;
CREATE INDEX thread_attachments_board_live_idx ON thread_attachments(board_id,id) WHERE deleted_at IS NULL;

CREATE TABLE thread_notifications (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  FOREIGN KEY (course_id,recipient_user_id) REFERENCES course_memberships(course_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,conversation_id) REFERENCES thread_conversations(course_id,id) ON DELETE CASCADE,
  FOREIGN KEY (course_id,conversation_id,message_id) REFERENCES thread_messages(course_id,conversation_id,id) ON DELETE CASCADE
);
CREATE INDEX thread_notifications_recipient_recent_idx ON thread_notifications(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX thread_notifications_recipient_unread_idx ON thread_notifications(recipient_user_id) WHERE read_at IS NULL;

CREATE TABLE thread_course_counters (
  course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence >= 0)
);
CREATE TABLE thread_changes (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  board_id uuid NOT NULL,
  kind text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (course_id,sequence)
);
