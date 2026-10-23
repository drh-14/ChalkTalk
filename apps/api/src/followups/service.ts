import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import { assertPostVisible } from "../posts/visibility.js";
import { recordActivity } from "../notifications/activity.js";
import { newMentions, parseMentions } from "../notifications/mentions.js";
import {
  hideAttachmentsForParent,
  listAttachments,
  type Attachment,
} from "../content-attachments/service.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Row = {
  id: string;
  course_id: string;
  post_id: string;
  parent_followup_id: string | null;
  author_user_id: string;
  body_markdown: string | null;
  anonymous: boolean;
  deleted_at: Date | null;
  resolved_at: Date | null;
  created_order: string;
  updated_at: Date;
  version: string;
};
export type Followup = {
  id: string;
  postId: string;
  parentId: string | null;
  author: { id: string; displayName: string } | null;
  anonymous: boolean;
  bodyMarkdown: string | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  upvoteCount: number;
  viewerUpvoted: boolean;
  replyCount: number;
  attachments: Attachment[];
  /** Discussions (root followups) only; always false for replies. */
  resolved: boolean;
  /** Whether the viewer may resolve or reopen this discussion. */
  canResolve: boolean;
};
export type CreateFollowup = { bodyMarkdown: string; anonymous?: boolean };
export type FollowupPage = {
  data: Followup[];
  meta: { total: number; nextCursor: string | null };
};
const notFound = () => new AuthError(404, "not_found", "Followup is not found");
const rank: Record<Role, number> = { student: 0, ta: 1, instructor: 2 };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cursorTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const fullTimestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const visibleFollowups = `WITH RECURSIVE visible AS (
  SELECT id,parent_followup_id FROM followups WHERE post_id=$1 AND deleted_at IS NULL
  UNION
  SELECT parent.id,parent.parent_followup_id FROM followups parent
  JOIN visible child ON child.parent_followup_id=parent.id
)`;
export const followupEtag = (item: { version: number }) => `"v${item.version}"`;

export class FollowupService {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  private async question(
    db: Db,
    postId: string,
    userId: string,
    lock = false,
    noteStatus: 409 | 422 = 422,
  ) {
    if (!uuid.test(postId)) throw notFound();
    const result = await db.query<{
      id: string;
      course_id: string;
      type: string;
      deleted_at: Date | null;
      duplicate_status: string;
      private: boolean;
      author_user_id: string | null;
      status: string;
      role: Role;
    }>(
      `SELECT p.id,p.course_id,p.type,p.deleted_at,p.duplicate_status,p.private,p.author_user_id,c.status,m.role
       FROM posts p JOIN courses c ON c.id=p.course_id
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=$2
       WHERE p.id=$1${lock ? " FOR NO KEY UPDATE OF p FOR SHARE OF c,m" : ""}`,
      [postId, userId],
    );
    const row = result.rows[0];
    if (!row || row.deleted_at || row.duplicate_status === "confirmed")
      throw notFound();
    await assertPostVisible(db, row.id, userId);
    if (row.type !== "question")
      throw new AuthError(
        noteStatus,
        "not_a_question",
        "Post is not a question",
      );
    return row;
  }

  private active(status: string) {
    if (status !== "active")
      throw new AuthError(409, "course_archived", "Course is not active");
  }

  private async row(db: Db, id: string, lock = false): Promise<Row> {
    if (!uuid.test(id)) throw notFound();
    const result = await db.query<Row>(
      `SELECT *,${fullTimestamp("created_at")} AS created_order FROM followups WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }

  private async ensureVisible(db: Db, row: Row) {
    if (!row.deleted_at) return;
    const visible = await db.query(
      `${visibleFollowups} SELECT 1 FROM visible WHERE id=$2`,
      [row.post_id, row.id],
    );
    if (!visible.rowCount) throw notFound();
  }

  private async project(
    db: Db,
    row: Row,
    userId: string,
    role: Role,
    status: string,
    replyCount?: number,
  ): Promise<Followup> {
    const person = await db.query<{ id: string; displayName: string }>(
      'SELECT id,display_name AS "displayName" FROM users WHERE id=$1 AND deleted_at IS NULL',
      [row.author_user_id],
    );
    const author =
      row.anonymous && userId !== row.author_user_id && rank[role] === 0
        ? null
        : (person.rows[0] ?? null);
    const votes = await db.query<{ count: string; mine: boolean }>(
      "SELECT count(*)::text AS count,coalesce(bool_or(user_id=$2),false) AS mine FROM followup_upvotes WHERE followup_id=$1",
      [row.id, userId],
    );
    if (replyCount === undefined) {
      const replies = await db.query<{ count: string }>(
        `${visibleFollowups} SELECT count(*)::text AS count FROM visible WHERE parent_followup_id=$2`,
        [row.post_id, row.id],
      );
      replyCount = Number(replies.rows[0].count);
    }
    // Staff and the question's author may resolve an active discussion.
    let canResolve = false;
    if (!row.parent_followup_id && !row.deleted_at && status === "active") {
      if (rank[role] > 0) canResolve = true;
      else {
        const asker = await db.query<{ author_user_id: string | null }>(
          "SELECT author_user_id FROM posts WHERE id=$1",
          [row.post_id],
        );
        canResolve = asker.rows[0]?.author_user_id === userId;
      }
    }
    return {
      id: row.id,
      postId: row.post_id,
      parentId: row.parent_followup_id,
      author,
      anonymous: row.anonymous,
      bodyMarkdown: row.body_markdown,
      deleted: !!row.deleted_at,
      createdAt: row.created_order,
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
      canEdit:
        !row.deleted_at &&
        status === "active" &&
        (userId === row.author_user_id || rank[role] > 0),
      upvoteCount: Number(votes.rows[0].count),
      viewerUpvoted: votes.rows[0].mine,
      replyCount,
      attachments: row.deleted_at
        ? []
        : await listAttachments(db, "followup", row.id),
      resolved: !row.parent_followup_id && row.resolved_at !== null,
      canResolve,
    };
  }

  /** Marks a discussion resolved or unresolved without touching its revision. */
  async setResolved(
    id: string,
    userId: string,
    resolved: boolean,
  ): Promise<Followup> {
    return this.tx(async (db) => {
      // Lock the question before the followup, as every followup write does.
      const initial = await this.row(db, id);
      const question = await this.question(db, initial.post_id, userId, true);
      const row = await this.row(db, id, true);
      if (row.deleted_at) throw notFound();
      this.active(question.status);
      if (row.parent_followup_id)
        throw new AuthError(
          422,
          "not_a_discussion",
          "Only a followup discussion can be resolved, not a reply",
        );
      if (rank[question.role] === 0 && question.author_user_id !== userId)
        throw new AuthError(
          403,
          "permission_denied",
          "Only staff and the question's author can resolve discussions",
        );
      await db.query(
        `UPDATE followups SET
           resolved_at = CASE WHEN $2 THEN coalesce(resolved_at, now()) END,
           resolved_by_user_id = CASE WHEN $2 THEN coalesce(resolved_by_user_id, $3) END
         WHERE id=$1`,
        [id, resolved, userId],
      );
      return this.project(
        db,
        await this.row(db, id),
        userId,
        question.role,
        question.status,
      );
    });
  }

  async create(
    postId: string,
    userId: string,
    input: CreateFollowup,
    parentId?: string,
    key?: string,
  ): Promise<Followup> {
    if (key !== undefined && (key.length < 1 || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    return this.tx(async (db) => {
      const question = await this.question(db, postId, userId, true, 409);
      const scope = `followup-create:${userId}:${postId}:${parentId ?? "root"}`;
      const hash = createHash("sha256").update(JSON.stringify(input)).digest();
      if (key) {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const old = await db.query<{
          request_hash: Buffer;
          response_body: Followup;
        }>(
          "SELECT request_hash,response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
          [scope, key],
        );
        if (old.rows[0]) {
          if (!old.rows[0].request_hash.equals(hash))
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key was reused",
            );
          const saved = await this.row(db, old.rows[0].response_body.id);
          await this.ensureVisible(db, saved);
          const current = await this.project(
            db,
            saved,
            userId,
            question.role,
            question.status,
          );
          return {
            ...old.rows[0].response_body,
            author: current.author,
            canEdit: current.canEdit,
          };
        }
        await db.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      this.active(question.status);
      if (parentId) {
        const parent = await this.row(db, parentId, true);
        if (parent.post_id !== postId || parent.deleted_at) throw notFound();
      }
      const id = uuidv7();
      await db.query(
        "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR SHARE",
      );
      await db.query(
        "INSERT INTO followups (id,course_id,post_id,parent_followup_id,author_user_id,body_markdown,anonymous,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),clock_timestamp())",
        [
          id,
          question.course_id,
          postId,
          parentId ?? null,
          userId,
          input.bodyMarkdown,
          input.anonymous ?? false,
        ],
      );
      if (parentId)
        // A new reply anywhere in a discussion reopens it.
        await db.query(
          `WITH RECURSIVE chain AS (
             SELECT id,parent_followup_id FROM followups WHERE id=$1
             UNION ALL
             SELECT f.id,f.parent_followup_id FROM followups f JOIN chain c ON f.id=c.parent_followup_id
           )
           UPDATE followups SET resolved_at=NULL,resolved_by_user_id=NULL
           WHERE id=(SELECT id FROM chain WHERE parent_followup_id IS NULL) AND resolved_at IS NOT NULL`,
          [parentId],
        );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [postId],
      );
      await recordActivity(db, {
        courseId: question.course_id,
        postId,
        actorId: userId,
        kind: parentId ? "reply_created" : "followup_created",
        anonymous: input.anonymous ?? false,
        mentions: parseMentions(input.bodyMarkdown),
        follow: true,
      });
      const value = await this.project(
        db,
        await this.row(db, id),
        userId,
        question.role,
        question.status,
      );
      if (key)
        await db.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, value],
        );
      return value;
    });
  }

  async list(
    postId: string,
    userId: string,
    parentId?: string,
    cursor?: string,
    limit = 20,
  ): Promise<FollowupPage> {
    const question = await this.question(this.pool, postId, userId);
    if (parentId) {
      const parent = await this.row(this.pool, parentId);
      if (parent.post_id !== postId) throw notFound();
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AuthError(400, "invalid_request", "Limit is invalid");
    let position: [string, string] | null = null;
    if (cursor) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        throw new AuthError(400, "invalid_cursor", "Cursor is invalid");
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        typeof parsed[0] !== "string" ||
        !cursorTime.test(parsed[0]) ||
        parsed[0].startsWith("0000-") ||
        Number.isNaN(Date.parse(parsed[0])) ||
        new Date(parsed[0]).toISOString().slice(0, 19) !==
          parsed[0].slice(0, 19) ||
        typeof parsed[1] !== "string" ||
        !uuid.test(parsed[1])
      )
        throw new AuthError(400, "invalid_cursor", "Cursor is invalid");
      position = [parsed[0], parsed[1]];
    }
    const count = await this.pool.query<{ count: string }>(
      `${visibleFollowups} SELECT count(*)::text AS count FROM visible WHERE parent_followup_id IS NOT DISTINCT FROM $2`,
      [postId, parentId ?? null],
    );
    const result = await this.pool.query<Row>(
      `${visibleFollowups}
       SELECT f.*,${fullTimestamp("f.created_at")} AS created_order
       FROM followups f JOIN visible v ON v.id=f.id
       WHERE v.parent_followup_id IS NOT DISTINCT FROM $2
         AND ($3::timestamptz IS NULL OR (f.created_at,f.id)>($3::timestamptz,$4::uuid))
       ORDER BY f.created_at,f.id LIMIT $5`,
      [
        postId,
        parentId ?? null,
        position?.[0] ?? null,
        position?.[1] ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    const total = Number(count.rows[0].count);
    const replyCounts = rows.length
      ? await this.pool.query<{ id: string; count: string }>(
          `${visibleFollowups} SELECT parent_followup_id AS id,count(*)::text AS count FROM visible WHERE parent_followup_id = ANY($2::uuid[]) GROUP BY parent_followup_id`,
          [postId, rows.map((row) => row.id)],
        )
      : null;
    const counts = new Map(
      replyCounts?.rows.map((row) => [row.id, Number(row.count)]) ?? [],
    );
    return {
      data: await Promise.all(
        rows.map((row) =>
          this.project(
            this.pool,
            row,
            userId,
            question.role,
            question.status,
            counts.get(row.id) ?? 0,
          ),
        ),
      ),
      meta: {
        total,
        nextCursor:
          result.rows.length > limit
            ? Buffer.from(
                JSON.stringify([
                  rows[rows.length - 1].created_order,
                  rows[rows.length - 1].id,
                ]),
              ).toString("base64url")
            : null,
      },
    };
  }

  async get(id: string, userId: string): Promise<Followup> {
    const row = await this.row(this.pool, id);
    const question = await this.question(this.pool, row.post_id, userId);
    await this.ensureVisible(this.pool, row);
    return this.project(this.pool, row, userId, question.role, question.status);
  }

  private revision(row: Row, etag?: string) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== followupEtag({ version: Number(row.version) }))
      throw new AuthError(
        412,
        "version_conflict",
        "Followup version has changed",
      );
  }

  async edit(
    id: string,
    userId: string,
    etag: string | undefined,
    bodyMarkdown: string,
  ): Promise<Followup> {
    return this.tx(async (db) => {
      const postId = (await this.row(db, id)).post_id;
      const question = await this.question(db, postId, userId, true);
      const row = await this.row(db, id, true);
      this.active(question.status);
      if (row.deleted_at) throw notFound();
      if (userId !== row.author_user_id && rank[question.role] === 0)
        throw new AuthError(
          403,
          "permission_denied",
          "Author or staff role is required",
        );
      this.revision(row, etag);
      const mentions = newMentions(row.body_markdown, bodyMarkdown);
      await db.query(
        "UPDATE followups SET body_markdown=$2,updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
        [id, bodyMarkdown],
      );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [row.post_id],
      );
      // Edits notify only people they newly mention.
      if (mentions.userIds.length || mentions.staff)
        await recordActivity(db, {
          courseId: question.course_id,
          postId: row.post_id,
          actorId: userId,
          anonymous: row.anonymous,
          mentions,
          follow: false,
        });
      return this.project(
        db,
        await this.row(db, id),
        userId,
        question.role,
        question.status,
      );
    });
  }

  async delete(
    id: string,
    userId: string,
    etag: string | undefined,
  ): Promise<void> {
    await this.tx(async (db) => {
      const postId = (await this.row(db, id)).post_id;
      const question = await this.question(db, postId, userId, true);
      const row = await this.row(db, id, true);
      this.active(question.status);
      if (row.deleted_at) throw notFound();
      if (userId !== row.author_user_id && rank[question.role] === 0)
        throw new AuthError(
          403,
          "permission_denied",
          "Author or staff role is required",
        );
      this.revision(row, etag);
      await db.query(
        "UPDATE followups SET body_markdown=NULL,deleted_at=statement_timestamp(),updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
        [id],
      );
      await hideAttachmentsForParent(db, "followup", id);
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [row.post_id],
      );
    });
  }

  async upvote(
    id: string,
    userId: string,
    enabled: boolean,
  ): Promise<Followup> {
    return this.tx(async (db) => {
      const postId = (await this.row(db, id)).post_id;
      const question = await this.question(db, postId, userId, true);
      const row = await this.row(db, id, true);
      this.active(question.status);
      if (row.deleted_at) throw notFound();
      if (enabled)
        await db.query(
          "INSERT INTO followup_upvotes (followup_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [id, userId],
        );
      else
        await db.query(
          "DELETE FROM followup_upvotes WHERE followup_id=$1 AND user_id=$2",
          [id, userId],
        );
      return this.project(db, row, userId, question.role, question.status);
    });
  }
}
