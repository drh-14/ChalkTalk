ALTER TABLE collaboration_documents
  ADD COLUMN whiteboard_projection jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(whiteboard_projection) = 'array');
