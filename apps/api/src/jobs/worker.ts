import type { Pool, PoolClient } from "pg";
import type { EmailSender } from "../auth/service.js";

type Job = {
  id: string;
  kind: "delete_course" | "send_question_duplicate_email";
  payload: {
    courseId?: string;
    sourcePostId?: string;
    canonicalPostId?: string;
    staffUserId?: string;
    staffRole?: "ta" | "instructor";
  };
  deduplicationKey: string | null;
  attempts: number;
  maxAttempts: number;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown job failure";

export class JobWorker {
  constructor(
    private readonly pool: Pool,
    private readonly workerId = `api-${process.pid}`,
    private readonly emailSender?: EmailSender,
    private readonly frontendBaseUrl?: string,
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

  private async claim(): Promise<Job | undefined> {
    return this.transaction(async (client) => {
      const claimed = await client.query<{
        id: string;
        kind: Job["kind"];
        payload: Job["payload"];
        deduplication_key: string | null;
        attempts: number;
        max_attempts: number;
      }>(
        "SELECT id,kind,payload,deduplication_key,attempts,max_attempts FROM jobs WHERE kind IN ('delete_course','send_question_duplicate_email') AND ((status='queued' AND available_at <= now()) OR (status='running' AND (locked_until IS NULL OR locked_until < now()))) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
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
        deduplicationKey: job.deduplication_key,
        attempts: updated.rows[0]!.attempts,
        maxAttempts: updated.rows[0]!.max_attempts,
      };
    });
  }

  private async sendQuestionDuplicateEmail(job: Job): Promise<void> {
    if (!this.emailSender || !this.frontendBaseUrl)
      throw new Error("Question duplicate email delivery is not configured");
    const { sourcePostId, canonicalPostId, staffUserId, staffRole } =
      job.payload;
    if (
      !sourcePostId ||
      !canonicalPostId ||
      !staffUserId ||
      (staffRole !== "ta" && staffRole !== "instructor")
    )
      throw new Error("Question duplicate email job payload is invalid");
    const source = await this.pool.query<{
      title: string;
      course_id: string;
      version: string;
      email: string;
    }>(
      `SELECT p.title,p.course_id,p.version,u.email
       FROM posts p
       JOIN users u ON u.id=p.author_user_id AND u.deleted_at IS NULL
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=u.id
       JOIN courses c ON c.id=p.course_id AND c.status='active'
       JOIN posts canonical ON canonical.id=$2 AND canonical.course_id=p.course_id
         AND canonical.deleted_at IS NULL AND canonical.duplicate_status='none'
       WHERE p.id=$1 AND p.type='question' AND p.deleted_at IS NULL
         AND p.duplicate_status='confirmed' AND p.duplicate_of_post_id=$2`,
      [sourcePostId, canonicalPostId],
    );
    const post = source.rows[0];
    if (!post || job.deduplicationKey !== `${sourcePostId}:${post.version}`)
      return;
    const staff = await this.pool.query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE id=$1 AND deleted_at IS NULL",
      [staffUserId],
    );
    const role = staffRole === "ta" ? "TA" : "instructor";
    const byline = staff.rows[0]
      ? `${staff.rows[0].display_name.replace(/\s+/g, " ").trim()} (${role})`
      : staffRole === "ta"
        ? "a TA"
        : "an instructor";
    const title = post.title.replace(/\s+/g, " ").trim();
    const canonicalUrl = new URL(
      `/courses/${encodeURIComponent(post.course_id)}/posts/${encodeURIComponent(canonicalPostId)}`,
      this.frontendBaseUrl,
    ).toString();
    await this.emailSender.send({
      to: post.email,
      subject: "Your post has been marked as a duplicate",
      text: `Your question "${title}" was marked as a duplicate by ${byline}.\n\n${canonicalUrl}`,
    });
  }

  private async deleteCourse(courseId: string): Promise<void> {
    await this.transaction(async (client) => {
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
      await client.query("DELETE FROM course_memberships WHERE course_id=$1", [
        courseId,
      ]);
      await client.query("DELETE FROM courses WHERE id=$1", [courseId]);
    });
  }

  private async succeed(job: Job): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
      [job.id, this.workerId, job.attempts],
    );
  }

  private async fail(job: Job, error: unknown): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status=CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END, available_at=CASE WHEN attempts >= max_attempts THEN available_at ELSE now()+make_interval(secs => LEAST(300, (2 ^ attempts)::integer)) END, locked_by=NULL,locked_until=NULL,last_error=$1,finished_at=CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,updated_at=now() WHERE id=$2 AND status='running' AND locked_by=$3 AND attempts=$4",
      [errorMessage(error).slice(0, 4000), job.id, this.workerId, job.attempts],
    );
  }

  async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    try {
      if (job.kind === "delete_course") {
        if (!job.payload.courseId)
          throw new Error("Course deletion job payload is invalid");
        await this.deleteCourse(job.payload.courseId);
      } else {
        await this.sendQuestionDuplicateEmail(job);
      }
      await this.succeed(job);
    } catch (error) {
      await this.fail(job, error);
    }
    return true;
  }
}
