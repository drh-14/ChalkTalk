import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import type { NewUpload } from "../course-files/service.js";
import { validateUpload } from "../course-files/validate.js";
import { appendChange } from "./service.js";

type Db = Pool | PoolClient;
export type ThreadAttachment = {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
};
type Row = {
  id: string;
  course_id: string;
  board_id: string;
  conversation_id: string;
  message_id: string;
  object_key: string;
  file_name: string;
  media_type: string;
  size_bytes: string;
  created_at: Date;
  deleted_at: Date | null;
};
type Parent = { courseId: string; boardId: string; conversationId: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns =
  "id,course_id,board_id,conversation_id,message_id,object_key,file_name,media_type,size_bytes,created_at,deleted_at";
const notFound = () =>
  new AuthError(404, "not_found", "Thread attachment is not found");
function project(row: Row): ThreadAttachment {
  return {
    id: row.id,
    fileName: row.file_name,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    downloadUrl: `/api/v1/thread-attachments/${row.id}/download`,
  };
}

export async function listThreadAttachments(
  db: Db,
  messageId: string,
): Promise<ThreadAttachment[]> {
  const found = await db.query<Row>(
    `SELECT ${columns} FROM thread_attachments WHERE message_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,
    [messageId],
  );
  return found.rows.map(project);
}

async function hide(
  db: PoolClient,
  predicate: string,
  id: string,
): Promise<void> {
  const hidden = await db.query<{ id: string; object_key: string }>(
    `UPDATE thread_attachments SET deleted_at=statement_timestamp() WHERE ${predicate} AND deleted_at IS NULL RETURNING id,object_key`,
    [id],
  );
  for (const row of hidden.rows)
    await db.query(
      "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_content_attachment',$2,$3) ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
      [
        uuidv7(),
        { objectKey: row.object_key },
        `thread-attachment-delete:${row.id}`,
      ],
    );
}
export async function hideThreadAttachmentsForMessage(
  db: PoolClient,
  messageId: string,
): Promise<void> {
  await hide(db, "message_id=$1", messageId);
}
export async function hideThreadAttachmentsForBoard(
  db: PoolClient,
  boardId: string,
): Promise<void> {
  await hide(db, "board_id=$1", boardId);
}
export async function hideThreadAttachmentsForConversation(
  db: PoolClient,
  conversationId: string,
): Promise<void> {
  await hide(db, "conversation_id=$1", conversationId);
}
export async function queueThreadAttachmentsForCourseDeletion(
  db: PoolClient,
  courseId: string,
): Promise<void> {
  await hide(db, "course_id=$1", courseId);
}

export class ThreadAttachmentService {
  constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  private async parent(
    db: Db,
    messageId: string,
    userId: string,
    write: boolean,
    lock = false,
  ): Promise<Parent> {
    if (!uuid.test(messageId)) throw notFound();
    if (lock) {
      // Follow the core Thread write order (course membership, then board,
      // then message) so archive, membership removal, and board deletion
      // cannot race the final check before an object is persisted.
      const member = await db.query(
        `SELECT c.id FROM thread_messages m
         JOIN courses c ON c.id=m.course_id
         JOIN course_memberships cm ON cm.course_id=c.id AND cm.user_id=$2
         WHERE m.id=$1 FOR SHARE OF c,cm`,
        [messageId, userId],
      );
      if (!member.rowCount) throw notFound();
      const board = await db.query(
        "SELECT b.id FROM thread_messages m JOIN thread_boards b ON b.id=m.board_id WHERE m.id=$1 FOR UPDATE OF b",
        [messageId],
      );
      if (!board.rowCount) throw notFound();
      const conversation = await db.query(
        "SELECT c.id FROM thread_messages m JOIN thread_conversations c ON c.id=m.conversation_id WHERE m.id=$1 FOR UPDATE OF c",
        [messageId],
      );
      if (!conversation.rowCount) throw notFound();
    }
    const found = await db.query<{
      course_id: string;
      board_id: string;
      conversation_id: string;
      author_user_id: string | null;
      author_role_at_posting: "student" | "ta" | "instructor";
      status: string;
      role: "student" | "ta" | "instructor";
    }>(
      `SELECT m.course_id,m.board_id,m.conversation_id,m.author_user_id,m.author_role_at_posting,c.status,cm.role
       FROM thread_messages m
       JOIN thread_boards b ON b.id=m.board_id AND b.deleted_at IS NULL
       JOIN courses c ON c.id=m.course_id
       JOIN course_memberships cm ON cm.course_id=m.course_id AND cm.user_id=$2
       JOIN users u ON u.id=cm.user_id AND u.deleted_at IS NULL
       WHERE m.id=$1 AND m.deleted_at IS NULL${lock ? " FOR UPDATE OF m" : ""}`,
      [messageId, userId],
    );
    const row = found.rows[0];
    if (!row) throw notFound();
    if (write) {
      if (row.status !== "active")
        throw new AuthError(409, "course_archived", "Course is not active");
      if (
        row.author_user_id !== userId &&
        !(row.author_role_at_posting === "student" && row.role !== "student")
      )
        throw new AuthError(
          403,
          "permission_denied",
          "Message cannot be edited",
        );
    } else if (row.status !== "active" && row.status !== "archived")
      throw notFound();
    return {
      courseId: row.course_id,
      boardId: row.board_id,
      conversationId: row.conversation_id,
    };
  }

  async authorizeUpload(
    messageId: string,
    userId: string,
    key?: string,
  ): Promise<void> {
    if (key !== undefined && (!key.length || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    await this.parent(this.pool, messageId, userId, true);
  }

  async create(
    messageId: string,
    userId: string,
    upload: NewUpload,
    key?: string,
  ): Promise<ThreadAttachment> {
    await this.authorizeUpload(messageId, userId, key);
    const name = basename(upload.fileName);
    if (
      !name ||
      name.length > 255 ||
      name !== upload.fileName ||
      name.includes("\\") ||
      [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw new AuthError(422, "validation_failed", "File name is invalid");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(upload.filePath))
      digest.update(chunk);
    const checksum = digest.digest();
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          messageId,
          name,
          declaredType: upload.declaredType.toLowerCase(),
          sha256: checksum.toString("hex"),
        }),
      )
      .digest();
    const scope = `thread-attachment-create:${userId}:${messageId}`;
    const client = await this.pool.connect();
    let objectKey: string | undefined;
    let createdId: string | undefined;
    let commitAttempted = false;
    try {
      await client.query("BEGIN");
      const lockedParent = await this.parent(
        client,
        messageId,
        userId,
        true,
        true,
      );
      if (key) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const previous = await client.query<{
          request_hash: Buffer;
          response_body: ThreadAttachment;
        }>(
          "SELECT request_hash,response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
          [scope, key],
        );
        if (previous.rows[0]) {
          if (!previous.rows[0].request_hash.equals(requestHash))
            throw new AuthError(
              409,
              "idempotency_key_reused",
              "Idempotency key was reused",
            );
          await this.parent(client, messageId, userId, true, true);
          const live = await client.query(
            "SELECT 1 FROM thread_attachments WHERE id=$1 AND deleted_at IS NULL",
            [previous.rows[0].response_body.id],
          );
          if (!live.rowCount) throw notFound();
          await client.query("COMMIT");
          return previous.rows[0].response_body;
        }
        await client.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      const mediaType = await validateUpload(
        name,
        upload.declaredType,
        upload.filePath,
      );
      const parent = lockedParent;
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM thread_attachments WHERE message_id=$1 AND deleted_at IS NULL",
        [messageId],
      );
      if (Number(count.rows[0].count) >= 5)
        throw new AuthError(
          413,
          "payload_too_large",
          "Message already has five attachments",
        );
      const id = uuidv7();
      createdId = id;
      objectKey = `courses/${parent.courseId}/thread-attachments/${id}`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: createReadStream(upload.filePath),
          ContentType: mediaType,
          ContentLength: upload.sizeBytes,
        }),
      );
      const inserted = await client.query<Row>(
        `INSERT INTO thread_attachments (id,course_id,board_id,conversation_id,message_id,object_key,file_name,media_type,size_bytes,checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${columns}`,
        [
          id,
          parent.courseId,
          parent.boardId,
          parent.conversationId,
          messageId,
          objectKey,
          name,
          mediaType,
          upload.sizeBytes,
          checksum,
        ],
      );
      const value = project(inserted.rows[0]!);
      await appendChange(
        client,
        parent.courseId,
        parent.boardId,
        "attachment_created",
        id,
      );
      await client.query(
        "UPDATE thread_conversations SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [parent.conversationId],
      );
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
            "SELECT 1 FROM thread_attachments WHERE id=$1",
            [createdId],
          );
          deleteObject = persisted.rowCount === 0;
        } catch {
          deleteObject = false;
        }
      }
      if (objectKey && deleteObject)
        await this.s3
          .send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
          )
          .catch(() => {});
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        503,
        "service_unavailable",
        "Thread attachment storage is temporarily unavailable",
      );
    } finally {
      client.release();
    }
  }

  async download(id: string, userId: string) {
    if (!uuid.test(id)) throw notFound();
    const found = await this.pool.query<Row>(
      `SELECT ${columns} FROM thread_attachments WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw notFound();
    await this.parent(this.pool, row.message_id, userId, false);
    try {
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: row.object_key }),
      );
      if (!object.Body) throw new Error("Stored object has no body");
      return {
        name: row.file_name,
        mediaType: row.media_type,
        length: Number(row.size_bytes),
        body: object.Body,
      };
    } catch {
      throw new AuthError(
        503,
        "service_unavailable",
        "Thread attachment storage is temporarily unavailable",
      );
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    if (!uuid.test(id)) throw notFound();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const initial = await client.query<Row>(
        `SELECT ${columns} FROM thread_attachments WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      );
      if (!initial.rows[0]) throw notFound();
      const parent = await this.parent(
        client,
        initial.rows[0].message_id,
        userId,
        true,
        true,
      );
      const found = await client.query<Row>(
        `SELECT ${columns} FROM thread_attachments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (!found.rows[0]) throw notFound();
      await hide(client, "id=$1", id);
      await client.query(
        "UPDATE thread_conversations SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [parent.conversationId],
      );
      await appendChange(
        client,
        parent.courseId,
        parent.boardId,
        "attachment_deleted",
        id,
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
