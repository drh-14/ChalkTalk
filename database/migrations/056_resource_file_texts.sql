CREATE TABLE course_file_texts (
 file_id uuid PRIMARY KEY,
 course_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed','unsupported')),
 text text CHECK(char_length(text)<=500000),
 truncated boolean NOT NULL DEFAULT false,
 failure_code text CHECK(char_length(failure_code) BETWEEN 1 AND 100),
 extracted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 -- The default parser treats <...> as HTML tags and skips them; private-use stand-ins keep markup-like text searchable.
 search_vector tsvector GENERATED ALWAYS AS (CASE WHEN status='ready' THEN to_tsvector('english',translate(coalesce(text,''),'<>',U&'\E000\E001')) ELSE NULL END) STORED,
 FOREIGN KEY(course_id,file_id) REFERENCES course_files(course_id,id) ON DELETE CASCADE,
 CHECK((status='ready')=(text IS NOT NULL)),
 CHECK(status IN ('pending','ready') OR failure_code IS NOT NULL)
);
CREATE INDEX course_file_texts_search_idx ON course_file_texts USING gin(search_vector);

CREATE TEMP TABLE resource_text_backfill ON COMMIT DROP AS
 SELECT f.id file_id,f.course_id FROM course_resources r
 JOIN course_resource_revisions v ON v.id=r.active_revision_id AND v.resource_id=r.id AND v.kind='upload'
 JOIN course_files f ON f.id=v.file_id AND f.course_id=r.course_id AND f.deleted_at IS NULL
 WHERE r.deleted_at IS NULL;
INSERT INTO course_file_texts(file_id,course_id) SELECT file_id,course_id FROM resource_text_backfill ON CONFLICT(file_id) DO NOTHING;
INSERT INTO jobs(id,kind,payload,deduplication_key,max_attempts)
 SELECT gen_random_uuid(),'extract_file_text',jsonb_build_object('fileId',file_id),'file:'||file_id,3 FROM resource_text_backfill
 ON CONFLICT(kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING;
