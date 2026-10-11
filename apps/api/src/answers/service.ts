import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Kind = "student" | "staff";
type AnswerRow = {
  id: string;
  course_id: string;
  post_id: string;
  kind: Kind;
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
  kind: Kind;
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
};
export type CreateAnswer = { bodyMarkdown: string; anonymous?: boolean };

export const answerEtag = (answer: { version: number }) =>
  `"v${answer.version}"`;
const notFound = () => new AuthError(404, "not_found", "Answer is not found");
const validation = (message: string) =>
  new AuthError(422, "validation_failed", message);
const STAFF = new Set<Role>(["ta", "instructor"]);
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
  private async project(db: Db, row: AnswerRow, role: Role): Promise<Answer> {
    const contributors = await this.contributors(
      db,
      row.id,
      row.anonymous,
      role,
    );
    return {
      id: row.id,
      postId: row.post_id,
      kind: row.kind,
      deleted: false,
      bodyMarkdown: row.body_markdown!,
      contributors,
      anonymous: row.anonymous,
      attachments: [],
      endorsedAt: row.endorsed_at?.toISOString() ?? null,
      endorsedBy: row.endorsed_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
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
    try {
      return await this.tx(async (db) => {
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
            return {
              value: {
                ...old.rows[0].response_body,
                contributors: await this.contributors(
                  db,
                  old.rows[0].response_body.id,
                  old.rows[0].response_body.anonymous,
                  member.role,
                ),
              },
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
        const existing = await db.query(
          "SELECT 1 FROM answers WHERE post_id=$1 AND kind=$2 AND deleted_at IS NULL",
          [postId, kind],
        );
        if (existing.rowCount) throw kindExists();
        const id = uuidv7();
        await db.query(
          "INSERT INTO answers (id,course_id,post_id,kind,body_markdown,anonymous) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            id,
            post.course_id,
            postId,
            kind,
            body.bodyMarkdown,
            body.anonymous ?? false,
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
        await db.query("UPDATE posts SET last_activity_at=now() WHERE id=$1", [
          postId,
        ]);
        const value = await this.project(
          db,
          (await this.row(db, id))!,
          member.role,
        );
        if (key !== undefined)
          await db.query(
            "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
            [scope, key, hash, value],
          );
        return { value, status: 201 };
      });
    } catch (error) {
      // The question row lock serializes creators; the partial unique index is the backstop.
      if ((error as { code?: string }).code === "23505") throw kindExists();
      throw error;
    }
  }
  async list(postId: string, userId: string): Promise<Answer[]> {
    const { post, member } = await this.post(this.pool, postId, userId);
    if (post.type !== "question")
      throw new AuthError(422, "not_a_question", "Post is not a question");
    const result = await this.pool.query<AnswerRow>(
      "SELECT * FROM answers WHERE post_id=$1 AND deleted_at IS NULL ORDER BY CASE kind WHEN 'student' THEN 0 ELSE 1 END",
      [postId],
    );
    return Promise.all(
      result.rows.map((row) => this.project(this.pool, row, member.role)),
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
    await db.query("UPDATE posts SET last_activity_at=now() WHERE id=$1", [
      row.post_id,
    ]);
  }
  async endorse(
    answerId: string,
    userId: string,
    etag: string | undefined,
  ): Promise<Answer> {
    return this.tx(async (db) => {
      const { row, member } = await this.staffWrite(db, answerId, userId);
      this.checkRevision(row, etag);
      if (row.endorsed_at) return this.project(db, row, member.role);
      await db.query(
        "UPDATE answers SET endorsed_at=now(),endorsed_by_user_id=$2,updated_at=now(),version=version+1 WHERE id=$1",
        [answerId, userId],
      );
      await this.closeDocument(db, row);
      return this.project(db, (await this.row(db, answerId))!, member.role);
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
        "UPDATE answers SET body_markdown=NULL,deleted_at=now(),updated_at=now(),version=version+1 WHERE id=$1",
        [answerId],
      );
      await this.closeDocument(db, row);
    });
  }
  async get(answerId: string, userId: string): Promise<Answer> {
    const row = await this.row(this.pool, answerId);
    if (!row || row.deleted_at) throw notFound();
    const { member } = await this.post(this.pool, row.post_id, userId);
    return this.project(this.pool, row, member.role);
  }
}

function kindExists() {
  return new AuthError(
    409,
    "answer_kind_exists",
    "The question already has this answer kind",
  );
}
