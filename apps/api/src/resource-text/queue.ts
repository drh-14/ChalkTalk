import type { PoolClient } from "pg";
import { v7 as uuid } from "uuid";

/** Marks a newly current catalog file pending and queues its one extraction job, inside the caller's transaction. */
export async function queueFileTextExtraction(
  db: PoolClient,
  courseId: string,
  fileId: string,
) {
  await db.query(
    "INSERT INTO course_file_texts(file_id,course_id) VALUES($1,$2) ON CONFLICT(file_id) DO NOTHING",
    [fileId, courseId],
  );
  await db.query(
    "INSERT INTO jobs(id,kind,payload,deduplication_key,max_attempts) VALUES($1,'extract_file_text',$2,$3,3) ON CONFLICT(kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
    [uuid(), { fileId }, `file:${fileId}`],
  );
}
