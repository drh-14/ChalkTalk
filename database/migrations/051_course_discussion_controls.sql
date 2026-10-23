ALTER TABLE courses
  ADD COLUMN allow_anonymous_posting boolean NOT NULL DEFAULT true,
  ADD COLUMN allow_private_posting boolean NOT NULL DEFAULT true,
  ADD COLUMN allow_followup_resolution boolean NOT NULL DEFAULT true;
