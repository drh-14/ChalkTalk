import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import { validateUpload } from "./validate.js";

export interface CourseFile {
  id: string;
  courseId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
}
type Row = {
  id: string;
  course_id: string;
  uploaded_by_user_id: string | null;
  object_key: string;
  file_name: string;
  media_type: string;
  size_bytes: string;
  created_at: Date;
  deleted_at: Date | null;
};
const select =
  "id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,created_at,deleted_at";
function project(row: Row): CourseFile {
  return {
    id: row.id,
    courseId: row.course_id,
    fileName: row.file_name,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
  };
}
export interface NewUpload {
  fileName: string;
  declaredType: string;
  filePath: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
}
export class CourseFileService {
  constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  private async authorize(
    db: Pool | PoolClient,
    courseId: string,
    userId: string,
    instructor: boolean,
    lock = false,
  ): Promise<string> {
    const found = await db.query<{ status: string; role: string }>(
      `SELECT c.status,m.role FROM courses c JOIN course_memberships m ON m.course_id=c.id JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE c.id=$1 AND m.user_id=$2${lock ? " FOR UPDATE OF c,m" : ""}`,
      [courseId, userId],
    );
    if (!found.rows[0])
      throw new AuthError(
        instructor ? 403 : 404,
        instructor ? "permission_denied" : "not_found",
        instructor ? "Instructor role is required" : "File is not found",
      );
    if (instructor && found.rows[0].role !== "instructor")
      throw new AuthError(
        403,
        "permission_denied",
        "Instructor role is required",
      );
    return found.rows[0].status;
  }

  async list(courseId: string, userId: string, limit: number, cursor?: string) {
    const status = await this.authorize(this.pool, courseId, userId, false);
    if (status !== "active" && status !== "archived")
      throw new AuthError(404, "not_found", "Course is not found");
    let after: { timestamp: string; id: string } | undefined;
    if (cursor !== undefined) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 2048)
          throw new Error("Invalid encoding");
        const bytes = Buffer.from(cursor, "base64url");
        if (bytes.toString("base64url") !== cursor)
          throw new Error("Invalid encoding");
        const value: unknown = JSON.parse(bytes.toString("utf8"));
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          value[0] !== courseId ||
          typeof value[1] !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[1]) ||
          value[1].startsWith("0000-") ||
          !Number.isFinite(Date.parse(value[1])) ||
          new Date(value[1]).toISOString() !== value[1].slice(0, 23) + "Z" ||
          typeof value[2] !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            value[2],
          )
        )
          throw new Error("Invalid cursor");
        after = { timestamp: value[1], id: value[2] };
      } catch {
        throw new AuthError(
          400,
          "invalid_request",
          "Pagination cursor is invalid",
        );
      }
    }
    const found = await this.pool.query<Row & { cursor_timestamp: string }>(
      `SELECT ${select},to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_timestamp
       FROM course_files WHERE course_id=$1 AND deleted_at IS NULL
       ${after ? "AND (created_at,id)<($3::timestamptz,$4::uuid)" : ""}
       ORDER BY created_at DESC,id DESC LIMIT $2`,
      after
        ? [courseId, limit + 1, after.timestamp, after.id]
        : [courseId, limit + 1],
    );
    const rows = found.rows.slice(0, limit);
    const hasMore = found.rows.length > limit;
    const last = rows.at(-1);
    return {
      data: rows.map(project),
      page: {
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify([courseId, last.cursor_timestamp, last.id]),
              ).toString("base64url")
            : null,
      },
    };
  }

  async authorizeUpload(
    courseId: string,
    userId: string,
    key?: string,
  ): Promise<void> {
    if (key !== undefined && (!key.length || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    const status = await this.authorize(this.pool, courseId, userId, true);
    if (status === "active") return;
    if (status === "archived" && key) {
      const scope = `course-file-create:${userId}:${courseId}`;
      const previous = await this.pool.query(
        "SELECT 1 FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [scope, key],
      );
      if (previous.rowCount) return;
    }
    throw new AuthError(409, "course_archived", "Course is archived");
  }

  async create(
    courseId: string,
    userId: string,
    upload: NewUpload,
    key?: string,
    associate?: (client: PoolClient, file: CourseFile) => Promise<void>,
  ): Promise<CourseFile> {
    await this.authorizeUpload(courseId, userId, key);
    const name = basename(upload.fileName);
    if (
      !name ||
      name.length > 255 ||
      name !== upload.fileName ||
      name.includes("\\") ||
      [...name].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new AuthError(422, "validation_failed", "File name is invalid");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(upload.filePath))
      digest.update(chunk);
    const checksum = digest.digest();
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          name,
          declaredType: upload.declaredType.toLowerCase(),
          sha256: checksum.toString("hex"),
        }),
      )
      .digest();
    const scope = `course-file-create:${userId}:${courseId}`;
    const client = await this.pool.connect();
    let storedObject: string | undefined;
    let createdId: string | undefined;
    let commitAttempted = false;
    try {
      await client.query("BEGIN");
      if (key)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
      const courseStatus = await this.authorize(client, courseId, userId, true);
      if (key) {
        const previous = await client.query<{
          request_hash: Buffer;
          response_body: CourseFile;
        }>(
          "SELECT request_hash,response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
          [scope, key],
        );
        if (previous.rows[0]) {
          if (!previous.rows[0].request_hash.equals(requestHash))
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key was used with a different request",
            );
          const response = previous.rows[0].response_body;
          const lockedStatus = await this.authorize(
            client,
            courseId,
            userId,
            true,
            true,
          );
          if (lockedStatus !== "active" && lockedStatus !== "archived")
            throw new AuthError(409, "course_archived", "Course is archived");
          const visible = await client.query(
            "SELECT 1 FROM course_files WHERE id=$1 AND course_id=$2 AND uploaded_by_user_id=$3 AND deleted_at IS NULL FOR SHARE",
            [response.id, courseId, userId],
          );
          if (!visible.rowCount)
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key refers to a deleted file",
            );
          await client.query("COMMIT");
          return response;
        }
        await client.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      if (courseStatus !== "active")
        throw new AuthError(409, "course_archived", "Course is archived");
      const mediaType = await validateUpload(
        name,
        upload.declaredType,
        upload.filePath,
      );
      const id = uuidv7();
      createdId = id;
      storedObject = `courses/${courseId}/files/${id}`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storedObject,
          Body: createReadStream(upload.filePath),
          ContentType: mediaType,
          ContentLength: upload.sizeBytes,
        }),
      );
      if (
        (await this.authorize(client, courseId, userId, true, true)) !==
        "active"
      )
        throw new AuthError(409, "course_archived", "Course is archived");
      const inserted = await client.query<Row>(
        `INSERT INTO course_files (id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${select}`,
        [
          id,
          courseId,
          userId,
          storedObject,
          name,
          mediaType,
          upload.sizeBytes,
          checksum,
        ],
      );
      const value = project(inserted.rows[0]!);
      await associate?.(client, value);
      if (key)
        await client.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, requestHash, value],
        );
      commitAttempted = true;
      await client.query("COMMIT");
      return value;
    } catch (error) {
      const rolledBack = await client.query("ROLLBACK").then(
        () => true,
        () => false,
      );
      let deleteObject = !commitAttempted;
      if (commitAttempted && rolledBack && createdId) {
        try {
          const persisted = await this.pool.query(
            "SELECT 1 FROM course_files WHERE id=$1",
            [createdId],
          );
          deleteObject = persisted.rowCount === 0;
        } catch {
          deleteObject = false;
        }
      }
      if (storedObject && deleteObject)
        await this.s3
          .send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: storedObject }),
          )
          .catch(() => {});
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        503,
        "service_unavailable",
        "File storage is temporarily unavailable",
      );
    } finally {
      client.release();
    }
  }

  async download(courseId: string, fileId: string, userId: string) {
    const found = await this.pool.query<Row>(
      `SELECT ${select} FROM course_files WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL`,
      [fileId, courseId],
    );
    const row = found.rows[0];
    if (!row) throw new AuthError(404, "not_found", "File is not found");
    const status = await this.authorize(this.pool, courseId, userId, false);
    if (status !== "active" && status !== "archived")
      throw new AuthError(404, "not_found", "File is not found");
    try {
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: row.object_key }),
      );
      if (!object.Body) throw new Error("Stored object has no body");
      return {
        mediaType: row.media_type,
        name: row.file_name,
        length: Number(row.size_bytes),
        body: object.Body,
      };
    } catch {
      throw new AuthError(
        503,
        "service_unavailable",
        "File storage is temporarily unavailable",
      );
    }
  }

  async delete(
    courseId: string,
    fileId: string,
    userId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const status = await this.authorize(client, courseId, userId, true, true);
      const found = await client.query<Row>(
        `SELECT ${select} FROM course_files WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [fileId, courseId],
      );
      const row = found.rows[0];
      if (!row) throw new AuthError(404, "not_found", "File is not found");
      if (row.uploaded_by_user_id !== userId)
        throw new AuthError(
          403,
          "permission_denied",
          "Only the uploader may delete this file",
        );
      if (status !== "active")
        throw new AuthError(409, "course_archived", "Course is archived");
      const reference = await client.query(
        "SELECT 1 FROM course_information WHERE course_id=$1 AND syllabus_file_id=$2",
        [courseId, fileId],
      );
      if (reference.rowCount)
        throw new AuthError(
          409,
          "file_in_use",
          "Remove or replace the syllabus before deleting this file",
        );
      await client.query(
        "UPDATE course_files SET deleted_at=clock_timestamp() WHERE id=$1",
        [fileId],
      );
      await client.query(
        "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_course_file',$2,$3)",
        [
          uuidv7(),
          { courseId, fileId, objectKey: row.object_key },
          `file-delete:${fileId}`,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
