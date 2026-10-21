import type { Pool, PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";
import { recordActivity } from "../notifications/activity.js";

type Db = Pool | PoolClient;

const MINUTE = 60_000;
const YEAR = 365 * 24 * 60 * MINUTE;

/** A publish time 1 minute to 365 days from now, or a 422. */
export function scheduleTime(value: string, now = Date.now()): Date {
  const when = new Date(value);
  const time = when.getTime();
  if (Number.isNaN(time) || time < now + MINUTE || time > now + YEAR)
    throw new AuthError(
      422,
      "schedule_invalid",
      "Schedule a time between 1 minute and 365 days from now",
    );
  return when;
}

/** Queues one announcement email per other current member who wants them. */
export async function queueAnnouncementEmails(
  db: Db,
  post: { postId: string; courseId: string; authorId: string },
) {
  // One job per recipient, so a failing address retries on its own.
  await db.query(
    `INSERT INTO jobs (id,kind,payload,deduplication_key)
     SELECT gen_random_uuid(),'send_announcement_email',
       jsonb_build_object('postId',$1::uuid,'userId',m.user_id),$1::text||':'||m.user_id
     FROM course_memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
     WHERE m.course_id=$2 AND m.user_id<>$3 AND m.announcement_emails
     ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [post.postId, post.courseId, post.authorId],
  );
}

/** Queues the job that publishes a scheduled announcement at its time. */
export async function queuePublish(db: Db, postId: string, when: Date) {
  const scheduledFor = when.toISOString();
  await db.query(
    `INSERT INTO jobs (id,kind,payload,deduplication_key,available_at)
     VALUES (gen_random_uuid(),'publish_scheduled_announcement',$1,$2,$3)
     ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [{ postId, scheduledFor }, `${postId}:${scheduledFor}`, when],
  );
}

/**
 * Publishes a scheduled announcement now: it becomes new, readable, and
 * announced to every member exactly as an immediate one.
 */
export async function publishScheduled(
  db: Db,
  post: { postId: string; courseId: string; authorId: string },
) {
  await db.query(
    `UPDATE posts SET scheduled_for=NULL,created_at=clock_timestamp(),last_activity_at=clock_timestamp(),
       updated_at=now(),version=version+1
     WHERE id=$1`,
    [post.postId],
  );
  await queueAnnouncementEmails(db, post);
  await recordActivity(db, {
    courseId: post.courseId,
    postId: post.postId,
    actorId: post.authorId,
    kind: "announcement",
    follow: false,
  });
}
