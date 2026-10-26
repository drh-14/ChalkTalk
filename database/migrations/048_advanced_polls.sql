CREATE TABLE poll_settings (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  selection_mode text NOT NULL DEFAULT 'single' CHECK (selection_mode IN ('single','multiple')),
  max_selections smallint NOT NULL DEFAULT 1 CHECK (max_selections BETWEEN 1 AND 10),
  closes_at timestamptz,
  closed_at timestamptz,
  release_mode text NOT NULL DEFAULT 'live' CHECK (release_mode IN ('live','manual','automatic')),
  results_released_at timestamptz,
  explanation text CHECK (length(explanation) <= 10000),
  CHECK ((selection_mode='single' AND max_selections=1) OR selection_mode='multiple')
);

INSERT INTO poll_settings (post_id,results_released_at)
SELECT id,created_at FROM posts WHERE type='poll';

ALTER TABLE poll_votes DROP CONSTRAINT poll_votes_pkey;
ALTER TABLE poll_votes ADD PRIMARY KEY (post_id,user_id,option_id);
