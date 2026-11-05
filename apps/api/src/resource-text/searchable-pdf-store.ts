import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export async function queueSearchablePdfCleanup(
  db: PoolClient,
  objectKey: string,
  fileId?: string,
) {
  await db.query(
    "INSERT INTO jobs(id,kind,payload,deduplication_key) VALUES($1,'delete_searchable_pdf',$2,$3) ON CONFLICT(kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
    [randomUUID(), { objectKey, fileId }, `searchable-pdf-delete:${objectKey}`],
  );
}

/** Caller holds the source file lock. Keep cleanup durable before losing metadata. */
export async function retireSearchablePdf(db: PoolClient, fileId: string) {
  const rows = await db.query<{ object_key: string | null }>(
    "SELECT object_key FROM course_file_searchable_pdfs WHERE file_id=$1 FOR UPDATE",
    [fileId],
  );
  if (rows.rows[0]?.object_key)
    await queueSearchablePdfCleanup(db, rows.rows[0].object_key, fileId);
  await db.query("DELETE FROM course_file_searchable_pdfs WHERE file_id=$1", [
    fileId,
  ]);
}
