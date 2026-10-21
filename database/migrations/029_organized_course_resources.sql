CREATE TABLE course_resource_catalogs (
 course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE course_resource_sections (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 visibility text NOT NULL CHECK(visibility IN ('class','staff')),
 position integer NOT NULL CHECK(position>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(course_id,id)
);
CREATE TABLE course_resources (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 section_id uuid,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 visibility text NOT NULL CHECK(visibility IN ('class','staff')),
 position integer NOT NULL CHECK(position>=0),
 active_revision_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deleted_at timestamptz,
 FOREIGN KEY(course_id,section_id) REFERENCES course_resource_sections(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(course_id,id)
);
CREATE TABLE course_resource_revisions (
 id uuid PRIMARY KEY,
 resource_id uuid NOT NULL,
 course_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('upload','link')),
 file_id uuid UNIQUE,
 url text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(course_id,resource_id) REFERENCES course_resources(course_id,id) ON DELETE CASCADE,
 FOREIGN KEY(course_id,file_id) REFERENCES course_files(course_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='upload' AND file_id IS NOT NULL AND url IS NULL) OR (kind='link' AND file_id IS NULL AND url IS NOT NULL AND char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://')),
 UNIQUE(resource_id,id)
);
ALTER TABLE course_resources ADD CONSTRAINT course_resources_active_revision_fk FOREIGN KEY(id,active_revision_id) REFERENCES course_resource_revisions(resource_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX resource_sections_course_order ON course_resource_sections(course_id,position,id);
CREATE INDEX resources_course_live_order ON course_resources(course_id,section_id,position,id) WHERE deleted_at IS NULL;
CREATE INDEX resource_revisions_file ON course_resource_revisions(file_id) WHERE file_id IS NOT NULL;
CREATE TEMP TABLE syllabus_files_to_skip(id uuid PRIMARY KEY) ON COMMIT DROP;
DO $$ BEGIN
 IF to_regclass('course_information') IS NOT NULL THEN
  EXECUTE 'INSERT INTO syllabus_files_to_skip SELECT syllabus_file_id FROM course_information WHERE syllabus_file_id IS NOT NULL';
 END IF;
END $$;
INSERT INTO course_resources(id,course_id,title,visibility,position,active_revision_id,created_at)
 SELECT id,course_id,left(COALESCE(NULLIF(btrim(file_name,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),''),'Untitled file'),200),'class',row_number() OVER(PARTITION BY course_id ORDER BY created_at DESC,id DESC)-1,id,created_at FROM course_files f WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM syllabus_files_to_skip s WHERE s.id=f.id);
INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,file_id,created_at)
 SELECT r.id,r.id,r.course_id,'upload',r.id,r.created_at FROM course_resources r;
CREATE TEMP TABLE legacy_resource_link_ids ON COMMIT DROP AS SELECT l.id legacy_id,CASE WHEN EXISTS(SELECT 1 FROM course_resources r WHERE r.id=l.id) THEN gen_random_uuid() ELSE l.id END resource_id FROM course_resource_links l;
INSERT INTO course_resources(id,course_id,title,visibility,position,active_revision_id,created_at)
 SELECT m.resource_id,l.course_id,l.title,'class',row_number() OVER(PARTITION BY l.course_id ORDER BY l.created_at DESC,l.id DESC)-1,m.resource_id,l.created_at FROM course_resource_links l JOIN legacy_resource_link_ids m ON m.legacy_id=l.id;
INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,url,created_at)
 SELECT m.resource_id,m.resource_id,l.course_id,'link',l.url,l.created_at FROM course_resource_links l JOIN legacy_resource_link_ids m ON m.legacy_id=l.id;
INSERT INTO course_resource_catalogs(course_id) SELECT DISTINCT course_id FROM course_resources;

WITH ranks AS (SELECT id,row_number() OVER(PARTITION BY course_id ORDER BY created_at DESC,id DESC)-1 position FROM course_resources) UPDATE course_resources r SET position=ranks.position FROM ranks WHERE ranks.id=r.id;
UPDATE idempotency_records i
 SET response_body=jsonb_build_object(
   'kind','link',
   'id',r.id,
   'courseId',r.course_id,
   'title',r.title,
   'url',v.url,
   'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'sectionId',r.section_id,
   'visibility',r.visibility,
   'position',r.position,
   'version',r.version
 )
 FROM legacy_resource_link_ids m
 JOIN course_resources r ON r.id=m.resource_id
 JOIN course_resource_revisions v ON v.id=r.active_revision_id AND v.kind='link'
 WHERE i.expires_at>now()
   AND i.scope LIKE 'course-resource-link-create:%:' || r.course_id::text
   AND i.response_body->>'kind'='link'
   AND i.response_body->>'id'=m.legacy_id::text;
