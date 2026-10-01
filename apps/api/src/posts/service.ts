import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Row = {
  id: string;
  course_id: string;
  author_user_id: string | null;
  type: "question" | "note";
  title: string | null;
  body_markdown: string | null;
  anonymous: boolean;
  pinned: boolean;
  duplicate_of_post_id: string | null;
  duplicate_status: "none" | "suggested" | "confirmed";
  last_activity_at: Date;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: string | number;
  display_name: string | null;
  author_deleted_at: Date | null;
  answered: boolean;
  canonical_title?: string | null;
};
export type CreatePost = {
  type: "question" | "note";
  title: string;
  bodyMarkdown: string;
  anonymous?: boolean;
  tags?: string[];
};
export type UpdatePost = Partial<Omit<CreatePost, "type">> & {
  pinned?: boolean;
  duplicateOfPostId?: string | null;
  duplicateStatus?: "none" | "suggested" | "confirmed";
};
export type Post = Record<string, unknown> & {
  id: string;
  courseId: string;
  type: "question" | "note";
  deleted: boolean;
  version: number;
};
export type MergedReference = {
  id: string;
  courseId: string;
  duplicateOfPostId: string;
  duplicateStatus: "confirmed";
  version: number;
};
export type ListPosts = {
  q?: string;
  type?: "question" | "note";
  tags?: string[];
  tagMatch?: "all";
  authorId?: string;
  createdAfter?: string;
  createdBefore?: string;
  answered?: boolean;
  pinned?: boolean;
  authorRole?: "instructor" | "ta";
  duplicateStatus?: "none" | "suggested" | "confirmed";
  sort: "relevance" | "newest" | "oldest" | "recent_activity";
  limit: number;
  cursor?: string;
};
export const postEtag = (post: { version: number }) => `"v${post.version}"`;
const notFound = () => new AuthError(404, "not_found", "Post is not found");
const validation = (message: string) =>
  new AuthError(422, "validation_failed", message);
const STAFF = new Set<Role>(["ta", "instructor"]);
const ANSWERED =
  "EXISTS (SELECT 1 FROM answers a WHERE a.post_id=p.id AND a.deleted_at IS NULL)";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PostService {
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
  private async row(
    db: Db,
    id: string,
    lock = false,
  ): Promise<Row | undefined> {
    const result = await db.query<Row>(
      `SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,${ANSWERED} AS answered FROM posts p LEFT JOIN users u ON u.id=p.author_user_id WHERE p.id=$1${lock ? " FOR UPDATE OF p" : ""}`,
      [id],
    );
    return result.rows[0];
  }
  private async tags(db: Db, postId: string): Promise<string[]> {
    const result = await db.query<{ name: string }>(
      "SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=$1 ORDER BY t.name",
      [postId],
    );
    return result.rows.map((item) => item.name);
  }
  private async project(
    db: Db,
    row: Row,
    viewerId: string,
    role: Role,
  ): Promise<Post> {
    const common = {
      id: row.id,
      courseId: row.course_id,
      type: row.type,
      deleted: Boolean(row.deleted_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
    };
    if (row.deleted_at) return common;
    const authorDeleted = Boolean(row.author_deleted_at || !row.author_user_id);
    const reveal =
      !row.anonymous || viewerId === row.author_user_id || STAFF.has(role);
    return {
      ...common,
      title: row.title,
      bodyMarkdown: row.body_markdown,
      author: {
        userId: authorDeleted || !reveal ? null : row.author_user_id,
        displayName: authorDeleted
          ? "Deleted user"
          : reveal
            ? row.display_name
            : "Anonymous",
        anonymous: row.anonymous,
        deleted: authorDeleted,
      },
      anonymous: row.anonymous,
      tags: await this.tags(db, row.id),
      attachments: [],
      pinned: row.pinned,
      duplicateOfPostId: row.duplicate_of_post_id,
      duplicateStatus: row.duplicate_status,
      lastActivityAt: row.last_activity_at.toISOString(),
      ...(row.type === "question" ? { answered: row.answered } : {}),
    };
  }
  private async replaceTags(
    db: Db,
    postId: string,
    courseId: string,
    names: string[],
  ) {
    await db.query("DELETE FROM post_tags WHERE post_id=$1", [postId]);
    for (const name of names) {
      const tag = await db.query<{ id: string }>(
        "INSERT INTO tags (id,course_id,name) VALUES ($1,$2,$3) ON CONFLICT (course_id,name) DO UPDATE SET name=excluded.name RETURNING id",
        [uuidv7(), courseId, name],
      );
      await db.query("INSERT INTO post_tags (post_id,tag_id) VALUES ($1,$2)", [
        postId,
        tag.rows[0]!.id,
      ]);
    }
  }
  async create(
    courseId: string,
    userId: string,
    body: CreatePost,
    key?: string,
  ): Promise<{ value: Post; status: number }> {
    if (key !== undefined && (key.length < 1 || key.length > 255))
      throw validation("Idempotency-Key is invalid");
    const scope = `post-create:${userId}:${courseId}`;
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    return this.tx(async (db) => {
      const member = await this.membership(db, courseId, userId, true);
      if (key !== undefined) {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const old = await db.query<{
          request_hash: Buffer;
          response_body: Post;
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
            value: old.rows[0].response_body,
            status: old.rows[0].response_status,
          };
        }
        await db.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      this.writable(member.status);
      const id = uuidv7();
      await db.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,anonymous) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          courseId,
          userId,
          body.type,
          body.title,
          body.bodyMarkdown,
          body.anonymous ?? false,
        ],
      );
      await this.replaceTags(db, id, courseId, body.tags ?? []);
      const row = await this.row(db, id);
      const value = await this.project(db, row!, userId, member.role);
      if (key !== undefined)
        await db.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, value],
        );
      return { value, status: 201 };
    });
  }
  async get(id: string, userId: string): Promise<Post | MergedReference> {
    const row = await this.row(this.pool, id);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    if (row.duplicate_status === "confirmed") return this.mergedReference(row);
    return this.project(this.pool, row, userId, member.role);
  }
  async getDuplicateReview(id: string, userId: string): Promise<Post> {
    const row = await this.row(this.pool, id);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    if (row.deleted_at || row.duplicate_status !== "confirmed")
      throw notFound();
    if (!STAFF.has(member.role))
      throw new AuthError(
        403,
        "permission_denied",
        "Duplicate review is staff-only",
      );
    return this.project(this.pool, row, userId, member.role);
  }
  private mergedReference(row: Row): MergedReference {
    return {
      id: row.id,
      courseId: row.course_id,
      duplicateOfPostId: row.duplicate_of_post_id!,
      duplicateStatus: "confirmed",
      version: Number(row.version),
    };
  }
  async list(courseId: string, userId: string, options: ListPosts) {
    const member = await this.membership(this.pool, courseId, userId);
    if (options.duplicateStatus === "confirmed" && !STAFF.has(member.role))
      throw new AuthError(
        403,
        "permission_denied",
        "Duplicate review is staff-only",
      );
    const { cursor, limit, ...filters } = options;
    const binding = createHash("sha256")
      .update(JSON.stringify({ courseId, userId, filters }))
      .digest("hex");
    let after:
      { pinned: boolean; value: number | string; id: string } | undefined;
    if (cursor) {
      try {
        const parsed = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        );
        if (
          parsed.binding !== binding ||
          typeof parsed.pinned !== "boolean" ||
          typeof parsed.id !== "string" ||
          !UUID_PATTERN.test(parsed.id) ||
          (options.sort === "relevance"
            ? typeof parsed.value !== "number" ||
              !Number.isFinite(parsed.value) ||
              parsed.value < 0
            : typeof parsed.value !== "string" ||
              !Number.isFinite(Date.parse(parsed.value)) ||
              new Date(parsed.value).toISOString() !== parsed.value)
        )
          throw Error();
        after = parsed;
      } catch {
        throw new AuthError(
          400,
          "invalid_request",
          "Pagination cursor is invalid",
        );
      }
    }
    const values: unknown[] = [courseId];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const clauses = ["p.course_id=$1", "p.deleted_at IS NULL"];
    if (options.duplicateStatus !== "confirmed")
      clauses.push("p.duplicate_status <> 'confirmed'");
    if (options.q)
      clauses.push(
        `p.search_vector @@ websearch_to_tsquery('english', ${add(options.q)})`,
      );
    if (options.type) clauses.push(`p.type=${add(options.type)}`);
    if (options.tags?.length) {
      const tags = add(options.tags);
      // Tag names are unique per course and the list is deduplicated, so a full count means every tag.
      clauses.push(
        options.tagMatch === "all"
          ? `(SELECT count(*) FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND t.name=ANY(${tags}::text[]))=cardinality(${tags}::text[])`
          : `EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND t.name=ANY(${tags}::text[]))`,
      );
    }
    if (options.authorId) {
      clauses.push(`p.author_user_id=${add(options.authorId)}`);
      if (!STAFF.has(member.role)) {
        clauses.push("u.deleted_at IS NULL");
        clauses.push(`(p.anonymous=false OR p.author_user_id=${add(userId)})`);
      }
    }
    if (options.createdAfter)
      clauses.push(`p.created_at>=${add(options.createdAfter)}::timestamptz`);
    if (options.createdBefore)
      clauses.push(`p.created_at<=${add(options.createdBefore)}::timestamptz`);
    if (options.answered !== undefined)
      clauses.push(
        `p.type='question' AND ${options.answered ? "" : "NOT "}${ANSWERED}`,
      );
    if (options.pinned !== undefined)
      clauses.push(`p.pinned=${add(options.pinned)}`);
    if (options.authorRole) {
      clauses.push(
        `EXISTS (SELECT 1 FROM course_memberships am WHERE am.course_id=p.course_id AND am.user_id=p.author_user_id AND am.role=${add(options.authorRole)})`,
      );
      // Like authorId, a student may not learn the role behind someone else's anonymous post.
      if (!STAFF.has(member.role))
        clauses.push(`(p.anonymous=false OR p.author_user_id=${add(userId)})`);
    }
    if (options.duplicateStatus)
      clauses.push(`p.duplicate_status=${add(options.duplicateStatus)}`);
    const sortExpression =
      options.sort === "newest" || options.sort === "oldest"
        ? "date_trunc('milliseconds',p.created_at)"
        : options.sort === "recent_activity"
          ? "date_trunc('milliseconds',p.last_activity_at)"
          : `round(ts_rank_cd(p.search_vector,websearch_to_tsquery('english',${add(options.q)}))::numeric,6)`;
    const sortValue = options.sort === "relevance" ? "numeric" : "timestamptz";
    const ascending = options.sort === "oldest";
    let cursorClause = "";
    if (after) {
      const pinned = add(after.pinned);
      const rank = add(after.value);
      const id = add(after.id);
      cursorClause = `AND (listed.pinned < ${pinned}::boolean OR (listed.pinned = ${pinned}::boolean AND (listed.rank_value,listed.id)${ascending ? ">" : "<"}(${rank}::${sortValue},${id}::uuid)))`;
    }
    const direction = ascending ? "ASC" : "DESC";
    const query = `SELECT listed.* FROM (SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,${ANSWERED} AS answered,canonical.title AS canonical_title,${sortExpression} AS rank_value FROM posts p LEFT JOIN users u ON u.id=p.author_user_id LEFT JOIN posts canonical ON canonical.id=p.duplicate_of_post_id WHERE ${clauses.join(" AND ")}) listed WHERE true ${cursorClause} ORDER BY listed.pinned DESC,listed.rank_value ${direction},listed.id ${direction} LIMIT ${add(limit + 1)}`;
    const result = await this.pool.query<Row & { rank_value: number | Date }>(
      query,
      values,
    );
    const pageRows = result.rows.slice(0, limit);
    const data = await Promise.all(
      pageRows.map((row) =>
        options.duplicateStatus === "confirmed"
          ? Promise.resolve({
              ...this.mergedReference(row),
              title: row.title,
              canonicalTitle: row.canonical_title,
              type: row.type,
            })
          : this.project(this.pool, row, userId, member.role),
      ),
    );
    const tail = pageRows.at(-1);
    const nextCursor =
      result.rows.length > limit && tail
        ? Buffer.from(
            JSON.stringify({
              binding,
              pinned: tail.pinned,
              value:
                tail.rank_value instanceof Date
                  ? tail.rank_value.toISOString()
                  : Number(tail.rank_value),
              id: tail.id,
            }),
          ).toString("base64url")
        : null;
    return { data, page: { nextCursor, hasMore: result.rows.length > limit } };
  }
  private checkRevision(row: Row, etag: string | undefined) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== postEtag({ version: Number(row.version) }))
      throw new AuthError(412, "version_conflict", "Post version has changed");
  }
  async update(
    id: string,
    userId: string,
    etag: string | undefined,
    body: UpdatePost,
  ): Promise<Post | MergedReference> {
    return this.tx(async (db) => {
      const initial = await this.row(db, id);
      if (!initial) throw notFound();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        initial.course_id,
      ]);
      const row = await this.row(db, id, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      if (row.deleted_at) throw notFound();
      this.writable(member.status);
      this.checkRevision(row, etag);
      const staff = STAFF.has(member.role);
      const author = row.author_user_id === userId;
      const ordinary =
        body.title !== undefined ||
        body.bodyMarkdown !== undefined ||
        body.anonymous !== undefined ||
        body.tags !== undefined;
      const duplicate =
        body.duplicateOfPostId !== undefined ||
        body.duplicateStatus !== undefined;
      if (ordinary && !author && !staff)
        throw new AuthError(
          403,
          "permission_denied",
          "Post edit is not permitted",
        );
      if (body.pinned !== undefined && !staff)
        throw new AuthError(403, "permission_denied", "Pinning is staff-only");
      if (
        duplicate &&
        !staff &&
        (body.duplicateStatus !== "suggested" || !body.duplicateOfPostId)
      )
        throw new AuthError(
          403,
          "permission_denied",
          "Duplicate review is staff-only",
        );
      if (
        row.duplicate_status === "confirmed" &&
        (body.duplicateStatus !== "none" ||
          body.duplicateOfPostId !== null ||
          Object.entries(body).some(
            ([key, value]) =>
              value !== undefined &&
              !["duplicateStatus", "duplicateOfPostId"].includes(key),
          ))
      )
        throw new AuthError(
          409,
          "post_merged",
          "Unmerge the post before editing it",
        );
      const targetId =
        body.duplicateOfPostId === undefined
          ? row.duplicate_of_post_id
          : body.duplicateOfPostId;
      const status =
        body.duplicateStatus === undefined
          ? row.duplicate_status
          : body.duplicateStatus;
      if ((status === "none") !== (targetId === null))
        throw validation("Duplicate status and target must agree");
      if (status === "confirmed") {
        const inbound = await db.query(
          "SELECT 1 FROM posts WHERE duplicate_of_post_id=$1 AND duplicate_status='confirmed' AND deleted_at IS NULL LIMIT 1",
          [id],
        );
        if (inbound.rowCount)
          throw new AuthError(
            409,
            "canonical_has_duplicates",
            "Unmerge referring posts first",
          );
      }
      if (targetId !== null) {
        const target = await this.row(db, targetId);
        if (
          !target ||
          target.deleted_at ||
          target.duplicate_status === "confirmed" ||
          target.course_id !== row.course_id ||
          target.id === row.id
        )
          throw validation("Duplicate target is invalid");
      }
      await db.query(
        "UPDATE posts SET title=$2,body_markdown=$3,anonymous=$4,pinned=$5,duplicate_of_post_id=$6,duplicate_status=$7,updated_at=now(),last_activity_at=now(),version=version+1 WHERE id=$1",
        [
          id,
          body.title ?? row.title,
          body.bodyMarkdown ?? row.body_markdown,
          body.anonymous ?? row.anonymous,
          body.pinned ?? row.pinned,
          targetId,
          status,
        ],
      );
      if (body.tags !== undefined)
        await this.replaceTags(db, id, row.course_id, body.tags);
      const updated = (await this.row(db, id))!;
      return status === "confirmed"
        ? this.mergedReference(updated)
        : this.project(db, updated, userId, member.role);
    });
  }
  async delete(
    id: string,
    userId: string,
    etag: string | undefined,
  ): Promise<void> {
    await this.tx(async (db) => {
      const initial = await this.row(db, id);
      if (!initial) throw notFound();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        initial.course_id,
      ]);
      const row = await this.row(db, id, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      if (row.deleted_at) throw notFound();
      this.writable(member.status);
      this.checkRevision(row, etag);
      if (row.duplicate_status === "confirmed")
        throw new AuthError(
          409,
          "post_merged",
          "Unmerge the post before deleting it",
        );
      const inbound = await db.query(
        "SELECT 1 FROM posts WHERE duplicate_of_post_id=$1 AND duplicate_status='confirmed' AND deleted_at IS NULL LIMIT 1",
        [id],
      );
      if (inbound.rowCount)
        throw new AuthError(
          409,
          "canonical_has_duplicates",
          "Unmerge referring posts first",
        );
      if (row.author_user_id !== userId && !STAFF.has(member.role))
        throw new AuthError(
          403,
          "permission_denied",
          "Post deletion is not permitted",
        );
      await db.query("DELETE FROM post_tags WHERE post_id=$1", [id]);
      await db.query(
        "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now(),updated_at=now(),last_activity_at=now(),version=version+1 WHERE id=$1",
        [id],
      );
    });
  }
}
