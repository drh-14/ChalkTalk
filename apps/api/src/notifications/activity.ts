import type { Pool, PoolClient } from "pg";
import { readablePost } from "../posts/visibility.js";
import type { Mentions } from "./mentions.js";

type Db = Pool | PoolClient;

export type NotificationKind =
  | "answer_created"
  | "answer_edited"
  | "answer_endorsed"
  | "followup_created"
  | "reply_created"
  | "announcement"
  | "post_published"
  | "mentioned"
  | "post_staff_edited"
  | "post_merged"
  | "post_staff_deleted";

/**
 * Records a member's activity on a post inside the caller's transaction:
 * follows the post for them (unless they unfollowed it), keeps the post read
 * for them, and notifies the other followers, or every member for an
 * announcement, queueing an email for those who opted in. Announcements
 * already email every member, so they queue no notification email.
 * Members mentioned in the write get a mention notification instead.
 */
export async function recordActivity(
  db: Db,
  activity: {
    courseId: string;
    postId: string;
    actorId: string;
    kind?: Exclude<
      NotificationKind,
      "post_staff_edited" | "post_merged" | "post_staff_deleted"
    >;
    response?: { kind: "answer" | "followup"; id: string };
    anonymous?: boolean;
    /** Followers by default; the post's author alone for post_published. */
    recipients?: "followers" | "author";
    /** People the write newly mentions; on edits, only the added ones. */
    mentions?: Mentions;
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
  const mentioned = await recordMentions(db, activity);
  if (!activity.kind) return;
  const values: unknown[] = [
    courseId,
    postId,
    actorId,
    activity.kind,
    activity.anonymous ?? false,
    mentioned,
  ];
  if (activity.kind !== "announcement")
    values.push(activity.response?.kind ?? null, activity.response?.id ?? null);
  // Recipients must still be able to read the post, which may be private.
  const recipients =
    activity.kind === "announcement"
      ? `SELECT m.user_id FROM course_memberships m WHERE m.course_id=$1`
      : activity.recipients === "author"
        ? `SELECT m.user_id FROM posts p
           JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=p.author_user_id
           WHERE p.id=$2`
        : `SELECT f.user_id FROM post_follows f
           JOIN course_memberships m ON m.course_id=f.course_id AND m.user_id=f.user_id
           JOIN posts p ON p.id=f.post_id
           WHERE f.post_id=$2 AND f.following AND ${readablePost("p", "f.user_id", "m.role")}`;
  const insert = `INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id,actor_anonymous,response_kind,response_id)
       SELECT gen_random_uuid(),r.user_id,$1,$2,$4,$3,$5,${activity.kind === "announcement" ? "NULL,NULL" : "$7,$8::uuid"}
       FROM recipients r JOIN users u ON u.id=r.user_id AND u.deleted_at IS NULL
       WHERE r.user_id<>$3 AND NOT (r.user_id = ANY($6::uuid[]))`;
  await db.query(
    activity.kind === "announcement"
      ? `WITH recipients AS (${recipients}) ${insert}`
      : `WITH recipients AS (${recipients}),
     created AS (${insert} RETURNING id,user_id)
     INSERT INTO jobs (id,kind,payload,deduplication_key)
     SELECT gen_random_uuid(),'send_notification_email',jsonb_strip_nulls(jsonb_build_object('notificationId',c.id,'responseKind',$7::text,'responseId',$8::text)),c.id::text
     FROM created c JOIN course_memberships m ON m.course_id=$1 AND m.user_id=c.user_id AND m.activity_emails`,
    values,
  );
}

/**
 * Notifies mentioned members who can read the post, and every current TA and
 * instructor for @staff, returning who was notified.
 */
async function recordMentions(
  db: Db,
  activity: {
    courseId: string;
    postId: string;
    actorId: string;
    anonymous?: boolean;
    mentions?: Mentions;
    response?: { kind: "answer" | "followup"; id: string };
  },
): Promise<string[]> {
  const mentions = activity.mentions;
  if (!mentions || (!mentions.userIds.length && !mentions.staff)) return [];
  const result = await db.query<{ user_id: string }>(
    `WITH recipients AS (
       SELECT DISTINCT m.user_id FROM course_memberships m
       JOIN posts p ON p.id=$2
       JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
       WHERE m.course_id=$1 AND m.user_id<>$3
         AND (m.user_id = ANY($5::uuid[]) OR ($6 AND m.role IN ('ta','instructor')))
         AND ${readablePost("p", "m.user_id", "m.role")}
     ), created AS (
       INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id,actor_anonymous,response_kind,response_id)
       SELECT gen_random_uuid(),r.user_id,$1,$2,'mentioned',$3,$4,$7,$8::uuid FROM recipients r
       RETURNING id,user_id
     ), emails AS (
       INSERT INTO jobs (id,kind,payload,deduplication_key)
       SELECT gen_random_uuid(),'send_notification_email',jsonb_strip_nulls(jsonb_build_object('notificationId',c.id,'responseKind',$7::text,'responseId',$8::text)),c.id::text
       FROM created c JOIN course_memberships m ON m.course_id=$1 AND m.user_id=c.user_id AND m.activity_emails
     )
     SELECT user_id FROM created`,
    [
      activity.courseId,
      activity.postId,
      activity.actorId,
      activity.anonymous ?? false,
      mentions.userIds,
      mentions.staff,
      activity.response?.kind ?? null,
      activity.response?.id ?? null,
    ],
  );
  return result.rows.map((row) => row.user_id);
}

/** Persists author-only moderation events inside the post transaction. */
export async function recordPostModeration(
  db: Db,
  event: {
    courseId: string;
    postId: string;
    authorId: string | null;
    actorId: string;
    kind: "post_staff_edited" | "post_merged" | "post_staff_deleted";
    canonicalPostId?: string;
    sourceVersion?: number;
  },
): Promise<void> {
  if (!event.authorId || event.authorId === event.actorId) return;
  await db.query(
    `INSERT INTO notifications
       (id,user_id,course_id,post_id,kind,actor_user_id,canonical_post_id,source_version)
     SELECT gen_random_uuid(),m.user_id,$1,$2,$4,$5,$6::uuid,$7::bigint
     FROM course_memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
     WHERE m.course_id=$1 AND m.user_id=$3`,
    [
      event.courseId,
      event.postId,
      event.authorId,
      event.kind,
      event.actorId,
      event.canonicalPostId ?? null,
      event.sourceVersion ?? null,
    ],
  );
}
