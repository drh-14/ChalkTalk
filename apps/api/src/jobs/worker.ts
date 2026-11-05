import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { buildSearchablePdf } from "../resource-text/searchable-pdf.js";
import {
  queueSearchablePdfCleanup,
  retireSearchablePdf,
} from "../resource-text/searchable-pdf-store.js";
import { publishScheduled } from "../posts/announce.js";
import type { Pool, PoolClient } from "pg";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { join } from "node:path";
import { downloadObject } from "../resource-text/download.js";
import {
  extractText,
  type ExtractionOptions,
} from "../resource-text/extract.js";
import {
  storeExtractedText,
  storeExtractionFailure,
  type ExtractedText,
} from "../resource-text/store.js";
import {
  ExtractionFailure,
  withTempDirectory,
} from "../resource-text/tools.js";
import type { EmailSender } from "../auth/service.js";
import type { Observability } from "../observability/index.js";
import type { SemanticIndex } from "../semantic/index.js";
import { readablePost } from "../posts/visibility.js";
import { queueThreadAttachmentsForCourseDeletion } from "../threads/attachments.js";
import {
  EmailConfigurationError,
  EmailQuotaError,
  PermanentEmailDeliveryError,
} from "../auth/email.js";

type OutboundMessage = Parameters<EmailSender["send"]>[0];
type EmailCandidate = { message: OutboundMessage; guard: string };
type FrozenEmail = {
  version: 1;
  provider: "smtp" | "resend";
  message: OutboundMessage;
  guard: string;
};
type EmailOutcome = "sent" | "canceled";

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
    | "send_notification_email"
    | "publish_scheduled_announcement"
    | "extract_file_text"
    | "generate_searchable_pdf"
    | "delete_searchable_pdf";
  payload: {
    fileId?: string;
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
    scheduledFor?: string;
  };
  deduplicationKey: string | null;
  attempts: number;
  maxAttempts: number;
};

export type JobLane = "general" | "extraction";

export type ResourceTextWorkerOptions = {
  maxOcrPages: number;
  ocrLanguages: string;
  /** Replaceable for tests; defaults to the real extractor. */
  extract?: (
    path: string,
    mediaType: string,
    directory: string,
    options: ExtractionOptions,
  ) => Promise<ExtractedText>;
  buildSearchablePdf?: typeof buildSearchablePdf;
  heartbeatMs?: number;
  /** Wall-clock limit shared by object download and extraction. */
  hardLimitMs?: number;
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
    private readonly resourceText?: ResourceTextWorkerOptions,
  ) {}

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    extractionJob?: Job,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let leaseUntil: string | undefined;
      if (extractionJob) {
        const owned = await client.query<{ lease_until: string }>(
          "SELECT locked_until::text AS lease_until FROM jobs WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3 AND locked_until > clock_timestamp() FOR UPDATE",
          [extractionJob.id, this.workerId, extractionJob.attempts],
        );
        if (!owned.rows[0]) throw new ExtractionFailure("lease_lost", false);
        leaseUntil = owned.rows[0].lease_until;
      }
      const value = await work(client);
      if (leaseUntil) {
        const valid = await client.query<{ valid: boolean }>(
          "SELECT $1::timestamptz > clock_timestamp() AS valid",
          [leaseUntil],
        );
        if (!valid.rows[0]!.valid)
          throw new ExtractionFailure("lease_lost", false);
      }
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async claim(lane: JobLane): Promise<Job | undefined> {
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
         WHERE ${
           lane === "extraction"
             ? "kind IN ('extract_file_text','generate_searchable_pdf') AND $1::text IS NULL"
             : `(kind IN ('delete_course','delete_course_file','delete_content_attachment','delete_searchable_pdf','send_question_duplicate_email','send_collaboration_invitation_email','send_announcement_email','publish_scheduled_announcement','send_notification_email')
           OR (kind='index_post' AND payload->>'generation'=$1))`
         }
           AND ((status='queued' AND available_at <= now())
             OR (status='running' AND (locked_until IS NULL OR locked_until < now())))
         ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [
          lane === "extraction"
            ? null
            : (this.semantic?.config.generation ?? null),
        ],
      );
      const job = claimed.rows[0];
      if (!job) return undefined;
      const updated = await client.query<{
        attempts: number;
        max_attempts: number;
      }>(
        "UPDATE jobs SET status='running',attempts=attempts+1,locked_by=$1,locked_until=now()+CASE WHEN kind='index_post' THEN interval '5 minutes' WHEN kind IN ('extract_file_text','generate_searchable_pdf') THEN interval '2 minutes' ELSE interval '1 minute' END,updated_at=now() WHERE id=$2 RETURNING attempts,max_attempts",
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

  /** Commit the provider payload before any network send, then recheck under a send-time lock. */
  private async sendQueuedEmail(
    job: Job,
    candidate: (
      client: PoolClient,
      prepared: boolean,
    ) => Promise<EmailCandidate | undefined>,
  ): Promise<EmailOutcome> {
    if (!this.emailSender) throw new Error("Email delivery is not configured");
    const cancel = (client: PoolClient, reason: string) =>
      client.query(
        "UPDATE jobs SET status='canceled',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=$4,frozen_email=NULL,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
        [job.id, this.workerId, job.attempts, reason],
      );
    const claim = (client: PoolClient) =>
      client.query<{ frozen_email: FrozenEmail | null }>(
        "SELECT frozen_email FROM jobs WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3 FOR UPDATE",
        [job.id, this.workerId, job.attempts],
      );
    const prepared = await this.transaction(async (client) => {
      const row = (await claim(client)).rows[0];
      if (!row) return false;
      if (row.frozen_email) return true;
      const current = await candidate(client, false);
      if (!current) {
        await cancel(client, "email eligibility changed");
        return false;
      }
      const message = {
        ...current.message,
        ...(this.emailSender!.defaultFrom
          ? { from: this.emailSender!.defaultFrom }
          : {}),
      };
      const frozen: FrozenEmail = {
        version: 1,
        provider: this.emailSender!.provider ?? "smtp",
        message: this.emailSender!.prepare
          ? await this.emailSender!.prepare(message)
          : message,
        guard: current.guard,
      };
      await client.query("UPDATE jobs SET frozen_email=$1 WHERE id=$2", [
        frozen,
        job.id,
      ]);
      return true;
    });
    if (!prepared) return "canceled";
    return this.transaction(async (client): Promise<EmailOutcome> => {
      const row = (await claim(client)).rows[0];
      const frozen = row?.frozen_email;
      if (!row) return "canceled";
      if (!frozen) {
        await cancel(client, "email snapshot unavailable");
        return "canceled";
      }
      if (frozen.version !== 1)
        throw new Error("Unsupported frozen email version");
      const current = await candidate(client, true);
      if (
        !current ||
        current.guard !== frozen.guard ||
        current.message.to !== frozen.message.to ||
        frozen.message.from !== this.emailSender!.defaultFrom ||
        frozen.provider !== (this.emailSender!.provider ?? "smtp")
      ) {
        await cancel(client, "email eligibility or provider changed");
        return "canceled";
      }
      await this.emailSender!.send(frozen.message, {
        signal: AbortSignal.timeout(30_000),
        idempotencyKey: `job-${job.id}`,
      });
      await this.succeed(job, client);
      return "sent";
    });
  }

  private async sendQuestionDuplicateEmail(job: Job): Promise<EmailOutcome> {
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
    return this.sendQueuedEmail(job, async (client) => {
      const source = await client.query<{
        title: string;
        course_id: string;
        version: string;
        email: string;
        source_body: string;
        canonical_body: string;
      }>(
        `SELECT p.title,p.course_id,p.version,u.email,p.body_markdown AS source_body,
              canonical.body_markdown AS canonical_body
       FROM posts p
       JOIN users u ON u.id=p.author_user_id AND u.deleted_at IS NULL
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=u.id
       JOIN courses c ON c.id=p.course_id AND c.status='active'
       JOIN posts canonical ON canonical.id=$2 AND canonical.course_id=p.course_id
         AND canonical.deleted_at IS NULL AND canonical.duplicate_status <> 'confirmed' AND NOT canonical.private
       WHERE p.id=$1 AND p.type='question' AND p.deleted_at IS NULL
         AND p.duplicate_status='confirmed' AND p.duplicate_of_post_id=$2
       FOR SHARE OF p,u,m,c,canonical`,
        [sourcePostId, canonicalPostId],
      );
      const post = source.rows[0];
      if (!post || job.deduplicationKey !== `${sourcePostId}:${post.version}`)
        return undefined;
      const staff = await client.query<{
        display_name: string;
        deleted_at: Date | null;
      }>("SELECT display_name,deleted_at FROM users WHERE id=$1 FOR SHARE", [
        staffUserId,
      ]);
      const role = staffRole === "ta" ? "TA" : "instructor";
      const byline =
        staff.rows[0] && !staff.rows[0].deleted_at
          ? `${staff.rows[0].display_name.replace(/\s+/g, " ").trim()} (${role})`
          : staffRole === "ta"
            ? "a TA"
            : "an instructor";
      const title = post.title.replace(/\s+/g, " ").trim();
      const canonicalUrl = new URL(
        `/courses/${encodeURIComponent(post.course_id)}/posts/${encodeURIComponent(canonicalPostId)}`,
        this.frontendBaseUrl,
      ).toString();
      return {
        message: {
          to: post.email,
          subject: "Your post has been marked as a duplicate",
          text: `Your question "${title}" was marked as a duplicate by ${byline}.\n\n${canonicalUrl}`,
        },
        guard: JSON.stringify([
          post.email,
          post.title,
          post.source_body,
          post.canonical_body,
          byline,
        ]),
      };
    });
  }

  private async sendCollaborationInvitationEmail(
    job: Job,
  ): Promise<EmailOutcome> {
    if (!this.emailSender || !this.frontendBaseUrl)
      throw new Error("Invitation email delivery is not configured");
    const { sessionId, inviteeUserId, inviterUserId } = job.payload;
    if (!sessionId || !inviteeUserId || !inviterUserId)
      throw new Error("Invitation email job payload is invalid");
    // Sends only while the invitation that queued this job still stands.
    return this.sendQueuedEmail(job, async (client, prepared) => {
      const invitation = await client.query<{
        title: string;
        course_id: string;
        course_name: string;
        email: string;
        invited_at_ms: string;
        invited_at_exact: string;
      }>(
        `SELECT s.title,s.course_id,c.name AS course_name,invitee.email,
              floor(extract(epoch FROM cp.created_at)*1000)::bigint AS invited_at_ms,
              cp.created_at::text AS invited_at_exact
       FROM collaboration_sessions s
       JOIN courses c ON c.id=s.course_id AND c.status='active'
       JOIN collaboration_participants cp ON cp.collaboration_session_id=s.id AND cp.user_id=$2
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2
       JOIN users invitee ON invitee.id=$2 AND invitee.deleted_at IS NULL
       WHERE s.id=$1 AND s.lifecycle_state='active'
       FOR SHARE OF s,c,cp,m,invitee`,
        [sessionId, inviteeUserId],
      );
      const row = invitation.rows[0];
      if (
        !row ||
        (!prepared &&
          job.deduplicationKey !==
            `${sessionId}:${inviteeUserId}:${row.invited_at_ms}`)
      )
        return undefined;
      const inviterIdentity = await client.query<{
        display_name: string;
        deleted_at: Date | null;
      }>("SELECT display_name,deleted_at FROM users WHERE id=$1 FOR SHARE", [
        inviterUserId,
      ]);
      const clean = (value: string) => value.replace(/\s+/g, " ").trim();
      const inviterRow = inviterIdentity.rows[0];
      const inviter =
        inviterRow && !inviterRow.deleted_at
          ? clean(inviterRow.display_name)
          : "A course member";
      const url = new URL(
        `/courses/${encodeURIComponent(row.course_id)}/sessions/${encodeURIComponent(sessionId)}`,
        this.frontendBaseUrl,
      ).toString();
      return {
        message: {
          to: row.email,
          subject: `${inviter} invited you to a live session`,
          text: `${inviter} invited you to the live session "${clean(row.title)}" in ${clean(row.course_name)}.\n\n${url}\n\nOnly current session participants can open it.`,
        },
        guard: JSON.stringify([
          row.email,
          row.invited_at_exact,
          row.title,
          inviter,
          row.course_name,
        ]),
      };
    });
  }

  private async sendAnnouncementEmail(job: Job): Promise<EmailOutcome> {
    if (!this.emailSender || !this.frontendBaseUrl)
      throw new Error("Announcement email delivery is not configured");
    const { postId, userId } = job.payload;
    if (!postId || !userId)
      throw new Error("Announcement email job payload is invalid");
    return this.sendQueuedEmail(job, async (client, prepared) => {
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
       JOIN users author ON author.id=p.author_user_id AND author.deleted_at IS NULL
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=$2 AND m.announcement_emails
       JOIN users recipient ON recipient.id=$2 AND recipient.deleted_at IS NULL
       WHERE p.id=$1 AND p.announcement AND p.deleted_at IS NULL AND p.scheduled_for IS NULL
       FOR SHARE OF p,c,author,recipient FOR KEY SHARE OF m`,
        [postId, userId],
      );
      const row = found.rows[0];
      if (!row || (!prepared && job.deduplicationKey !== `${postId}:${userId}`))
        return undefined;
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
      return {
        message: {
          to: row.email,
          subject: `[${clean(row.course_name)}] ${clean(row.title)}`,
          text: `${clean(row.author_name)} posted an announcement in ${clean(row.course_name)}:\n\n${clean(row.title)}\n\n${body}\n\n${url}`,
        },
        guard: JSON.stringify([
          row.email,
          row.title,
          row.body_markdown,
          clean(row.author_name),
          row.course_name,
        ]),
      };
    });
  }

  private async sendNotificationEmail(job: Job): Promise<EmailOutcome> {
    if (!this.emailSender || !this.frontendBaseUrl)
      throw new Error("Notification email delivery is not configured");
    const { notificationId, responseKind, responseId } = job.payload;
    if (!notificationId || job.deduplicationKey !== notificationId)
      throw new Error("Notification email job payload is invalid");
    if (
      (responseKind || responseId) &&
      (!responseId || !["answer", "followup"].includes(responseKind ?? ""))
    )
      throw new Error("Notification email response reference is invalid");
    return this.sendQueuedEmail(job, async (client) => {
      // A frozen payload never overrides current follow, read, membership,
      // privacy, or course-state checks.
      const found = await client.query<{
        kind: string;
        post_id: string;
        course_id: string;
        course_name: string;
        title: string;
        body_markdown: string;
        private: boolean;
        author_user_id: string | null;
        recipient_user_id: string;
        actor_user_id: string | null;
        email: string;
        actor_anonymous: boolean;
      }>(
        `SELECT n.kind,n.post_id,n.course_id,c.name AS course_name,p.title,p.body_markdown,
              p.private,p.author_user_id,n.user_id AS recipient_user_id,
              recipient.email,n.actor_user_id,n.actor_anonymous
       FROM notifications n
       JOIN users recipient ON recipient.id=n.user_id AND recipient.deleted_at IS NULL
       JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.user_id AND m.activity_emails
       JOIN courses c ON c.id=n.course_id AND c.status='active'
       JOIN posts p ON p.id=n.post_id AND p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'
         AND ${readablePost("p", "n.user_id", "m.role")}
       WHERE n.id=$1 AND n.read_at IS NULL
         AND (n.kind IN ('mentioned','post_published') OR EXISTS (
           SELECT 1 FROM post_follows f WHERE f.post_id=n.post_id AND f.user_id=n.user_id AND f.following
         ))
       FOR SHARE OF n,recipient,c,p FOR KEY SHARE OF m`,
        [notificationId],
      );
      const row = found.rows[0];
      if (!row) return undefined;
      if (row.private) {
        const membership = await client.query<{ role: string }>(
          `SELECT role FROM course_memberships
            WHERE course_id=$1 AND user_id=$2 AND activity_emails FOR SHARE`,
          [row.course_id, row.recipient_user_id],
        );
        if (
          !membership.rows[0] ||
          (row.author_user_id !== row.recipient_user_id &&
            !["ta", "instructor"].includes(membership.rows[0].role))
        )
          return undefined;
      }
      let excerpt: string | undefined;
      let responseBody: string | undefined;
      if (responseKind && responseId) {
        const response = await client.query<{ body_markdown: string }>(
          responseKind === "answer"
            ? "SELECT body_markdown FROM answers WHERE id=$1 AND post_id=$2 AND deleted_at IS NULL FOR SHARE"
            : "SELECT body_markdown FROM followups WHERE id=$1 AND post_id=$2 AND deleted_at IS NULL FOR SHARE",
          [responseId, row.post_id],
        );
        if (!response.rows[0]?.body_markdown) return undefined;
        responseBody = response.rows[0].body_markdown;
        excerpt = responseBody
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
      const actorUser = row.actor_user_id
        ? (
            await client.query<{
              display_name: string;
              deleted_at: Date | null;
            }>(
              "SELECT display_name,deleted_at FROM users WHERE id=$1 FOR SHARE",
              [row.actor_user_id],
            )
          ).rows[0]
        : undefined;
      if (row.actor_user_id && (!actorUser || actorUser.deleted_at))
        return undefined;
      const actor =
        row.actor_anonymous || !actorUser
          ? "Someone"
          : clean(actorUser.display_name);
      const title = clean(row.title);
      const course = clean(row.course_name);
      const url = new URL(
        `/courses/${encodeURIComponent(row.course_id)}/posts/${encodeURIComponent(row.post_id)}`,
        this.frontendBaseUrl,
      );
      if (responseKind && responseId)
        url.hash = `${responseKind}-${responseId}`;
      return {
        message: {
          to: row.email,
          subject: `[${course}] ${subject} "${title}"`,
          text: `${actor} ${verb} "${title}" in ${course}.\n\n${excerpt ? `${excerpt}\n\n` : ""}${url.toString()}\n\nTo stop these emails, turn off "Activity emails on followed posts" in this course's settings.`,
        },
        guard: JSON.stringify([
          row.email,
          row.title,
          responseBody ?? row.body_markdown,
          actor,
          actorUser
            ? [
                row.actor_user_id,
                row.actor_anonymous ? null : actorUser.display_name,
              ]
            : null,
          row.course_name,
        ]),
      };
    });
  }

  /** Publishes an announcement only if it is still scheduled for this time. */
  private async publishScheduledAnnouncement(job: Job): Promise<void> {
    const { postId, scheduledFor } = job.payload;
    if (
      !postId ||
      !scheduledFor ||
      job.deduplicationKey !== `${postId}:${scheduledFor}`
    )
      throw new Error("Scheduled announcement job payload is invalid");
    await this.transaction(async (client) => {
      const found = await client.query<{
        course_id: string;
        author_user_id: string | null;
        scheduled_for: Date | null;
        course_status: string;
      }>(
        `SELECT p.course_id,p.author_user_id,p.scheduled_for,c.status AS course_status
         FROM posts p JOIN courses c ON c.id=p.course_id
         WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p`,
        [postId],
      );
      const post = found.rows[0];
      if (
        !post?.author_user_id ||
        post.scheduled_for?.toISOString() !== scheduledFor ||
        post.course_status !== "active"
      )
        return;
      await publishScheduled(client, {
        postId,
        courseId: post.course_id,
        authorId: post.author_user_id,
      });
    });
  }

  private async deleteCourse(courseId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT id FROM courses WHERE id=$1 FOR UPDATE", [
        courseId,
      ]);
      const derivedFiles = await client.query<{ id: string }>(
        "SELECT id FROM course_files WHERE course_id=$1 ORDER BY id FOR UPDATE",
        [courseId],
      );
      for (const file of derivedFiles.rows)
        await retireSearchablePdf(client, file.id);
      // Queue object removal before the course cascade removes attachment metadata.
      // The existing deletion job retries independently if the object store is down.
      await queueThreadAttachmentsForCourseDeletion(client, courseId);
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

  private async succeed(
    job: Job,
    client: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await client.query(
      "UPDATE jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL,frozen_email=NULL,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
      [job.id, this.workerId, job.attempts],
    );
  }

  private async fail(job: Job, error: unknown): Promise<void> {
    const permanent =
      error instanceof PermanentEmailDeliveryError ||
      (error instanceof ExtractionFailure && error.permanent);
    const configuration =
      error instanceof EmailConfigurationError ||
      error instanceof EmailQuotaError;
    if (error instanceof ExtractionFailure && error.code === "lease_lost")
      return;
    if (error instanceof ExtractionFailure && error.code === "shutdown") {
      await this.pool.query(
        "UPDATE jobs SET status='queued',attempts=attempts-1,available_at=now(),locked_by=NULL,locked_until=NULL,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
        [job.id, this.workerId, job.attempts],
      );
      return;
    }
    if (
      error instanceof ExtractionFailure &&
      error.code === "object_store_unavailable"
    ) {
      await this.pool.query(
        "UPDATE jobs SET status='queued',attempts=attempts-1,available_at=now()+interval '60 seconds',locked_by=NULL,locked_until=NULL,last_error=$4,updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
        [job.id, this.workerId, job.attempts, error.code],
      );
      return;
    }
    try {
      await this.transaction(
        async (client) => {
          const updated = await client.query(
            "UPDATE jobs SET status=CASE WHEN NOT $6 AND ($5 OR attempts >= max_attempts) THEN 'dead' ELSE 'queued' END, available_at=CASE WHEN $6 THEN now()+interval '15 minutes' WHEN $5 OR attempts >= max_attempts THEN available_at ELSE now()+make_interval(secs => LEAST(300, (2 ^ attempts)::integer)) END, locked_by=NULL,locked_until=NULL,last_error=$1,finished_at=CASE WHEN NOT $6 AND ($5 OR attempts >= max_attempts) THEN now() ELSE NULL END,frozen_email=CASE WHEN NOT $6 AND ($5 OR attempts >= max_attempts) THEN NULL ELSE frozen_email END,updated_at=now() WHERE id=$2 AND status='running' AND locked_by=$3 AND attempts=$4",
            [
              errorMessage(error).slice(0, 4000),
              job.id,
              this.workerId,
              job.attempts,
              permanent,
              configuration,
            ],
          );
          if (
            updated.rowCount === 1 &&
            job.kind === "extract_file_text" &&
            job.payload.fileId &&
            job.attempts >= job.maxAttempts
          )
            await storeExtractionFailure(
              client,
              job.payload.fileId,
              "failed",
              "retries_exhausted",
            );
          if (
            updated.rowCount === 1 &&
            job.kind === "generate_searchable_pdf" &&
            job.payload.fileId &&
            (permanent || job.attempts >= job.maxAttempts)
          ) {
            await client.query(
              "UPDATE course_file_searchable_pdfs SET status='failed',failure_code=$3,updated_at=now() WHERE file_id=$1 AND generation=$2 AND status='pending'",
              [job.payload.fileId, job.payload.generation, "generation_failed"],
            );
          }
        },
        ["extract_file_text", "generate_searchable_pdf"].includes(job.kind)
          ? job
          : undefined,
      );
    } catch (failure) {
      if (!(
        failure instanceof ExtractionFailure && failure.code === "lease_lost"
      ))
        throw failure;
    }
  }

  /**
   * Keeps an extraction job's lease alive while `work` runs, aborting it if
   * the lease is lost, the hard time limit passes or the worker shuts down.
   * Only the final attempt gets a soft OCR deadline.
   */
  private async withExtractionLease(
    job: Job,
    shutdown: AbortSignal | undefined,
    work: (signal: AbortSignal, deadline: number | undefined) => Promise<void>,
  ): Promise<void> {
    const options = this.resourceText!,
      controller = new AbortController(),
      started = Date.now();
    const stop = () =>
      controller.abort(new ExtractionFailure("shutdown", false));
    if (shutdown?.aborted) stop();
    else shutdown?.addEventListener("abort", stop, { once: true });
    const heartbeat = setInterval(() => {
      this.pool
        .query(
          "UPDATE jobs SET locked_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3",
          [job.id, this.workerId, job.attempts],
        )
        .then(
          (result) => {
            if (result.rowCount !== 1)
              controller.abort(new ExtractionFailure("lease_lost", false));
          },
          () => controller.abort(new ExtractionFailure("lease_lost", false)),
        );
    }, options.heartbeatMs ?? 30_000);
    const limit = setTimeout(
      () =>
        controller.abort(
          new ExtractionFailure(
            "extraction_timeout",
            job.kind === "generate_searchable_pdf",
          ),
        ),
      options.hardLimitMs ?? 15 * 60_000,
    );
    try {
      await work(
        controller.signal,
        job.attempts >= job.maxAttempts ? started + 12 * 60_000 : undefined,
      );
      if (controller.signal.aborted) throw controller.signal.reason;
    } catch (error) {
      if (
        controller.signal.reason instanceof ExtractionFailure &&
        controller.signal.reason.code === "extraction_timeout" &&
        error instanceof ExtractionFailure &&
        error.code === "object_store_unavailable"
      )
        throw error;
      throw controller.signal.aborted ? controller.signal.reason : error;
    } finally {
      clearInterval(heartbeat);
      clearTimeout(limit);
      shutdown?.removeEventListener("abort", stop);
    }
  }

  private async extractFileText(
    job: Job,
    shutdown?: AbortSignal,
  ): Promise<void> {
    const fileId = job.payload.fileId;
    if (!this.objectStore || !this.resourceText || !fileId)
      throw new Error(
        "Object storage, extraction settings and a file are required to extract text",
      );
    const found = await this.pool.query<{
      object_key: string;
      media_type: string;
    }>(
      "SELECT f.object_key,f.media_type FROM course_file_texts t JOIN course_files f ON f.id=t.file_id AND f.course_id=t.course_id WHERE t.file_id=$1 AND t.status='pending' AND f.deleted_at IS NULL",
      [fileId],
    );
    const file = found.rows[0];
    if (!file) return;
    const store = this.objectStore,
      options = this.resourceText;
    await this.withExtractionLease(job, shutdown, (signal, deadline) =>
      withTempDirectory(async (directory) => {
        const path = join(directory, "source");
        await downloadObject(store, file.object_key, path, signal);
        let result: ExtractedText;
        try {
          result = await (options.extract ?? extractText)(
            path,
            file.media_type,
            directory,
            {
              maxOcrPages: options.maxOcrPages,
              ocrLanguages: options.ocrLanguages,
              signal,
              deadline,
            },
          );
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (error instanceof ExtractionFailure && error.permanent) {
            await this.transaction(
              (client) =>
                storeExtractionFailure(
                  client,
                  fileId,
                  error.code === "unsupported_media_type"
                    ? "unsupported"
                    : "failed",
                  error.code,
                ),
              job,
            );
            return;
          }
          throw error;
        }
        if (signal.aborted) throw signal.reason;
        await this.transaction(
          (client) => storeExtractedText(client, fileId, result),
          job,
        );
      }),
    );
  }

  private async generateSearchablePdf(
    job: Job,
    shutdown?: AbortSignal,
  ): Promise<void> {
    const { fileId, generation } = job.payload;
    if (!this.objectStore || !this.resourceText || !fileId || !generation)
      throw new Error("PDF generation configuration missing");
    const found = await this.pool.query<{
      object_key: string;
      course_id: string;
    }>(
      "SELECT f.object_key,f.course_id FROM course_files f JOIN course_file_searchable_pdfs d ON d.file_id=f.id JOIN course_resource_revisions v ON v.file_id=f.id JOIN course_resources r ON r.active_revision_id=v.id AND r.deleted_at IS NULL JOIN courses c ON c.id=f.course_id AND c.status IN ('active','archived') WHERE f.id=$1 AND f.deleted_at IS NULL AND d.generation=$2 AND d.status='pending'",
      [fileId, generation],
    );
    const source = found.rows[0];
    if (!source) return;
    const store = this.objectStore,
      options = this.resourceText;
    let uploadedKey: string | undefined,
      published = false;
    try {
      await this.withExtractionLease(job, shutdown, (signal) =>
        withTempDirectory(async (directory) => {
          const input = join(directory, "source.pdf");
          await downloadObject(store, source.object_key, input, signal);
          const result = await (
            options.buildSearchablePdf ?? buildSearchablePdf
          )(input, directory, {
            maxOcrPages: options.maxOcrPages,
            ocrLanguages: options.ocrLanguages,
            signal,
          });
          uploadedKey = `courses/${source.course_id}/searchable-pdfs/${fileId}/${generation}/${randomUUID()}.pdf`;
          await store.client.send(
            new PutObjectCommand({
              Bucket: store.bucket,
              Key: uploadedKey,
              Body: createReadStream(result.path),
              ContentLength: result.sizeBytes,
              ContentType: "application/pdf",
            }),
            { abortSignal: signal },
          );
          if (signal.aborted) throw signal.reason;
          published = await this.transaction(async (db) => {
            await db.query("SELECT id FROM courses WHERE id=$1 FOR SHARE", [
              source.course_id,
            ]);
            await db.query(
              "SELECT id FROM course_files WHERE id=$1 FOR UPDATE",
              [fileId],
            );
            const active = await db.query(
              "SELECT 1 FROM course_files f JOIN course_resource_revisions v ON v.file_id=f.id JOIN course_resources r ON r.active_revision_id=v.id AND r.deleted_at IS NULL JOIN courses c ON c.id=f.course_id AND c.status IN ('active','archived') WHERE f.id=$1 AND f.deleted_at IS NULL",
              [fileId],
            );
            if (!active.rowCount) return false;
            const updated = await db.query(
              "UPDATE course_file_searchable_pdfs SET status='ready',object_key=$3,size_bytes=$4,page_count=$5,failure_code=NULL,updated_at=now() WHERE file_id=$1 AND generation=$2 AND status='pending'",
              [
                fileId,
                generation,
                uploadedKey,
                result.sizeBytes,
                result.pageCount,
              ],
            );
            return updated.rowCount === 1;
          }, job);
        }),
      );
    } finally {
      if (uploadedKey && !published) {
        try {
          await this.transaction(async (db) => {
            await db.query("SELECT id FROM courses WHERE id=$1 FOR SHARE", [
              source.course_id,
            ]);
            await db.query(
              "SELECT id FROM course_files WHERE id=$1 FOR UPDATE",
              [fileId],
            );
            const refs = await db.query(
              "SELECT 1 FROM course_file_searchable_pdfs WHERE object_key=$1",
              [uploadedKey],
            );
            // A lost COMMIT acknowledgment may mean publication actually succeeded.
            if (!refs.rowCount)
              await store.client.send(
                new DeleteObjectCommand({
                  Bucket: store.bucket,
                  Key: uploadedKey,
                }),
              );
          });
        } catch {
          await this.transaction((db) =>
            queueSearchablePdfCleanup(db, uploadedKey!, fileId),
          );
        }
      }
    }
  }

  async runOnce(
    lane: JobLane = "general",
    shutdown?: AbortSignal,
  ): Promise<boolean> {
    const job = await this.claim(lane);
    if (!job) return false;
    const started = process.hrtime.bigint();
    this.observability?.recordJobStart(job.kind);
    const duration = () => Number(process.hrtime.bigint() - started) / 1e9;
    try {
      let emailOutcome: EmailOutcome | undefined;
      if (job.kind === "delete_course") {
        if (!job.payload.courseId)
          throw new Error("Course deletion job payload is invalid");
        await this.deleteCourse(job.payload.courseId);
      } else if (job.kind === "delete_searchable_pdf") {
        if (!this.objectStore || !job.payload.objectKey)
          throw Error("Derived cleanup configuration missing");
        await this.transaction(async (db) => {
          if (job.payload.fileId) {
            await db.query(
              "SELECT c.id FROM courses c JOIN course_files f ON f.course_id=c.id WHERE f.id=$1 FOR SHARE OF c",
              [job.payload.fileId],
            );
            await db.query(
              "SELECT id FROM course_files WHERE id=$1 FOR UPDATE",
              [job.payload.fileId],
            );
          }
          const active = await db.query(
            "SELECT 1 FROM course_file_searchable_pdfs WHERE object_key=$1",
            [job.payload.objectKey],
          );
          if (active.rowCount) return;
          await this.objectStore!.client.send(
            new DeleteObjectCommand({
              Bucket: this.objectStore!.bucket,
              Key: job.payload.objectKey,
            }),
          );
        });
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
        if (job.kind === "delete_course_file")
          await this.pool.query(
            "DELETE FROM course_file_texts WHERE file_id IN (SELECT id FROM course_files WHERE object_key=$1)",
            [job.payload.objectKey],
          );
      } else if (job.kind === "index_post") {
        if (
          !this.semantic ||
          !job.payload.postId ||
          job.payload.generation !== this.semantic.config.generation
        )
          throw new Error("Semantic indexing job payload is invalid");
        await this.semantic.indexPost(job.payload.postId);
      } else if (job.kind === "generate_searchable_pdf") {
        await this.generateSearchablePdf(job, shutdown);
      } else if (job.kind === "extract_file_text") {
        await this.extractFileText(job, shutdown);
      } else if (job.kind === "publish_scheduled_announcement") {
        await this.publishScheduledAnnouncement(job);
      } else if (job.kind === "send_notification_email") {
        emailOutcome = await this.sendNotificationEmail(job);
      } else if (job.kind === "send_announcement_email") {
        emailOutcome = await this.sendAnnouncementEmail(job);
      } else if (job.kind === "send_collaboration_invitation_email") {
        emailOutcome = await this.sendCollaborationInvitationEmail(job);
      } else {
        emailOutcome = await this.sendQuestionDuplicateEmail(job);
      }
      if (emailOutcome === undefined) await this.succeed(job);
      this.observability?.recordJob(
        job.kind,
        emailOutcome === "canceled" ? "canceled" : "succeeded",
        duration(),
      );
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
