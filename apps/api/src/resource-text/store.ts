import type { Pool, PoolClient } from "pg";

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
        "UPDATE course_file_texts SET status='ready',text=$2,truncated=$3,failure_code=NULL,extracted_at=now(),updated_at=now() WHERE file_id=$1 AND status='pending'",
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
    "UPDATE course_file_texts SET status=$2,text=NULL,failure_code=$3,extracted_at=now(),updated_at=now() WHERE file_id=$1 AND status='pending'",
    [fileId, status, failureCode.slice(0, 100) || "unknown"],
  );
  return updated.rowCount === 1;
}
