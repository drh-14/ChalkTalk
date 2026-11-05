ALTER TABLE course_file_searchable_pdfs
 ADD CONSTRAINT course_file_searchable_pdfs_non_ready_metadata_check
 CHECK(status='ready' OR (size_bytes IS NULL AND page_count IS NULL));
