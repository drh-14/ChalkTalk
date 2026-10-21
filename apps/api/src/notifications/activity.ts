import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export type NotificationKind =
  | "answer_created"
  | "answer_edited"
  | "answer_endorsed"
  | "followup_created"
  | "reply_created"
  | "announcement";

/**
 * Records a member's activity on a post inside the caller's transaction:
 * follows the post for them (unless they unfollowed it), keeps the post read
 * for them, and notifies the other followers, or every member for an
 * announcement, queueing an email for those who opted in. Announcements
 * already email every member, so they queue no notification email.
 */
export async function recordActivity(
  db: Db,
  activity: {
    courseId: string;
    postId: string;
    actorId: string;
    kind?: NotificationKind;
    anonymous?: boolean;
    follow: boolean;
  },
): Promise<void> {
  const { courseId, postId, actorId } = activity;
  if (activity.follow)
    await db.query(
      `INSERT INTO post_follows (post_id,course_id,user_id,following) VALUES ($1,$2,$3,true)
       ON CONFLICT (post_id,user_id) DO NOTHING`,
      [postId, courseId, actorId],
    );
  await db.query(
    `INSERT INTO post_reads (post_id,user_id,read_at) VALUES ($1,$2,clock_timestamp())
     ON CONFLICT (post_id,user_id) DO UPDATE SET read_at=excluded.read_at`,
    [postId, actorId],
  );
  if (!activity.kind) return;
  const recipients =
    activity.kind === "announcement"
      ? `SELECT m.user_id FROM course_memberships m WHERE m.course_id=$1`
      : `SELECT f.user_id FROM post_follows f
         JOIN course_memberships m ON m.course_id=f.course_id AND m.user_id=f.user_id
         WHERE f.post_id=$2 AND f.following`;
  const insert = `INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id,actor_anonymous)
       SELECT gen_random_uuid(),r.user_id,$1,$2,$4,$3,$5
       FROM recipients r JOIN users u ON u.id=r.user_id AND u.deleted_at IS NULL
       WHERE r.user_id<>$3`;
  await db.query(
    activity.kind === "announcement"
      ? `WITH recipients AS (${recipients}) ${insert}`
      : `WITH recipients AS (${recipients}),
     created AS (${insert} RETURNING id,user_id)
     INSERT INTO jobs (id,kind,payload,deduplication_key)
     SELECT gen_random_uuid(),'send_notification_email',jsonb_build_object('notificationId',c.id),c.id::text
     FROM created c JOIN users u ON u.id=c.user_id AND u.notification_emails`,
    [courseId, postId, actorId, activity.kind, activity.anonymous ?? false],
  );
}
