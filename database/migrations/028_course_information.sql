CREATE TABLE course_information (
  course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  description_markdown text NOT NULL DEFAULT '' CHECK (char_length(description_markdown) <= 50000),
  website text CHECK (char_length(website) <= 2048),
  syllabus_file_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (course_id, syllabus_file_id) REFERENCES course_files(course_id, id)
);
CREATE TABLE course_staff_profiles (
  course_id uuid NOT NULL,
  user_id uuid NOT NULL,
  contact text NOT NULL DEFAULT '' CHECK (char_length(contact) <= 2000),
  location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 2000),
  office_hours text NOT NULL DEFAULT '' CHECK (char_length(office_hours) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (course_id, user_id),
  FOREIGN KEY (course_id, user_id) REFERENCES course_memberships(course_id, user_id) ON DELETE CASCADE
);
