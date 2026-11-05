ALTER TABLE course_file_texts
 ADD COLUMN progress_phase text,
 ADD COLUMN progress_completed_pages integer,
 ADD COLUMN progress_total_pages integer,
 ADD COLUMN progress_attempt integer,
 ADD CONSTRAINT course_file_texts_progress_shape CHECK (
   (progress_phase IS NULL AND progress_completed_pages IS NULL AND progress_total_pages IS NULL AND progress_attempt IS NULL)
   OR (status='pending' AND (
     (progress_phase='queued' AND progress_completed_pages IS NULL AND progress_total_pages IS NULL AND progress_attempt IS NULL)
     OR (progress_phase IN ('preparing','saving') AND progress_attempt IS NOT NULL AND progress_attempt>0 AND progress_completed_pages IS NULL AND progress_total_pages IS NULL)
     OR (progress_phase='ocr' AND progress_attempt IS NOT NULL AND progress_attempt>0 AND progress_completed_pages IS NOT NULL AND progress_total_pages IS NOT NULL AND progress_total_pages>0 AND progress_completed_pages BETWEEN 0 AND progress_total_pages)
   )) IS TRUE
 );
