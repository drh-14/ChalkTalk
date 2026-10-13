import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import * as Y from "yjs";
import { AuthError } from "../auth/errors.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Kind = "student" | "staff";
type AnswerRow = {
  id: string;
  course_id: string;
  post_id: string;
  kind: Kind;
  created_by_user_id: string;
  edit_role_floor: Role;
  body_markdown: string | null;
  anonymous: boolean;
  endorsed_at: Date | null;
  endorsed_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: string;
};
type PostRow = {
  id: string;
  course_id: string;
  type: "question" | "note";
  deleted_at: Date | null;
  duplicate_status: string;
};
export type Contributor = { id: string; displayName: string };
export type Answer = {
  id: string;
  postId: string;
  deleted: false;
  bodyMarkdown: string;
  contributors: Contributor[] | null;
  anonymous: boolean;
  attachments: [];
  endorsedAt: string | null;
  endorsedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  upvoteCount: number;
  viewerUpvoted: boolean;
};
export type CreateAnswer = { bodyMarkdown: string; anonymous?: boolean };

export const answerEtag = (answer: { version: number }) =>
  `"v${answer.version}"`;
const notFound = () => new AuthError(404, "not_found", "Answer is not found");
const validation = (message: string) =>
  new AuthError(422, "validation_failed", message);
const STAFF = new Set<Role>(["ta", "instructor"]);
const ROLE_RANK: Record<Role, number> = { student: 0, ta: 1, instructor: 2 };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Yjs encodes an empty document as zero structs followed by an empty delete set.
// The private Yjs document store seeds this marker from body_markdown on first load.
const EMPTY_YJS_UPDATE = Buffer.from([0, 0]);

export class AnswerService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async membership(
    db: Db,
    courseId: string,
    userId: string,
    lock = false,
  ) {
    const result = await db.query<{ role: Role; status: string }>(
      `SELECT m.role,c.status FROM course_memberships m JOIN courses c ON c.id=m.course_id WHERE m.course_id=$1 AND m.user_id=$2${lock ? " FOR SHARE OF m,c" : ""}`,
      [courseId, userId],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private writable(status: string) {
    if (status !== "active")
      throw new AuthError(409, "course_archived", "Course is not active");
  }
  /** Resolves a visible question: absent, deleted, and merged posts are all not found. */
  private async post(db: Db, postId: string, userId: string, lock = false) {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    const result = await db.query<PostRow>(
      `SELECT id,course_id,type,deleted_at,duplicate_status FROM posts WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [postId],
    );
    const post = result.rows[0];
    if (!post) throw notFound();
    const member = await this.membership(db, post.course_id, userId, lock);
    if (post.deleted_at || post.duplicate_status === "confirmed")
      throw notFound();
    return { post, member };
  }
  private async row(db: Db, answerId: string, lock = false) {
    if (!UUID_PATTERN.test(answerId)) return undefined;
    const result = await db.query<AnswerRow>(
      `SELECT * FROM answers WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [answerId],
    );
    return result.rows[0];
  }
  private async project(
    db: Db,
    row: AnswerRow,
    role: Role,
    userId: string,
  ): Promise<Answer> {
    const contributors = await this.contributors(
      db,
      row.id,
      row.anonymous,
      role,
    );
    const votes = await db.query<{ count: string; mine: boolean }>(
      "SELECT count(*)::text AS count,coalesce(bool_or(user_id=$2),false) AS mine FROM answer_upvotes WHERE answer_id=$1",
      [row.id, userId],
    );
    const course = await db.query<{ status: string }>(
      "SELECT status FROM courses WHERE id=$1",
      [row.course_id],
    );
    return {
      id: row.id,
      postId: row.post_id,
      deleted: false,
      bodyMarkdown: row.body_markdown!,
      contributors,
      anonymous: row.anonymous,
      attachments: [],
      endorsedAt: row.endorsed_at?.toISOString() ?? null,
      endorsedBy:
        row.anonymous && !STAFF.has(role) ? null : row.endorsed_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
      canEdit:
        course.rows[0]?.status === "active" &&
        !row.endorsed_at &&
        ROLE_RANK[role] >= ROLE_RANK[row.edit_role_floor],
      upvoteCount: Number(votes.rows[0].count),
      viewerUpvoted: votes.rows[0].mine,
    };
  }
  private async contributors(
    db: Db,
    answerId: string,
    anonymous: boolean,
    role: Role,
  ) {
    let contributors: Contributor[] | null = null;
    if (!anonymous || STAFF.has(role)) {
      const result = await db.query<Contributor>(
        'SELECT u.id,u.display_name AS "displayName" FROM answer_contributors c JOIN users u ON u.id=c.user_id WHERE c.answer_id=$1 AND u.deleted_at IS NULL ORDER BY u.display_name,u.id',
        [answerId],
      );
      contributors = result.rows;
    }
    return contributors;
  }
  async create(
    postId: string,
    userId: string,
    body: CreateAnswer,
    key?: string,
  ): Promise<{ value: Answer; status: number }> {
    if (key !== undefined && (key.length < 1 || key.length > 255))
      throw validation("Idempotency-Key is invalid");
    const scope = `answer-create:${userId}:${postId}`;
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    return this.tx(async (db) => {
      const { post, member } = await this.post(db, postId, userId, true);
      if (key !== undefined) {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const old = await db.query<{
          request_hash: Buffer;
          response_body: Answer;
          response_status: number;
        }>(
          "SELECT request_hash,response_body,response_status FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
          [scope, key],
        );
        if (old.rows[0]) {
          if (!old.rows[0].request_hash.equals(hash))
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key was reused",
            );
          const oldRow = await this.row(db, old.rows[0].response_body.id);
          if (!oldRow || oldRow.deleted_at) throw notFound();
          return {
            value: await this.project(db, oldRow, member.role, userId),
            status: old.rows[0].response_status,
          };
        }
        await db.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      this.writable(member.status);
      if (post.type !== "question")
        throw new AuthError(409, "not_a_question", "Post is not a question");
      const kind: Kind = STAFF.has(member.role) ? "staff" : "student";
      const id = uuidv7();
      await db.query(
        "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,anonymous,created_by_user_id,edit_role_floor,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,statement_timestamp(),statement_timestamp())",
        [
          id,
          post.course_id,
          postId,
          kind,
          body.bodyMarkdown,
          body.anonymous ?? false,
          userId,
          member.role,
        ],
      );
      await db.query(
        "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
        [id, EMPTY_YJS_UPDATE],
      );
      await db.query(
        "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
        [id, userId],
      );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [postId],
      );
      const value = await this.project(
        db,
        (await this.row(db, id))!,
        member.role,
        userId,
      );
      if (key !== undefined)
        await db.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, value],
        );
      return { value, status: 201 };
    });
  }
  async list(postId: string, userId: string): Promise<Answer[]> {
    const { post, member } = await this.post(this.pool, postId, userId);
    if (post.type !== "question")
      throw new AuthError(422, "not_a_question", "Post is not a question");
    const result = await this.pool.query<AnswerRow>(
      "SELECT * FROM answers WHERE post_id=$1 AND deleted_at IS NULL ORDER BY created_at,id",
      [postId],
    );
    return Promise.all(
      result.rows.map((row) =>
        this.project(this.pool, row, member.role, userId),
      ),
    );
  }
  private checkRevision(row: AnswerRow, etag: string | undefined) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== answerEtag({ version: Number(row.version) }))
      throw new AuthError(
        412,
        "version_conflict",
        "Answer version has changed",
      );
  }
  /** Locks the answer, then its question, in that order for every staff write. */
  private async staffWrite(db: PoolClient, answerId: string, userId: string) {
    const row = await this.row(db, answerId, true);
    if (!row || row.deleted_at) throw notFound();
    const { member } = await this.post(db, row.post_id, userId, true);
    this.writable(member.status);
    if (!STAFF.has(member.role))
      throw new AuthError(403, "permission_denied", "A staff role is required");
    return { row, member };
  }
  private async closeDocument(db: PoolClient, row: AnswerRow) {
    await db.query(
      "UPDATE answer_collaboration_documents SET lifecycle_state='closed' WHERE answer_id=$1",
      [row.id],
    );
    await db.query(
      "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
      [row.post_id],
    );
  }
  async endorse(
    answerId: string,
    userId: string,
    etag: string | undefined,
  ): Promise<Answer> {
    return this.tx(async (db) => {
      const { row, member } = await this.staffWrite(db, answerId, userId);
      this.checkRevision(row, etag);
      if (row.endorsed_at) return this.project(db, row, member.role, userId);
      await db.query(
        "UPDATE answers SET endorsed_at=statement_timestamp(),endorsed_by_user_id=$2,updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
        [answerId, userId],
      );
      await this.closeDocument(db, row);
      return this.project(
        db,
        (await this.row(db, answerId))!,
        member.role,
        userId,
      );
    });
  }
  async delete(
    answerId: string,
    userId: string,
    etag: string | undefined,
  ): Promise<void> {
    await this.tx(async (db) => {
      const { row } = await this.staffWrite(db, answerId, userId);
      this.checkRevision(row, etag);
      if (row.endorsed_at)
        throw new AuthError(
          409,
          "answer_endorsed",
          "Endorsed answers are immutable",
        );
      await db.query(
        "UPDATE answers SET body_markdown=NULL,deleted_at=statement_timestamp(),updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
        [answerId],
      );
      await this.closeDocument(db, row);
    });
  }
  async get(answerId: string, userId: string): Promise<Answer> {
    const row = await this.row(this.pool, answerId);
    if (!row || row.deleted_at) throw notFound();
    const { member } = await this.post(this.pool, row.post_id, userId);
    return this.project(this.pool, row, member.role, userId);
  }

  async edit(
    answerId: string,
    userId: string,
    etag: string | undefined,
    bodyMarkdown: string,
  ): Promise<Answer> {
    return this.tx(async (db) => {
      const row = await this.row(db, answerId, true);
      if (!row || row.deleted_at) throw notFound();
      const { member } = await this.post(db, row.post_id, userId, true);
      this.writable(member.status);
      if (ROLE_RANK[member.role] < ROLE_RANK[row.edit_role_floor])
        throw new AuthError(
          403,
          "permission_denied",
          "Role cannot edit this answer",
        );
      this.checkRevision(row, etag);
      if (row.endorsed_at)
        throw new AuthError(
          409,
          "answer_endorsed",
          "Endorsed answers are immutable",
        );
      const stored = await db.query<{
        yjs_state: Buffer;
        lifecycle_state: string;
      }>(
        "SELECT yjs_state,lifecycle_state FROM answer_collaboration_documents WHERE answer_id=$1 FOR UPDATE",
        [answerId],
      );
      const document = stored.rows[0];
      if (!document || document.lifecycle_state !== "active")
        throw new AuthError(409, "answer_closed", "Answer document is closed");
      const ydoc = new Y.Doc();
      try {
        Y.applyUpdate(ydoc, document.yjs_state);
      } catch {
        throw new AuthError(
          500,
          "integrity_error",
          "Answer document is invalid",
        );
      }
      const text = ydoc.getText("content");
      if (document.yjs_state.equals(EMPTY_YJS_UPDATE))
        text.insert(0, row.body_markdown!);
      else if (text.toString() !== row.body_markdown)
        throw new AuthError(
          500,
          "integrity_error",
          "Answer document disagrees with text",
        );
      text.delete(0, text.length);
      text.insert(0, bodyMarkdown);
      await db.query(
        "UPDATE answer_collaboration_documents SET yjs_state=$2,persistence_revision=persistence_revision+1,persisted_at=statement_timestamp() WHERE answer_id=$1",
        [answerId, Buffer.from(Y.encodeStateAsUpdate(ydoc))],
      );
      await db.query(
        "UPDATE answers SET body_markdown=$2,version=version+1,updated_at=statement_timestamp() WHERE id=$1",
        [answerId, bodyMarkdown],
      );
      await db.query(
        "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [answerId, userId],
      );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [row.post_id],
      );
      return this.project(
        db,
        (await this.row(db, answerId))!,
        member.role,
        userId,
      );
    });
  }

  async upvote(
    answerId: string,
    userId: string,
    enabled: boolean,
  ): Promise<Answer> {
    return this.tx(async (db) => {
      const row = await this.row(db, answerId, true);
      if (!row || row.deleted_at) throw notFound();
      const { member } = await this.post(db, row.post_id, userId);
      this.writable(member.status);
      if (enabled)
        await db.query(
          "INSERT INTO answer_upvotes (answer_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [answerId, userId],
        );
      else
        await db.query(
          "DELETE FROM answer_upvotes WHERE answer_id=$1 AND user_id=$2",
          [answerId, userId],
        );
      return this.project(db, row, member.role, userId);
    });
  }
}
