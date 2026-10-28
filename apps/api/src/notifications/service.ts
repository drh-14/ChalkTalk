import type { Pool } from "pg";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { AuthError } from "../auth/errors.js";
import type { NotificationKind } from "./activity.js";
import { readablePost } from "../posts/visibility.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message: string) =>
  new AuthError(400, "invalid_request", message);

export type Notification =
  | {
      id: string;
      kind: NotificationKind;
      courseId: string;
      courseName: string;
      postId: string;
      postTitle: string;
      actor: { displayName: string } | null;
      createdAt: string;
      readAt: string | null;
    }
  | {
      id: string;
      kind: "thread_reply_created";
      courseId: string;
      courseName: string;
      threadId: string;
      threadTitle: string;
      conversationId: string;
      messageId: string;
      preview: string;
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
  created_at_precise: string;
  read_at: Date | null;
};

type ThreadRow = {
  id: string;
  course_id: string;
  course_name: string;
  board_id: string;
  board_title: string;
  conversation_id: string;
  message_id: string;
  body_markdown: string;
  actor_name: string | null;
  actor_deleted: boolean | null;
  created_at: Date;
  created_at_precise: string;
  read_at: Date | null;
};

// Visible while the caller is a member who can still read the post, and the
// post is active and not merged.
const VISIBLE = `FROM notifications n
  JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.user_id
  JOIN courses c ON c.id=n.course_id
  JOIN posts p ON p.id=n.post_id AND p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'
  LEFT JOIN users a ON a.id=n.actor_user_id
  WHERE n.user_id=$1 AND ${readablePost("p", "n.user_id", "m.role")}`;

const VISIBLE_THREAD = `FROM thread_notifications n
  JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.recipient_user_id
  JOIN courses c ON c.id=n.course_id AND c.status<>'deleting'
  JOIN thread_conversations conversation ON conversation.id=n.conversation_id
  JOIN thread_boards board ON board.id=conversation.board_id AND board.deleted_at IS NULL
  JOIN thread_messages message ON message.id=n.message_id AND message.deleted_at IS NULL
  LEFT JOIN users actor ON actor.id=n.actor_user_id
  WHERE n.recipient_user_id=$1`;

function threadPreview(markdown: string): string {
  type Node = { type: string; value?: string; alt?: string; children?: Node[] };
  const root = unified().use(remarkParse).parse(markdown) as Node;
  const text = (node: Node): string => {
    if (node.type === "html") return "";
    if (node.type === "image") return node.alt ?? "";
    if (node.type === "break") return "\n";
    if (node.value !== undefined) return node.value;
    return (node.children ?? []).map(text).join("");
  };
  const lines = (root.children ?? [])
    .map(text)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  return lines.join("\n").slice(0, 360);
}

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
    const limitParam = add(query.limit + 1);
    const rows = await this.pool.query<Row>(
      `SELECT n.id,n.kind,n.course_id,c.name AS course_name,n.post_id,p.title AS post_title,
              a.display_name AS actor_name,(a.deleted_at IS NOT NULL) AS actor_deleted,
              n.actor_anonymous,m.role AS viewer_role,n.created_at,
              to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_precise,
              n.read_at
       ${VISIBLE}${clauses.map((clause) => ` AND ${clause}`).join("")}
       ORDER BY n.created_at DESC,n.id DESC LIMIT ${limitParam}`,
      values,
    );
    const threadRows = await this.pool.query<ThreadRow>(
      `SELECT n.id,n.course_id,c.name AS course_name,board.id AS board_id,
              board.title AS board_title,n.conversation_id,n.message_id,message.body_markdown,
              actor.display_name AS actor_name,
              (actor.deleted_at IS NOT NULL) AS actor_deleted,n.created_at,
              to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_precise,
              n.read_at
       ${VISIBLE_THREAD}${clauses.map((clause) => ` AND ${clause}`).join("")}
       ORDER BY n.created_at DESC,n.id DESC LIMIT ${limitParam}`,
      values,
    );
    const combined = [
      ...rows.rows.map((row) => ({
        createdAtPrecise: row.created_at_precise,
        id: row.id,
        value: this.project(row),
      })),
      ...threadRows.rows.map((row) => ({
        createdAtPrecise: row.created_at_precise,
        id: row.id,
        value: this.projectThread(row),
      })),
    ].sort((a, b) =>
      a.createdAtPrecise === b.createdAtPrecise
        ? a.id === b.id
          ? 0
          : a.id > b.id
            ? -1
            : 1
        : a.createdAtPrecise > b.createdAtPrecise
          ? -1
          : 1,
    );
    const hasMore = combined.length > query.limit;
    const page = combined.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => row.value),
      page: {
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  u: userId,
                  f: filters,
                  t: last.createdAtPrecise,
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
      `SELECT (
        (SELECT count(*) ${VISIBLE} AND n.read_at IS NULL) +
        (SELECT count(*) ${VISIBLE_THREAD} AND n.read_at IS NULL)
       )::int AS count`,
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
      await this.pool.query(
        "UPDATE thread_notifications SET read_at=clock_timestamp() WHERE recipient_user_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL",
        [userId, ids],
      );
      return;
    }
    await this.pool.query(
      "UPDATE notifications SET read_at=clock_timestamp() WHERE user_id=$1 AND read_at IS NULL",
      [userId],
    );
    await this.pool.query(
      "UPDATE thread_notifications SET read_at=clock_timestamp() WHERE recipient_user_id=$1 AND read_at IS NULL",
      [userId],
    );
  }

  private projectThread(row: ThreadRow): Notification {
    return {
      id: row.id,
      kind: "thread_reply_created",
      courseId: row.course_id,
      courseName: row.course_name,
      threadId: row.board_id,
      threadTitle: row.board_title,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      preview: threadPreview(row.body_markdown),
      actor:
        row.actor_name === null || row.actor_deleted
          ? null
          : { displayName: row.actor_name },
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
    };
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
