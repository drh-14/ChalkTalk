CREATE TABLE course_file_searchable_pdfs (
 file_id uuid PRIMARY KEY,
 course_id uuid NOT NULL,
 generation uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
 object_key text UNIQUE,
 size_bytes bigint,
 page_count integer,
 failure_code text CHECK(char_length(failure_code) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(course_id,file_id) REFERENCES course_files(course_id,id) ON DELETE CASCADE,
 CHECK((status='ready')=(object_key IS NOT NULL)),
 CHECK((status='ready')=(size_bytes IS NOT NULL AND page_count IS NOT NULL)),
 CHECK(size_bytes IS NULL OR size_bytes BETWEEN 1 AND 104857600),
 CHECK(page_count IS NULL OR page_count>0),
 CHECK((status='failed')=(failure_code IS NOT NULL))
);
