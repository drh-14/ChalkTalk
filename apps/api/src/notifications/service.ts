import type { Pool } from "pg";
import { AuthError } from "../auth/errors.js";
import type { NotificationKind } from "./activity.js";
import { readablePost } from "../posts/visibility.js";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { RootContent } from "mdast";

const markdown = unified().use(remarkParse).use(remarkGfm);

function plainText(
  node: RootContent | ReturnType<typeof markdown.parse>,
): string {
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "html" || node.type === "thematicBreak") return "";
  if ("children" in node) {
    const separator = [
      "root",
      "blockquote",
      "list",
      "listItem",
      "table",
      "tableRow",
    ].includes(node.type)
      ? "\n"
      : "";
    return node.children.map(plainText).join(separator);
  }
  return "value" in node && typeof node.value === "string" ? node.value : "";
}

export function responsePreview(body: string): string {
  return plainText(markdown.parse(body))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n")
    .slice(0, 360);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message: string) =>
  new AuthError(400, "invalid_request", message);

type PostNotification = {
  id: string;
  kind: NotificationKind;
  courseId: string;
  courseName: string;
  postId: string;
  postTitle: string | null;
  preview: string | null;
  responseUnavailable: boolean;
  addressedToOwner: boolean;
  destination:
    | { kind: "course"; courseId: string }
    | { kind: "post"; postId: string }
    | { kind: "answer" | "followup"; postId: string; responseId: string };
  actor: { displayName: string } | null;
  createdAt: string;
  readAt: string | null;
};
export type Notification =
  | PostNotification
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
  post_title: string | null;
  response_kind: "answer" | "followup" | null;
  response_id: string | null;
  response_body: string | null;
  response_deleted: boolean;
  canonical_post_id: string | null;
  addressed_to_owner: boolean;
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

// One predicate for list and count. Deleted-post cards retain no text and are
// visible solely to their addressed current course member. Merge cards require
// the original merge version so unmerge/remerge cannot resurrect old cards.
const VISIBLE = `FROM notifications n
  JOIN course_memberships m ON m.course_id=n.course_id AND m.user_id=n.user_id
  JOIN courses c ON c.id=n.course_id
  JOIN posts p ON p.id=n.post_id
  LEFT JOIN posts canonical ON canonical.id=n.canonical_post_id AND canonical.course_id=n.course_id
  LEFT JOIN users a ON a.id=n.actor_user_id
  LEFT JOIN answers answer ON n.response_kind='answer' AND answer.id=n.response_id AND answer.post_id=n.post_id
  LEFT JOIN followups followup ON n.response_kind='followup' AND followup.id=n.response_id AND followup.post_id=n.post_id
  LEFT JOIN followups parent ON parent.id=followup.parent_followup_id AND parent.post_id=n.post_id
  WHERE n.user_id=$1 AND (
    (n.kind='post_staff_deleted' AND p.deleted_at IS NOT NULL)
    OR (n.kind='post_merged' AND p.deleted_at IS NULL
      AND p.duplicate_status='confirmed' AND p.duplicate_of_post_id=n.canonical_post_id
      AND p.version=n.source_version AND ${readablePost("p", "n.user_id", "m.role")}
      AND canonical.deleted_at IS NULL AND canonical.duplicate_status<>'confirmed'
      AND ${readablePost("canonical", "n.user_id", "m.role")})
    OR (n.kind NOT IN ('post_staff_deleted','post_merged') AND p.deleted_at IS NULL
      AND p.duplicate_status<>'confirmed' AND ${readablePost("p", "n.user_id", "m.role")})
  )`;

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
      `SELECT n.id,n.kind,n.course_id,c.name AS course_name,n.post_id,
              CASE WHEN n.kind='post_staff_deleted' THEN NULL ELSE p.title END AS post_title,
              n.response_kind,n.response_id,n.canonical_post_id,
              CASE WHEN n.response_kind='answer' THEN answer.body_markdown
                   WHEN n.response_kind='followup' THEN followup.body_markdown ELSE NULL END AS response_body,
              (n.response_kind IS NOT NULL AND
                ((n.response_kind='answer' AND (answer.id IS NULL OR answer.deleted_at IS NOT NULL)) OR
                 (n.response_kind='followup' AND (followup.id IS NULL OR followup.deleted_at IS NOT NULL)))) AS response_deleted,
              COALESCE((
                (n.kind IN ('answer_created','followup_created') AND p.author_user_id=n.user_id)
                OR (n.kind='reply_created' AND parent.author_user_id=n.user_id)
              ),false) AS addressed_to_owner,
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
    const preview =
      row.response_body && !row.response_deleted
        ? responsePreview(row.response_body)
        : null;
    const destination: PostNotification["destination"] =
      row.kind === "post_staff_deleted"
        ? { kind: "course", courseId: row.course_id }
        : row.kind === "post_merged"
          ? { kind: "post", postId: row.canonical_post_id! }
          : row.response_kind && row.response_id && !row.response_deleted
            ? {
                kind: row.response_kind,
                postId: row.post_id,
                responseId: row.response_id,
              }
            : { kind: "post", postId: row.post_id };
    return {
      id: row.id,
      kind: row.kind,
      courseId: row.course_id,
      courseName: row.course_name,
      postId: row.post_id,
      postTitle: row.post_title,
      preview,
      responseUnavailable: row.response_deleted,
      addressedToOwner: row.addressed_to_owner,
      destination,
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
