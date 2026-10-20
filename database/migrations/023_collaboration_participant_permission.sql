ALTER TABLE collaboration_participants
  ADD COLUMN permission text NOT NULL DEFAULT 'edit' CHECK (permission IN ('edit', 'view'));
