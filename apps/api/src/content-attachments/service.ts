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
import { assertPostVisible, readablePost } from "../posts/visibility.js";
import type { NewUpload } from "../course-files/service.js";
import { validateUpload } from "../course-files/validate.js";

type Db = Pool | PoolClient;
export type ParentKind = "post" | "answer" | "followup";
export type Attachment = {
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
  post_id: string | null;
  answer_id: string | null;
  followup_id: string | null;
  object_key: string;
  file_name: string;
  media_type: string;
  size_bytes: string;
  created_at: Date;
  deleted_at: Date | null;
};
type Parent = { courseId: string; postId: string | null };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const notFound = () =>
  new AuthError(404, "not_found", "Attachment is not found");
const columns =
  "id,course_id,post_id,answer_id,followup_id,object_key,file_name,media_type,size_bytes,created_at,deleted_at";
const parentColumn: Record<ParentKind, string> = {
  post: "post_id",
  answer: "answer_id",
  followup: "followup_id",
};

function project(row: Row): Attachment {
  return {
    id: row.id,
    fileName: row.file_name,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    downloadUrl: `/api/v1/attachments/${row.id}/download`,
  };
}

export async function listAttachments(
  db: Db,
  kind: ParentKind,
  parentId: string,
): Promise<Attachment[]> {
  const result = await db.query<Row>(
    `SELECT ${columns} FROM content_attachments WHERE ${parentColumn[kind]}=$1 AND deleted_at IS NULL ORDER BY created_at,id`,
    [parentId],
  );
  return result.rows.map(project);
}

async function hideRows(
  db: PoolClient,
  predicate: string,
  id: string,
): Promise<void> {
  const hidden = await db.query<{ id: string; object_key: string }>(
    `UPDATE content_attachments SET deleted_at=statement_timestamp() WHERE ${predicate} AND deleted_at IS NULL RETURNING id,object_key`,
    [id],
  );
  for (const row of hidden.rows)
    await db.query(
      "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_content_attachment',$2,$3) ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
      [uuidv7(), { objectKey: row.object_key }, `attachment-delete:${row.id}`],
    );
}

export async function hideAttachmentsForParent(
  db: PoolClient,
  kind: ParentKind,
  id: string,
): Promise<void> {
  await hideRows(db, `${parentColumn[kind]}=$1`, id);
}

export async function hideAttachmentsForPostTree(
  db: PoolClient,
  postId: string,
): Promise<void> {
  await hideRows(
    db,
    "post_id=$1 OR answer_id IN (SELECT id FROM answers WHERE post_id=$1) OR followup_id IN (SELECT id FROM followups WHERE post_id=$1)",
    postId,
  );
}

export class ContentAttachmentService {
  constructor(
    private readonly pool: Pool,
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  private async parent(
    db: Db,
    kind: ParentKind,
    id: string,
    userId: string,
    write: boolean,
    lock = false,
    allowArchivedReplay = false,
  ): Promise<Parent> {
    if (!uuid.test(id)) throw notFound();
    if (lock && kind === "answer")
      await db.query("SELECT id FROM answers WHERE id=$1 FOR UPDATE", [id]);
    // Followup writes already lock the question before the followup; use the
    // same order so a simultaneous post deletion cannot race the final check.
    if (lock && kind === "followup")
      await db.query(
        "SELECT p.id FROM followups f JOIN posts p ON p.id=f.post_id WHERE f.id=$1 FOR NO KEY UPDATE OF p",
        [id],
      );
    const parentTable =
      kind === "post" ? "posts" : kind === "answer" ? "answers" : "followups";
    const postJoin = kind === "post" ? "" : " JOIN posts p ON p.id=t.post_id";
    const postDeleted = kind === "post" ? "t.deleted_at" : "p.deleted_at";
    const duplicate =
      kind === "post" ? "t.duplicate_status" : "p.duplicate_status";
    const readable = readablePost(kind === "post" ? "t" : "p", "$2");
    const lockClause = lock
      ? ` FOR UPDATE OF t FOR SHARE OF c,m${kind === "post" ? "" : " FOR NO KEY UPDATE OF p"}`
      : "";
    const result = await db.query<{
      course_id: string;
      post_id: string | null;
      author_user_id: string | null;
      edit_role_floor: "student" | "ta" | "instructor" | null;
      deleted_at: Date | null;
      post_deleted_at: Date | null;
      duplicate_status: string;
      status: string;
      role: "student" | "ta" | "instructor";
      readable: boolean;
    }>(
      `SELECT t.course_id,${kind === "post" ? "t.id" : "t.post_id"} AS post_id,
       ${kind === "answer" ? "NULL::uuid" : "t.author_user_id"} AS author_user_id,
       ${kind === "answer" ? "t.edit_role_floor" : "NULL::text"} AS edit_role_floor,
       t.deleted_at,${postDeleted} AS post_deleted_at,${duplicate} AS duplicate_status,c.status,m.role,${readable} AS readable
       FROM ${parentTable} t${postJoin}
       JOIN courses c ON c.id=t.course_id
       JOIN course_memberships m ON m.course_id=t.course_id AND m.user_id=$2
       JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
       WHERE t.id=$1${lockClause}`,
      [id, userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.deleted_at ||
      row.post_deleted_at ||
      row.duplicate_status === "confirmed" ||
      !row.readable
    )
      throw notFound();
    if (lock) await assertPostVisible(db, row.post_id!, userId);
    if (row.status !== "active") {
      if (!write && row.status === "archived")
        return { courseId: row.course_id, postId: row.post_id };
      if (!write) throw notFound();
      if (!(allowArchivedReplay && row.status === "archived"))
        throw new AuthError(409, "course_archived", "Course is not active");
    }
    if (write) {
      const staff = row.role === "ta" || row.role === "instructor";
      const rank = { student: 0, ta: 1, instructor: 2 };
      const allowed =
        kind === "answer"
          ? rank[row.role] >= rank[row.edit_role_floor!]
          : userId === row.author_user_id || staff;
      if (!allowed)
        throw new AuthError(
          403,
          "permission_denied",
          "Parent cannot be edited",
        );
    }
    return { courseId: row.course_id, postId: row.post_id };
  }

  async authorizeUpload(
    kind: ParentKind,
    id: string,
    userId: string,
    key?: string,
  ): Promise<void> {
    if (key !== undefined && (!key.length || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    try {
      await this.parent(this.pool, kind, id, userId, true);
    } catch (error) {
      if (
        !key ||
        !(error instanceof AuthError) ||
        error.code !== "course_archived"
      )
        throw error;
      await this.parent(this.pool, kind, id, userId, true, false, true);
      const scope = `content-attachment-create:${userId}:${kind}:${id}`;
      const prior = await this.pool.query(
        "SELECT 1 FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [scope, key],
      );
      if (!prior.rowCount) throw error;
    }
  }

  async create(
    kind: ParentKind,
    parentId: string,
    userId: string,
    upload: NewUpload,
    key?: string,
  ): Promise<Attachment> {
    if (key !== undefined && (!key.length || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    await this.authorizeUpload(kind, parentId, userId, key);
    const name = basename(upload.fileName);
    if (
      !name ||
      name.length > 255 ||
      name !== upload.fileName ||
      name.includes("\\") ||
      [...name].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
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
          kind,
          parentId,
          name,
          declaredType: upload.declaredType.toLowerCase(),
          sha256: checksum.toString("hex"),
        }),
      )
      .digest();
    const scope = `content-attachment-create:${userId}:${kind}:${parentId}`;
    const client = await this.pool.connect();
    let objectKey: string | undefined;
    let createdId: string | undefined;
    let commitAttempted = false;
    try {
      await client.query("BEGIN");
      if (key) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const previous = await client.query<{
          request_hash: Buffer;
          response_body: Attachment;
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
          await this.parent(client, kind, parentId, userId, true, true, true);
          const stillLive = await client.query(
            "SELECT 1 FROM content_attachments WHERE id=$1 AND deleted_at IS NULL",
            [previous.rows[0].response_body.id],
          );
          if (!stillLive.rowCount) throw notFound();
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
      const parent = await this.parent(
        client,
        kind,
        parentId,
        userId,
        true,
        true,
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM content_attachments WHERE ${parentColumn[kind]}=$1 AND deleted_at IS NULL`,
        [parentId],
      );
      if (Number(count.rows[0].count) >= 5)
        throw new AuthError(
          413,
          "payload_too_large",
          "Parent already has five attachments",
        );
      const id = uuidv7();
      createdId = id;
      objectKey = `courses/${parent.courseId}/attachments/${id}`;
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
        `INSERT INTO content_attachments (id,course_id,${parentColumn[kind]},object_key,file_name,media_type,size_bytes,checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,
        [
          id,
          parent.courseId,
          parentId,
          objectKey,
          name,
          mediaType,
          upload.sizeBytes,
          checksum,
        ],
      );
      await this.bumpParent(client, kind, parentId, parent.postId, userId);
      const value = project(inserted.rows[0]!);
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
            "SELECT 1 FROM content_attachments WHERE id=$1",
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
        "Attachment storage is temporarily unavailable",
      );
    } finally {
      client.release();
    }
  }

  private async bumpParent(
    db: PoolClient,
    kind: ParentKind,
    id: string,
    postId: string | null,
    userId: string,
  ) {
    if (kind === "post")
      await db.query(
        "UPDATE posts SET version=version+1,updated_at=statement_timestamp(),last_activity_at=statement_timestamp() WHERE id=$1",
        [id],
      );
    else if (kind === "answer") {
      await db.query(
        "UPDATE answers SET version=version+1,updated_at=statement_timestamp(),endorsed_at=NULL,endorsed_by_user_id=NULL WHERE id=$1",
        [id],
      );
      await db.query(
        "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [id, userId],
      );
      await db.query(
        "INSERT INTO answer_contribution_events (course_id,answer_id,user_id,contributed_at) SELECT course_id,id,$2,statement_timestamp() FROM answers WHERE id=$1",
        [id, userId],
      );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [postId],
      );
    } else {
      await db.query(
        "UPDATE followups SET version=version+1,updated_at=statement_timestamp() WHERE id=$1",
        [id],
      );
      await db.query(
        "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
        [postId],
      );
    }
  }

  async download(id: string, userId: string) {
    if (!uuid.test(id)) throw notFound();
    const result = await this.pool.query<Row>(
      `SELECT ${columns} FROM content_attachments WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    const kind: ParentKind = row.post_id
      ? "post"
      : row.answer_id
        ? "answer"
        : "followup";
    await this.parent(
      this.pool,
      kind,
      row.post_id ?? row.answer_id ?? row.followup_id!,
      userId,
      false,
    );
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
        "Attachment storage is temporarily unavailable",
      );
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    if (!uuid.test(id)) throw notFound();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const initial = await client.query<Row>(
        `SELECT ${columns} FROM content_attachments WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      );
      if (!initial.rows[0]) throw notFound();
      const kind: ParentKind = initial.rows[0].post_id
        ? "post"
        : initial.rows[0].answer_id
          ? "answer"
          : "followup";
      const parentId =
        initial.rows[0].post_id ??
        initial.rows[0].answer_id ??
        initial.rows[0].followup_id!;
      const parent = await this.parent(
        client,
        kind,
        parentId,
        userId,
        true,
        true,
      );
      const found = await client.query<Row>(
        `SELECT ${columns} FROM content_attachments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      const row = found.rows[0];
      if (!row) throw notFound();
      await client.query(
        "UPDATE content_attachments SET deleted_at=statement_timestamp() WHERE id=$1",
        [id],
      );
      await this.bumpParent(client, kind, parentId, parent.postId, userId);
      await client.query(
        "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'delete_content_attachment',$2,$3)",
        [uuidv7(), { objectKey: row.object_key }, `attachment-delete:${id}`],
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
