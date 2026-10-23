import type { Pool } from "pg";
import { AuthError } from "../auth/errors.js";
import type { NotificationKind } from "./activity.js";
import { readablePost } from "../posts/visibility.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message: string) =>
  new AuthError(400, "invalid_request", message);

export type Notification = {
  id: string;
  kind: NotificationKind;
  courseId: string;
  courseName: string;
  postId: string;
  postTitle: string;
  actor: { displayName: string } | null;
  createdAt: string;
  readAt: string | null;
};

type Row = {
  id: string;
  kind: NotificationKind;
  course_id: string;
  course_name: string;
  post_id: string;
  post_title: string;
  actor_name: string | null;
  actor_deleted: boolean | null;
  actor_anonymous: boolean;
  viewer_role: string;
  created_at: Date;
  read_at: Date | null;
};

// Visible while the caller is a member who can still read the post, and the
// post is active and not merged.
const VISIBLE = `FROM notifications n
  JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.user_id
  JOIN courses c ON c.id=n.course_id
  JOIN posts p ON p.id=n.post_id AND p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'
  LEFT JOIN users a ON a.id=n.actor_user_id
  WHERE n.user_id=$1 AND ${readablePost("p", "n.user_id")}`;

export class NotificationService {
  constructor(private readonly pool: Pool) {}

  async list(
    userId: string,
    query: { limit: number; cursor?: string; unread?: boolean },
  ) {
    const filters = JSON.stringify([query.unread ?? false]);
    const values: unknown[] = [userId];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const clauses: string[] = [];
    if (query.unread) clauses.push("n.read_at IS NULL");
    if (query.cursor) {
      let decoded: { u?: string; f?: string; t?: string; i?: string };
      try {
        decoded = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw invalid("Pagination cursor is invalid");
      }
      if (
        decoded.u !== userId ||
        decoded.f !== filters ||
        typeof decoded.t !== "string" ||
        Number.isNaN(Date.parse(decoded.t)) ||
        typeof decoded.i !== "string" ||
        !UUID_PATTERN.test(decoded.i)
      )
        throw invalid("Pagination cursor is invalid");
      clauses.push(
        `(n.created_at,n.id)<(${add(decoded.t)}::timestamptz,${add(decoded.i)}::uuid)`,
      );
    }
    const rows = await this.pool.query<Row>(
      `SELECT n.id,n.kind,n.course_id,c.name AS course_name,n.post_id,p.title AS post_title,
              a.display_name AS actor_name,(a.deleted_at IS NOT NULL) AS actor_deleted,
              n.actor_anonymous,m.role AS viewer_role,n.created_at,n.read_at
       ${VISIBLE}${clauses.map((clause) => ` AND ${clause}`).join("")}
       ORDER BY n.created_at DESC,n.id DESC LIMIT ${add(query.limit + 1)}`,
      values,
    );
    const hasMore = rows.rows.length > query.limit;
    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => this.project(row)),
      page: {
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  u: userId,
                  f: filters,
                  t: last.created_at.toISOString(),
                  i: last.id,
                }),
              ).toString("base64url")
            : null,
        hasMore,
      },
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const result = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count ${VISIBLE} AND n.read_at IS NULL`,
      [userId],
    );
    return { count: result.rows[0]!.count };
  }

  /** Marks the given notifications, or all of them, read for their owner. */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    if (ids) {
      if (
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => !UUID_PATTERN.test(id))
      )
        throw new AuthError(
          422,
          "validation_failed",
          "Notification ids are invalid",
        );
      await this.pool.query(
        "UPDATE notifications SET read_at=clock_timestamp() WHERE user_id=$1 AND id = ANY($2::uuid[]) AND read_at IS NULL",
        [userId, ids],
      );
      return;
    }
    await this.pool.query(
      "UPDATE notifications SET read_at=clock_timestamp() WHERE user_id=$1 AND read_at IS NULL",
      [userId],
    );
  }

  private project(row: Row): Notification {
    const staff = row.viewer_role === "ta" || row.viewer_role === "instructor";
    return {
      id: row.id,
      kind: row.kind,
      courseId: row.course_id,
      courseName: row.course_name,
      postId: row.post_id,
      postTitle: row.post_title,
      actor:
        row.actor_anonymous && !staff
          ? { displayName: "Anonymous" }
          : row.actor_name === null || row.actor_deleted
            ? null
            : { displayName: row.actor_name },
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
    };
  }
}
