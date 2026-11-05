import type { Pool, PoolClient } from "pg";
export type RunningTextProgress =
  | {
      phase: "preparing" | "saving";
      completedPages: null;
      totalPages: null;
    }
  | { phase: "ocr"; completedPages: number; totalPages: number };
export type TextProgress =
  | RunningTextProgress
  | { phase: "queued"; completedPages: null; totalPages: null };
export const clearTextProgress =
  "progress_phase=NULL,progress_completed_pages=NULL,progress_total_pages=NULL,progress_attempt=NULL";
/** Caller holds the owned, unexpired extraction job lock. No course/file locks invert deletion ordering. */
export async function storeTextProgress(
  db: PoolClient,
  fileId: string,
  attempt: number,
  progress: RunningTextProgress,
) {
  const updated = await db.query(
    `UPDATE course_file_texts t SET progress_phase=$3,progress_completed_pages=$4,progress_total_pages=$5,progress_attempt=$2,updated_at=now()
     WHERE t.file_id=$1 AND t.status='pending' AND EXISTS (
       SELECT 1 FROM course_files f JOIN course_resource_revisions v ON v.file_id=f.id
       JOIN course_resources r ON r.active_revision_id=v.id AND r.deleted_at IS NULL
       JOIN courses c ON c.id=r.course_id AND c.status IN ('active','archived')
       WHERE f.id=t.file_id AND f.deleted_at IS NULL)`,
    [
      fileId,
      attempt,
      progress.phase,
      progress.completedPages,
      progress.totalPages,
    ],
  );
  return updated.rowCount === 1;
}

export type ExtractedText = {
  text: string;
  truncated: boolean;
};

/** PostgreSQL rejects tsvectors over 1 MB; text that dense is shortened rather than failed. */
const TSVECTOR_TOO_LONG = "54000";

/**
 * Stores a finished extraction while the file is still pending. Returns false
 * when the row is gone or already final, so a stale or duplicate run never
 * overwrites a result.
 */
export async function storeExtractedText(
  client: PoolClient,
  fileId: string,
  result: ExtractedText,
): Promise<boolean> {
  let { text, truncated } = result;
  for (;;) {
    await client.query("SAVEPOINT extracted_text");
    try {
      const updated = await client.query(
        `UPDATE course_file_texts SET ${clearTextProgress},status='ready',text=$2,truncated=$3,failure_code=NULL,extracted_at=now(),updated_at=now() WHERE file_id=$1 AND status='pending'`,
        [fileId, text, truncated],
      );
      await client.query("RELEASE SAVEPOINT extracted_text");
      return updated.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT extracted_text");
      await client.query("RELEASE SAVEPOINT extracted_text");
      if ((error as { code?: string }).code !== TSVECTOR_TOO_LONG || !text)
        throw error;
      const codePoints = [...text];
      text = codePoints
        .slice(0, Math.floor(codePoints.length * 0.75))
        .join("")
        .trimEnd();
      truncated = true;
    }
  }
}

/** Records a final failure for a pending file; internal codes are never exposed by the API. */
export async function storeExtractionFailure(
  pool: Pool | PoolClient,
  fileId: string,
  status: "failed" | "unsupported",
  failureCode: string,
): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE course_file_texts SET ${clearTextProgress},status=$2,text=NULL,failure_code=$3,extracted_at=now(),updated_at=now() WHERE file_id=$1 AND status='pending'`,
    [fileId, status, failureCode.slice(0, 100) || "unknown"],
  );
  return updated.rowCount === 1;
}
