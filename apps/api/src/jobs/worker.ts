import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { EmailSender } from "../auth/service.js";
import type { Observability } from "../observability/index.js";
import type { SemanticIndex } from "../semantic/index.js";
import { readablePost } from "../posts/visibility.js";

type Job = {
  id: string;
  kind:
    | "delete_course"
    | "delete_course_file"
    | "delete_content_attachment"
    | "send_question_duplicate_email"
    | "index_post"
    | "send_collaboration_invitation_email"
    | "send_announcement_email"
    | "send_notification_email";
  payload: {
    courseId?: string;
    objectKey?: string;
    sourcePostId?: string;
    canonicalPostId?: string;
    staffUserId?: string;
    staffRole?: "ta" | "instructor";
    sessionId?: string;
    inviteeUserId?: string;
    inviterUserId?: string;
    postId?: string;
    userId?: string;
    notificationId?: string;
    responseKind?: "answer" | "followup";
    responseId?: string;
    generation?: string;
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
    private readonly workerId = `worker-${randomUUID()}`,
    private readonly emailSender?: EmailSender,
    private readonly frontendBaseUrl?: string,
    private readonly objectStore?: { client: S3Client; bucket: string },
    private readonly observability?: Observability,
    private readonly semantic?: SemanticIndex,
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
        `SELECT id,kind,payload,deduplication_key,attempts,max_attempts FROM jobs
         WHERE (kind IN ('delete_course','delete_course_file','delete_content_attachment','send_question_duplicate_email','send_collaboration_invitation_email','send_announcement_email','send_notification_email')
           OR (kind='index_post' AND payload->>'generation'=$1))
           AND ((status='queued' AND available_at <= now())
             OR (status='running' AND (locked_until IS NULL OR locked_until < now())))
         ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [this.semantic?.config.generation ?? null],
      );
      const job = claimed.rows[0];
      if (!job) return undefined;
      const updated = await client.query<{
        attempts: number;
        max_attempts: number;
      }>(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_by=$1,locked_until=now()+CASE WHEN kind='index_post' THEN interval '5 minutes' ELSE interval '1 minute' END,updated_at=now() WHERE id=$2 RETURNING attempts,max_attempts",
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
         AND canonical.deleted_at IS NULL AND canonical.duplicate_status <> 'confirmed' AND NOT canonical.private
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

  private async sendCollaborationInvitationEmail(job: Job): Promise<void> {
    if (!this.emailSender || !this.frontendBaseUrl)
      throw new Error("Invitation email delivery is not configured");
    const { sessionId, inviteeUserId, inviterUserId } = job.payload;
    if (!sessionId || !inviteeUserId || !inviterUserId)
      throw new Error("Invitation email job payload is invalid");
    // Sends only while the invitation that queued this job still stands.
    const invitation = await this.pool.query<{
      title: string;
      course_id: string;
      course_name: string;
      email: string;
      inviter_name: string;
      invited_at_ms: string;
    }>(
      `SELECT s.title,s.course_id,c.name AS course_name,invitee.email,
              inviter.display_name AS inviter_name,
              floor(extract(epoch FROM cp.created_at)*1000)::bigint AS invited_at_ms
       FROM collaboration_sessions s
       JOIN courses c ON c.id=s.course_id AND c.status='active'
       JOIN collaboration_participants cp ON cp.collaboration_session_id=s.id AND cp.user_id=$2
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2
       JOIN users invitee ON invitee.id=$2 AND invitee.deleted_at IS NULL
       JOIN users inviter ON inviter.id=$3 AND inviter.deleted_at IS NULL
       WHERE s.id=$1 AND s.lifecycle_state='active'`,
      [sessionId, inviteeUserId, inviterUserId],
    );
    const row = invitation.rows[0];
    if (
      !row ||
      job.deduplicationKey !==
        `${sessionId}:${inviteeUserId}:${row.invited_at_ms}`
    )
      return;
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    const inviter = clean(row.inviter_name);
    const url = new URL(
      `/courses/${encodeURIComponent(row.course_id)}/sessions/${encodeURIComponent(sessionId)}`,
      this.frontendBaseUrl,
    ).toString();
    await this.emailSender.send({
      to: row.email,
      subject: `${inviter} invited you to a live session`,
      text: `${inviter} invited you to the live session "${clean(row.title)}" in ${clean(row.course_name)}.\n\n${url}\n\nOnly invited participants and course staff can open it.`,
    });
  }

  private async sendAnnouncementEmail(job: Job): Promise<void> {
    const emailSender = this.emailSender;
    if (!emailSender || !this.frontendBaseUrl)
      throw new Error("Announcement email delivery is not configured");
    const { postId, userId } = job.payload;
    if (!postId || !userId)
      throw new Error("Announcement email job payload is invalid");
    await this.transaction(async (client) => {
      const claimed = await client.query(
        "SELECT id FROM jobs WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3 FOR UPDATE",
        [job.id, this.workerId, job.attempts],
      );
      if (!claimed.rows[0]) return;
      // Sends only while the announcement stands and the recipient is a member.
      const found = await client.query<{
        title: string;
        body_markdown: string;
        course_id: string;
        course_name: string;
        author_name: string;
        email: string;
      }>(
        `SELECT p.title,p.body_markdown,p.course_id,c.name AS course_name,
              author.display_name AS author_name,recipient.email
       FROM posts p
       JOIN courses c ON c.id=p.course_id AND c.status='active'
       JOIN users author ON author.id=p.author_user_id
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=$2 AND m.announcement_emails
       JOIN users recipient ON recipient.id=$2 AND recipient.deleted_at IS NULL
       WHERE p.id=$1 AND p.announcement AND p.deleted_at IS NULL`,
        [postId, userId],
      );
      const row = found.rows[0];
      if (!row || job.deduplicationKey !== `${postId}:${userId}`) return;
      const clean = (value: string) => value.replace(/\s+/g, " ").trim();
      const limit = 2000;
      const body =
        row.body_markdown.length > limit
          ? `${row.body_markdown.slice(0, limit).trimEnd()}…`
          : row.body_markdown;
      const url = new URL(
        `/courses/${encodeURIComponent(row.course_id)}/posts/${encodeURIComponent(postId)}`,
        this.frontendBaseUrl,
      ).toString();
      await emailSender.send({
        to: row.email,
        subject: `[${clean(row.course_name)}] ${clean(row.title)}`,
        text: `${clean(row.author_name)} posted an announcement in ${clean(row.course_name)}:\n\n${clean(row.title)}\n\n${body}\n\n${url}`,
      });
      await client.query(
        "UPDATE jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
    });
  }

  private async sendNotificationEmail(job: Job): Promise<void> {
    const emailSender = this.emailSender;
    if (!emailSender || !this.frontendBaseUrl)
      throw new Error("Notification email delivery is not configured");
    const { notificationId, responseKind, responseId } = job.payload;
    if (!notificationId || job.deduplicationKey !== notificationId)
      throw new Error("Notification email job payload is invalid");
    if (
      (responseKind || responseId) &&
      (!responseId || !["answer", "followup"].includes(responseKind ?? ""))
    )
      throw new Error("Notification email response reference is invalid");
    await this.transaction(async (client) => {
      const claimed = await client.query(
        "SELECT id FROM jobs WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3 FOR UPDATE",
        [job.id, this.workerId, job.attempts],
      );
      if (!claimed.rows[0]) return;
      // Sends only while the notification is unread, the post visible, and the
      // recipient still a member who wants these emails.
      const found = await client.query<{
        kind: string;
        post_id: string;
        course_id: string;
        course_name: string;
        title: string;
        email: string;
        actor_name: string | null;
        actor_anonymous: boolean;
      }>(
        `SELECT n.kind,n.post_id,n.course_id,c.name AS course_name,p.title,recipient.email,
              CASE WHEN actor.deleted_at IS NULL THEN actor.display_name END AS actor_name,n.actor_anonymous
       FROM notifications n
       JOIN users recipient ON recipient.id=n.user_id AND recipient.deleted_at IS NULL
       JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.user_id AND m.activity_emails
       JOIN courses c ON c.id=n.course_id
       JOIN posts p ON p.id=n.post_id AND p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'
         AND ${readablePost("p", "n.user_id", "m.role")}
       LEFT JOIN users actor ON actor.id=n.actor_user_id
       WHERE n.id=$1 AND n.read_at IS NULL
         AND (n.kind IN ('mentioned','post_published') OR EXISTS (
           SELECT 1 FROM post_follows f WHERE f.post_id=n.post_id AND f.user_id=n.user_id AND f.following
         ))`,
        [notificationId],
      );
      const row = found.rows[0];
      if (!row) return;
      let excerpt: string | undefined;
      if (responseKind && responseId) {
        const response = await client.query<{ body_markdown: string }>(
          responseKind === "answer"
            ? "SELECT body_markdown FROM answers WHERE id=$1 AND post_id=$2 AND deleted_at IS NULL"
            : "SELECT body_markdown FROM followups WHERE id=$1 AND post_id=$2 AND deleted_at IS NULL",
          [responseId, row.post_id],
        );
        if (!response.rows[0]?.body_markdown) return;
        excerpt = response.rows[0].body_markdown
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join("\n")
          .slice(0, 360);
      }
      const clean = (value: string) => value.replace(/\s+/g, " ").trim();
      const wording: Record<string, [string, string]> = {
        answer_created: ["New answer on", "answered"],
        answer_edited: ["Answer updated on", "updated the answer on"],
        answer_endorsed: ["Answer endorsed on", "endorsed the answer on"],
        followup_created: ["New followup on", "posted a followup on"],
        reply_created: ["New reply on", "replied on"],
        post_published: ["Your post is now public:", "made your post public:"],
        mentioned: ["You were mentioned on", "mentioned you on"],
      };
      const [subject, verb] = wording[row.kind] ?? ["Activity on", "posted on"];
      // The email cannot tell whether the reader may see an anonymous name.
      const actor =
        row.actor_anonymous || !row.actor_name
          ? "Someone"
          : clean(row.actor_name);
      const title = clean(row.title);
      const course = clean(row.course_name);
      const url = new URL(
        `/courses/${encodeURIComponent(row.course_id)}/posts/${encodeURIComponent(row.post_id)}`,
        this.frontendBaseUrl,
      );
      if (responseKind && responseId)
        url.hash = `${responseKind}-${responseId}`;
      await emailSender.send({
        to: row.email,
        subject: `[${course}] ${subject} "${title}"`,
        text: `${actor} ${verb} "${title}" in ${course}.\n\n${excerpt ? `${excerpt}\n\n` : ""}${url.toString()}\n\nTo stop these emails, turn off "Activity emails on followed posts" in this course's settings.`,
      });
      await client.query(
        "UPDATE jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
    });
  }

  private async deleteCourse(courseId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT id FROM courses WHERE id=$1 FOR UPDATE", [
        courseId,
      ]);
      const attachments = await client.query<{ object_key: string }>(
        "SELECT object_key FROM content_attachments WHERE course_id=$1 FOR UPDATE",
        [courseId],
      );
      if (attachments.rows.length && !this.objectStore)
        throw new Error("Object storage is required to delete attachments");
      for (const attachment of attachments.rows)
        await this.objectStore!.client.send(
          new DeleteObjectCommand({
            Bucket: this.objectStore!.bucket,
            Key: attachment.object_key,
          }),
        );
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
      await client.query("DELETE FROM post_folders WHERE course_id=$1", [
        courseId,
      ]);
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
    const started = process.hrtime.bigint();
    this.observability?.recordJobStart(job.kind);
    const duration = () => Number(process.hrtime.bigint() - started) / 1e9;
    try {
      if (job.kind === "delete_course") {
        if (!job.payload.courseId)
          throw new Error("Course deletion job payload is invalid");
        await this.deleteCourse(job.payload.courseId);
      } else if (
        job.kind === "delete_course_file" ||
        job.kind === "delete_content_attachment"
      ) {
        if (!this.objectStore || !job.payload.objectKey)
          throw new Error(
            "Object storage and key are required to delete a course file",
          );
        if (job.kind === "delete_course_file") {
          const referenced = await this.pool.query(
            "SELECT 1 FROM course_information i JOIN course_files f ON f.id=i.syllabus_file_id WHERE f.object_key=$1",
            [job.payload.objectKey],
          );
          if (referenced.rowCount)
            throw new Error("File is still referenced by course information");
          const refs = await this.pool.query(
            "SELECT 1 FROM course_resources r JOIN course_resource_revisions v ON v.id=r.active_revision_id JOIN course_files f ON f.id=v.file_id WHERE r.deleted_at IS NULL AND f.object_key=$1",
            [job.payload.objectKey],
          );
          if (refs.rowCount)
            throw new Error("File is still referenced by a current resource");
        }
        await this.objectStore.client.send(
          new DeleteObjectCommand({
            Bucket: this.objectStore.bucket,
            Key: job.payload.objectKey,
          }),
        );
      } else if (job.kind === "index_post") {
        if (
          !this.semantic ||
          !job.payload.postId ||
          job.payload.generation !== this.semantic.config.generation
        )
          throw new Error("Semantic indexing job payload is invalid");
        await this.semantic.indexPost(job.payload.postId);
      } else if (job.kind === "send_notification_email") {
        await this.sendNotificationEmail(job);
      } else if (job.kind === "send_announcement_email") {
        await this.sendAnnouncementEmail(job);
      } else if (job.kind === "send_collaboration_invitation_email") {
        await this.sendCollaborationInvitationEmail(job);
      } else {
        await this.sendQuestionDuplicateEmail(job);
      }
      await this.succeed(job);
      this.observability?.recordJob(job.kind, "succeeded", duration());
    } catch (error) {
      try {
        await this.fail(job, error);
      } finally {
        this.observability?.recordJob(job.kind, "failed", duration());
      }
    }
    return true;
  }
}
