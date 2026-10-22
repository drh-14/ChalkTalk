import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuid } from "uuid";
import { AuthError } from "../auth/errors.js";
import type { CourseFile } from "../course-files/service.js";

export type ResourceLink = {
  kind: "link";
  id: string;
  courseId: string;
  title: string;
  url: string;
  createdAt: string;
};
export type CourseResource = ({ kind: "upload" } & CourseFile) | ResourceLink;
type Row = {
  kind: "upload" | "link";
  id: string;
  course_id: string;
  title: string;
  url: string;
  file_name: string;
  media_type: string;
  size_bytes: string;
  created_at: Date;
  cursor_timestamp: string;
};
const project = (row: Row): CourseResource =>
  row.kind === "link"
    ? {
        kind: "link",
        id: row.id,
        courseId: row.course_id,
        title: row.title,
        url: row.url,
        createdAt: row.created_at.toISOString(),
      }
    : {
        kind: "upload",
        id: row.id,
        courseId: row.course_id,
        fileName: row.file_name,
        mediaType: row.media_type,
        sizeBytes: Number(row.size_bytes),
        createdAt: row.created_at.toISOString(),
      };
const invalid = () =>
  new AuthError(
    422,
    "validation_failed",
    "A nonblank title (up to 200 characters) and absolute HTTP(S) URL (up to 2048 characters, without credentials) are required",
  );
export class CourseResourceService {
  constructor(private readonly pool: Pool) {}
  private async authorize(
    db: Pool | PoolClient,
    courseId: string,
    userId: string,
    write = false,
  ) {
    const found = await db.query<{ status: string; role: string }>(
      `SELECT c.status,m.role FROM courses c JOIN course_memberships m ON m.course_id=c.id JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE c.id=$1 AND m.user_id=$2${write ? " FOR UPDATE OF c,m" : ""}`,
      [courseId, userId],
    );
    const row = found.rows[0];
    if (!row || (write && row.role !== "instructor"))
      throw new AuthError(
        write ? 403 : 404,
        write ? "permission_denied" : "not_found",
        write ? "Instructor role is required" : "Course is not found",
      );
    if (!["active", "archived"].includes(row.status))
      throw new AuthError(
        write ? 409 : 404,
        write ? "course_archived" : "not_found",
        write ? "Course is not active" : "Course is not found",
      );
    return row.status;
  }
  async list(courseId: string, userId: string, limit: number, cursor?: string) {
    await this.authorize(this.pool, courseId, userId);
    let after: { at: string; id: string; kind: string } | undefined;
    if (cursor !== undefined) {
      try {
        const raw = Buffer.from(cursor, "base64url");
        if (
          !/^[A-Za-z0-9_-]+$/.test(cursor) ||
          raw.toString("base64url") !== cursor
        )
          throw Error();
        const value: unknown = JSON.parse(raw.toString("utf8"));
        if (
          !Array.isArray(value) ||
          value.length !== 5 ||
          value[0] !== "course-resources:v1" ||
          value[1] !== courseId ||
          typeof value[2] !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[2]) ||
          value[2].startsWith("0000-") ||
          !Number.isFinite(Date.parse(value[2])) ||
          new Date(value[2]).toISOString() !== value[2].slice(0, 23) + "Z" ||
          typeof value[3] !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            value[3],
          ) ||
          !["upload", "link"].includes(value[4])
        )
          throw Error();
        after = { at: value[2], id: value[3], kind: value[4] };
      } catch {
        throw new AuthError(
          400,
          "invalid_request",
          "Pagination cursor is invalid",
        );
      }
    }
    const found = await this.pool.query<Row>(
      `WITH resources AS (
    SELECT 'upload'::text AS kind,id,course_id,NULL::text AS title,NULL::text AS url,file_name,media_type,size_bytes,created_at FROM course_files WHERE course_id=$1 AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM course_information i WHERE i.syllabus_file_id=course_files.id)
    UNION ALL
    SELECT 'link'::text AS kind,id,course_id,title,url,NULL::text,NULL::text,NULL::bigint,created_at FROM course_resource_links WHERE course_id=$1
   ) SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_timestamp FROM resources
   ${after ? "WHERE (created_at,id,kind)<($3::timestamptz,$4::uuid,$5::text)" : ""}
   ORDER BY created_at DESC,id DESC,kind DESC LIMIT $2`,
      after
        ? [courseId, limit + 1, after.at, after.id, after.kind]
        : [courseId, limit + 1],
    );
    const rows = found.rows.slice(0, limit),
      last = rows.at(-1),
      hasMore = found.rows.length > limit;
    return {
      data: rows.map(project),
      page: {
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify([
                  "course-resources:v1",
                  courseId,
                  last.cursor_timestamp,
                  last.id,
                  last.kind,
                ]),
              ).toString("base64url")
            : null,
      },
    };
  }
  async create(
    courseId: string,
    userId: string,
    input: { title: unknown; url: unknown },
    key?: string,
  ): Promise<ResourceLink> {
    if (typeof input.title !== "string" || typeof input.url !== "string")
      throw invalid();
    const title = input.title.trim(),
      url = input.url.trim();
    if (
      !title.length ||
      [...title].length > 200 ||
      title.includes("\u0000") ||
      [...url].length > 2048 ||
      !/^https?:\/\//i.test(url) ||
      url.includes("\\") ||
      // Raw C0/C1 controls must be rejected before URL parsing can normalize them.
      // eslint-disable-next-line no-control-regex
      /[\s\p{White_Space}\u0000-\u001f\u007f-\u009f]/u.test(input.url)
    )
      throw invalid();
    try {
      const parsed = new URL(url);
      if (
        !parsed.hostname ||
        parsed.username ||
        parsed.password ||
        !["http:", "https:"].includes(parsed.protocol)
      )
        throw Error();
    } catch {
      throw invalid();
    }
    if (key !== undefined && (!key.length || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    const scope = `course-resource-link-create:${userId}:${courseId}`,
      hash = createHash("sha256")
        .update(JSON.stringify({ title, url }))
        .digest();
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      if (key)
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
      const status = await this.authorize(db, courseId, userId, true);
      if (key) {
        const previous = await db.query<{
          request_hash: Buffer;
          response_body: ResourceLink;
        }>(
          "SELECT request_hash,response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
          [scope, key],
        );
        if (previous.rows[0]) {
          const p = previous.rows[0];
          if (!p.request_hash.equals(hash))
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key was used with different input",
            );
          const visible = await db.query(
            "SELECT 1 FROM course_resource_links WHERE id=$1 AND course_id=$2 AND created_by_user_id=$3",
            [p.response_body.id, courseId, userId],
          );
          if (!visible.rowCount)
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key refers to an unavailable link",
            );
          await db.query("COMMIT");
          return p.response_body;
        }
        await db.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      if (status !== "active")
        throw new AuthError(409, "course_archived", "Course is archived");
      const inserted = await db.query<Row>(
        `INSERT INTO course_resource_links(id,course_id,title,url,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING 'link'::text AS kind,*`,
        [uuid(), courseId, title, url, userId],
      );
      const result = project(inserted.rows[0]!) as ResourceLink;
      if (key)
        await db.query(
          "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, result],
        );
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
