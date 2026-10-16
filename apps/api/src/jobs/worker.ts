import type { Pool, PoolClient } from "pg";
import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";

type CleanupJob = {
  id: string;
  kind: "delete_course" | "delete_course_file";
  payload: { courseId: string; objectKey?: string };
  attempts: number;
  maxAttempts: number;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown job failure";

export class JobWorker {
  constructor(
    private readonly pool: Pool,
    private readonly workerId = `api-${process.pid}`,
    private readonly objectStore?: { client: S3Client; bucket: string },
  ) {}

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async claim(): Promise<CleanupJob | undefined> {
    return this.transaction(async (client) => {
      const claimed = await client.query<{
        id: string;
        kind: CleanupJob["kind"];
        payload: CleanupJob["payload"];
        attempts: number;
        max_attempts: number;
      }>(
        "SELECT id,kind,payload,attempts,max_attempts FROM jobs WHERE kind IN ('delete_course','delete_course_file') AND ((status='queued' AND available_at <= now()) OR (status='running' AND (locked_until IS NULL OR locked_until < now()))) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      const job = claimed.rows[0];
      if (!job) return undefined;
      const updated = await client.query<{
        attempts: number;
        max_attempts: number;
      }>(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_by=$1,locked_until=now()+interval '1 minute',updated_at=now() WHERE id=$2 RETURNING attempts,max_attempts",
        [this.workerId, job.id],
      );
      return {
        id: job.id,
        kind: job.kind,
        payload: job.payload,
        attempts: updated.rows[0]!.attempts,
        maxAttempts: updated.rows[0]!.max_attempts,
      };
    });
  }

  private async deleteCourse(courseId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT id FROM courses WHERE id=$1 FOR UPDATE", [
        courseId,
      ]);
      const answers = "SELECT id FROM answers WHERE course_id=$1";
      await client.query(
        "DELETE FROM question_creation_daily_counts WHERE course_id=$1",
        [courseId],
      );
      await client.query("DELETE FROM post_view_events WHERE course_id=$1", [
        courseId,
      ]);
      await client.query(
        "DELETE FROM answer_contribution_events WHERE course_id=$1",
        [courseId],
      );
      await client.query(
        "DELETE FROM answer_endorsement_events WHERE course_id=$1",
        [courseId],
      );
      await client.query("DELETE FROM followups WHERE course_id=$1", [
        courseId,
      ]);
      await client.query(
        `DELETE FROM answer_contributors WHERE answer_id IN (${answers})`,
        [courseId],
      );
      await client.query(
        `DELETE FROM answer_collaboration_documents WHERE answer_id IN (${answers})`,
        [courseId],
      );
      await client.query("DELETE FROM answers WHERE course_id=$1", [courseId]);
      await client.query(
        "DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE course_id=$1)",
        [courseId],
      );
      await client.query(
        "UPDATE posts SET duplicate_of_post_id=NULL,duplicate_status='none' WHERE course_id=$1 AND duplicate_of_post_id IS NOT NULL",
        [courseId],
      );
      await client.query("DELETE FROM posts WHERE course_id=$1", [courseId]);
      await client.query("DELETE FROM tags WHERE course_id=$1", [courseId]);
      const objects = await client.query<{ object_key: string }>(
        "SELECT object_key FROM course_files WHERE course_id=$1 FOR UPDATE",
        [courseId],
      );
      if (objects.rows.length && !this.objectStore)
        throw new Error("Object storage is required to delete course files");
      for (const object of objects.rows)
        await this.objectStore!.client.send(
          new DeleteObjectCommand({
            Bucket: this.objectStore!.bucket,
            Key: object.object_key,
          }),
        );
      await client.query("DELETE FROM course_memberships WHERE course_id=$1", [
        courseId,
      ]);
      await client.query("DELETE FROM courses WHERE id=$1", [courseId]);
    });
  }

  private async succeed(job: CleanupJob): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
      [job.id, this.workerId, job.attempts],
    );
  }

  private async fail(job: CleanupJob, error: unknown): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status=CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END, available_at=CASE WHEN attempts >= max_attempts THEN available_at ELSE now()+make_interval(secs => LEAST(300, (2 ^ attempts)::integer)) END, locked_by=NULL,locked_until=NULL,last_error=$1,finished_at=CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,updated_at=now() WHERE id=$2 AND status='running' AND locked_by=$3 AND attempts=$4",
      [errorMessage(error).slice(0, 4000), job.id, this.workerId, job.attempts],
    );
  }

  async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    try {
      if (job.kind === "delete_course")
        await this.deleteCourse(job.payload.courseId);
      else {
        if (!this.objectStore || !job.payload.objectKey)
          throw new Error(
            "Object storage and key are required to delete a course file",
          );
        await this.objectStore.client.send(
          new DeleteObjectCommand({
            Bucket: this.objectStore.bucket,
            Key: job.payload.objectKey,
          }),
        );
      }
      await this.succeed(job);
    } catch (error) {
      await this.fail(job, error);
    }
    return true;
  }
}
