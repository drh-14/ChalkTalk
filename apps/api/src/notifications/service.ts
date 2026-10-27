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

export type Notification = {
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
    const preview =
      row.response_body && !row.response_deleted
        ? responsePreview(row.response_body)
        : null;
    const destination: Notification["destination"] =
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
