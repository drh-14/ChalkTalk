ALTER TABLE collaboration_sessions
  ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
UPDATE collaboration_sessions SET last_active_at = updated_at;
CREATE INDEX collaboration_sessions_idle_idx ON collaboration_sessions (last_active_at) WHERE lifecycle_state = 'active';
