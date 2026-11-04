import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuid } from "uuid";
import { AuthError } from "../auth/errors.js";
import type { CourseFileService, NewUpload } from "../course-files/service.js";
import { queueFileTextExtraction } from "../resource-text/queue.js";
import {
  HIGHLIGHT_START,
  HIGHLIGHT_STOP,
  toSnippet,
  type Snippet,
} from "../resource-text/snippet.js";
type Db = Pool | PoolClient;
export type Section = {
  id: string;
  courseId: string;
  title: string;
  visibility: "class" | "staff";
  position: number;
  version: number;
};
export type ResourceLink = {
  kind: "link";
  id: string;
  courseId: string;
  title: string;
  url: string;
  createdAt: string;
  sectionId: string | null;
  visibility: "class" | "staff";
  position: number;
  version: number;
};
export type CourseResource =
  | ResourceLink
  | {
      kind: "upload";
      id: string;
      courseId: string;
      title: string;
      fileId: string;
      fileName: string;
      mediaType: string;
      sizeBytes: number;
      textStatus: TextStatus;
      createdAt: string;
      sectionId: string | null;
      visibility: "class" | "staff";
      position: number;
      version: number;
    };
export type TextStatus = "pending" | "ready" | "failed" | "unsupported";
export type ResourceSearchMatch = { inTitle: boolean; snippet: Snippet | null };
type Row = {
  id: string;
  course_id: string;
  title: string;
  section_id: string | null;
  visibility: "class" | "staff";
  position: number;
  version: number;
  kind: "upload" | "link";
  url: string;
  file_id: string;
  file_name: string;
  media_type: string;
  size_bytes: string;
  text_status: TextStatus | null;
  created_at: Date;
  active_revision_id: string;
};
const select = `SELECT r.*,v.kind,v.url,v.file_id,f.file_name,f.media_type,f.size_bytes,t.status text_status FROM course_resources r JOIN course_resource_revisions v ON v.id=r.active_revision_id LEFT JOIN course_files f ON f.id=v.file_id LEFT JOIN course_file_texts t ON t.file_id=v.file_id LEFT JOIN course_resource_sections s ON s.id=r.section_id`;
const visible = `r.deleted_at IS NULL AND (m.role IN ('ta','instructor') OR (r.visibility='class' AND COALESCE(s.visibility,'class')='class')) AND (v.kind='link' OR f.deleted_at IS NULL)`;
const invalid = (message = "Resource metadata is invalid") =>
  new AuthError(422, "validation_failed", message);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validSectionId(value: unknown) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw invalid();
  return value;
}
const missing = () => new AuthError(404, "not_found", "Resource is not found");
function title(value: unknown) {
  if (
    typeof value !== "string" ||
    ![...value.trim()].length ||
    [...value.trim()].length > 200 ||
    value.includes("\0")
  )
    throw invalid();
  return value.trim();
}
function visibility(value: unknown) {
  if (value !== undefined && value !== "class" && value !== "staff")
    throw invalid();
  return (value ?? "class") as "class" | "staff";
}
function link(value: unknown) {
  if (
    typeof value !== "string" ||
    [...value].length > 2048 ||
    /[\p{White_Space}\p{Cc}\\]/u.test(value) ||
    !/^https?:\/\//i.test(value)
  )
    throw invalid("A safe absolute HTTP(S) URL is required");
  try {
    const u = new URL(value);
    if (!u.hostname || u.username || u.password) throw Error();
  } catch {
    throw invalid();
  }
  return value;
}
export const resourceEtag = (value: { version: number }) =>
  `"v${value.version}"`;
const project = (r: Row): CourseResource => {
  const common = {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    sectionId: r.section_id,
    visibility: r.visibility,
    position: r.position,
    version: r.version,
    createdAt: r.created_at.toISOString(),
  };
  return r.kind === "link"
    ? { ...common, kind: "link", url: r.url }
    : {
        ...common,
        kind: "upload",
        fileId: r.file_id,
        fileName: r.file_name,
        mediaType: r.media_type,
        sizeBytes: Number(r.size_bytes),
        textStatus: r.text_status ?? "pending",
      };
};
export class CourseResourceService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const value = await work(db);
      await db.query("COMMIT");
      return value;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async authorize(
    db: Db,
    courseId: string,
    userId: string,
    write = false,
    allowArchived = false,
  ) {
    const found = await db.query<{ role: string; status: string }>(
      `SELECT m.role,c.status FROM courses c JOIN course_memberships m ON m.course_id=c.id JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE c.id=$1 AND m.user_id=$2${write ? " FOR UPDATE OF c,m" : ""}`,
      [courseId, userId],
    );
    const row = found.rows[0];
    if (!row || (write && row.role !== "instructor"))
      throw new AuthError(
        write ? 403 : 404,
        write ? "permission_denied" : "not_found",
        "Course access is required",
      );
    if (
      !["active", "archived"].includes(row.status) ||
      (write && row.status !== "active" && !allowArchived)
    )
      throw new AuthError(
        write ? 409 : 404,
        write ? "course_archived" : "not_found",
        "Course is not active",
      );
    return row;
  }
  private async version(db: Db, courseId: string) {
    return (
      (
        await db.query<{ version: number }>(
          "SELECT version FROM course_resource_catalogs WHERE course_id=$1",
          [courseId],
        )
      ).rows[0]?.version ?? 1
    );
  }
  private async changed(db: PoolClient, courseId: string) {
    await db.query(
      "INSERT INTO course_resource_catalogs(course_id,version) VALUES($1,2) ON CONFLICT(course_id) DO UPDATE SET version=course_resource_catalogs.version+1",
      [courseId],
    );
  }
  private match(version: number, etag?: string) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== resourceEtag({ version }))
      throw new AuthError(412, "version_conflict", "Resource has changed");
  }
  async sections(
    courseId: string,
    userId: string,
    db?: Db,
  ): Promise<{ data: Section[]; version: number }> {
    if (!db)
      return this.tx(async (client) => {
        await client.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        return this.sections(courseId, userId, client);
      });
    await this.authorize(db, courseId, userId);
    const found = await db.query<{
      id: string;
      course_id: string;
      title: string;
      visibility: "class" | "staff";
      position: number;
      version: number;
    }>(
      "SELECT s.* FROM course_resource_sections s JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2 JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN courses c ON c.id=s.course_id AND c.status IN ('active','archived') WHERE s.course_id=$1 AND (m.role IN ('ta','instructor') OR s.visibility='class') ORDER BY s.position,s.id",
      [courseId, userId],
    );
    return {
      data: found.rows.map((r) => ({
        id: r.id,
        courseId: r.course_id,
        title: r.title,
        visibility: r.visibility,
        position: r.position,
        version: r.version,
      })),
      version: await this.version(db, courseId),
    };
  }
  async createSection(
    courseId: string,
    userId: string,
    input: { title: unknown; visibility?: unknown },
  ) {
    const name = title(input.title),
      access = visibility(input.visibility);
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const id = uuid();
      const row = await db.query<{ position: number }>(
        "SELECT COALESCE(MAX(position)+1,0) position FROM course_resource_sections WHERE course_id=$1",
        [courseId],
      );
      await db.query(
        "INSERT INTO course_resource_sections(id,course_id,title,visibility,position) VALUES($1,$2,$3,$4,$5)",
        [id, courseId, name, access, row.rows[0]!.position],
      );
      await this.changed(db, courseId);
      return {
        id,
        courseId,
        title: name,
        visibility: access,
        position: row.rows[0]!.position,
        version: 1,
      };
    });
  }
  async list(
    courseId: string,
    userId: string,
    limit: number,
    cursor?: string,
    sort = "manual",
    sectionId?: string,
  ) {
    return this.tx(async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const membership = await this.authorize(db, courseId, userId);
      if (!["manual", "title", "date"].includes(sort))
        throw new AuthError(400, "invalid_request", "Sort is invalid");
      const version = await this.version(db, courseId);
      const access =
        membership.role === "ta" || membership.role === "instructor"
          ? "staff"
          : "class";
      let offset = 0;
      if (cursor) {
        try {
          const raw = Buffer.from(cursor, "base64url");
          const c = JSON.parse(raw.toString());
          if (
            raw.toString("base64url") !== cursor ||
            !Array.isArray(c) ||
            c.length !== 7 ||
            c[0] !== "catalog:v2" ||
            c[1] !== courseId ||
            c[2] !== sort ||
            c[3] !== (sectionId ?? null) ||
            c[4] !== version ||
            c[5] !== access ||
            !Number.isSafeInteger(c[6]) ||
            c[6] < 0
          )
            throw Error();
          offset = c[6];
        } catch {
          throw new AuthError(
            400,
            "invalid_request",
            "Cursor is invalid or stale",
          );
        }
      }
      if (sectionId) {
        const { data } = await this.sections(courseId, userId, db);
        if (!data.some((s) => s.id === sectionId)) throw missing();
      }
      const order =
        sort === "title"
          ? "lower(r.title),r.title,r.id"
          : sort === "date"
            ? "r.created_at DESC,r.id"
            : "COALESCE(s.position,-1),s.id,r.position,r.id";
      const found = await db.query<Row>(
        `${select} JOIN course_memberships m ON m.course_id=r.course_id AND m.user_id=$2 JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN courses c ON c.id=r.course_id AND c.status IN ('active','archived') WHERE r.course_id=$1 AND ${visible} ${sectionId ? "AND r.section_id=$5" : ""} ORDER BY ${order} LIMIT $3 OFFSET $4`,
        sectionId
          ? [courseId, userId, limit + 1, offset, sectionId]
          : [courseId, userId, limit + 1, offset],
      );
      const rows = found.rows.slice(0, limit),
        hasMore = found.rows.length > limit;
      return {
        data: rows.map(project),
        page: {
          hasMore,
          nextCursor: hasMore
            ? Buffer.from(
                JSON.stringify([
                  "catalog:v2",
                  courseId,
                  sort,
                  sectionId ?? null,
                  version,
                  access,
                  offset + rows.length,
                ]),
              ).toString("base64url")
            : null,
        },
        version,
      };
    });
  }
  /**
   * Ranks visible resources by title (including close misspellings) and the
   * ready extracted text of each resource's current file. Visibility is
   * applied before ranking and pagination so hidden resources never affect
   * results or `hasMore`.
   */
  async search(
    courseId: string,
    userId: string,
    input: { q: string; limit?: number; cursor?: string },
  ): Promise<{
    data: { resource: CourseResource; match: ResourceSearchMatch }[];
    page: { hasMore: boolean; nextCursor: string | null };
  }> {
    const badRequest = (message: string) =>
      new AuthError(400, "invalid_request", message);
    const q = input.q.trim().replace(/\s+/g, " ");
    if (!q || [...q].length > 200 || q.includes("\0"))
      throw badRequest("Search query must be 1-200 characters");
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw badRequest("Limit must be between 1 and 50");
    return this.tx(async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const membership = await this.authorize(db, courseId, userId);
      const access =
        membership.role === "ta" || membership.role === "instructor"
          ? "staff"
          : "class";
      let offset = 0;
      if (input.cursor !== undefined) {
        try {
          const raw = Buffer.from(input.cursor, "base64url");
          const c = JSON.parse(raw.toString());
          if (
            input.cursor.length > 2048 ||
            raw.toString("base64url") !== input.cursor ||
            !Array.isArray(c) ||
            c.length !== 5 ||
            c[0] !== "resource-search:v1" ||
            c[1] !== courseId ||
            c[2] !== q ||
            c[3] !== access ||
            !Number.isSafeInteger(c[4]) ||
            c[4] < 1
          )
            throw Error();
          offset = c[4];
        } catch {
          throw badRequest("Cursor is invalid or stale");
        }
      }
      const fuzzyTerms = /["“”]|\bOR\b|(^|\s)-\S/i.test(q)
        ? []
        : (q.match(/[\p{L}\p{N}]+/gu) ?? []).filter(
            (term) => [...term].length >= 3,
          );
      const found = await db.query<
        Row & { in_title: boolean; text_match: boolean }
      >(
        `WITH query AS (SELECT websearch_to_tsquery('english',$3) q),
         terms AS (
           SELECT DISTINCT lower(input.term) term FROM unnest($6::text[]) AS input(term)
           WHERE to_tsvector('english',input.term) <> ''::tsvector
         ),
         text_hits AS MATERIALIZED (
           SELECT file_id FROM course_file_texts
           WHERE course_id=$1 AND search_vector @@ websearch_to_tsquery('english',$3)
         ),
         candidates AS (
           SELECT r.*,v.kind,v.url,v.file_id,f.file_name,f.media_type,f.size_bytes,t.status text_status,
             to_tsvector('english',r.title) @@ query.q title_lexical,
             hit.file_id IS NOT NULL text_match,
             COALESCE((SELECT min(public.strict_word_similarity(terms.term,lower(r.title))) FROM terms),0) fuzzy,
             ts_rank_cd(to_tsvector('english',r.title),query.q) title_rank,
             CASE WHEN hit.file_id IS NULL THEN 0 ELSE ts_rank_cd(t.search_vector,query.q) END text_rank
           FROM course_resources r
           JOIN course_resource_revisions v ON v.id=r.active_revision_id
           LEFT JOIN course_files f ON f.id=v.file_id
           LEFT JOIN course_file_texts t ON t.file_id=v.file_id
           LEFT JOIN text_hits hit ON hit.file_id=t.file_id
           LEFT JOIN course_resource_sections s ON s.id=r.section_id
           JOIN course_memberships m ON m.course_id=r.course_id AND m.user_id=$2
           JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
           JOIN courses c ON c.id=r.course_id AND c.status IN ('active','archived')
           CROSS JOIN query
           WHERE r.course_id=$1 AND ${visible}
         )
         SELECT *,(title_lexical OR fuzzy>=0.5) in_title FROM candidates
         WHERE title_lexical OR text_match OR fuzzy>=0.5
         ORDER BY (title_lexical OR fuzzy>=0.5) DESC,title_rank*2+text_rank+fuzzy DESC,id
         LIMIT $4 OFFSET $5`,
        [courseId, userId, q, limit + 1, offset, fuzzyTerms],
      );
      const rows = found.rows.slice(0, limit),
        hasMore = found.rows.length > limit;
      const matchedFiles = rows
        .filter((row) => row.text_match)
        .map((row) => row.file_id);
      const headlines = new Map<string, string>();
      if (matchedFiles.length)
        for (const row of (
          await db.query<{ file_id: string; headline: string }>(
            `SELECT file_id,ts_headline('english',translate(text,'<>',U&'\\E000\\E001'),websearch_to_tsquery('english',$2),
               format('StartSel=%s, StopSel=%s, MaxFragments=1, MaxWords=35, MinWords=15, ShortWord=2, FragmentDelimiter=" ... "',$3::text,$4::text)) headline
             FROM course_file_texts WHERE file_id=ANY($1::uuid[]) AND status='ready'`,
            [matchedFiles, q, HIGHLIGHT_START, HIGHLIGHT_STOP],
          )
        ).rows)
          headlines.set(row.file_id, row.headline);
      return {
        data: rows.map((row) => {
          const headline = row.text_match
            ? headlines.get(row.file_id)
            : undefined;
          return {
            resource: project(row),
            match: {
              inTitle: row.in_title,
              snippet: headline === undefined ? null : toSnippet(headline),
            },
          };
        }),
        page: {
          hasMore,
          nextCursor: hasMore
            ? Buffer.from(
                JSON.stringify([
                  "resource-search:v1",
                  courseId,
                  q,
                  access,
                  offset + rows.length,
                ]),
              ).toString("base64url")
            : null,
        },
      };
    });
  }
  async read(
    courseId: string,
    resourceId: string,
    userId: string,
    db: Db = this.pool,
  ) {
    await this.authorize(db, courseId, userId);
    const rows = await db.query<Row>(
      `${select} JOIN course_memberships m ON m.course_id=r.course_id AND m.user_id=$3 JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN courses c ON c.id=r.course_id AND c.status IN ('active','archived') WHERE r.course_id=$1 AND r.id=$2 AND ${visible}`,
      [courseId, resourceId, userId],
    );
    if (!rows.rows[0]) throw missing();
    return project(rows.rows[0]);
  }
  private async section(db: Db, courseId: string, value: unknown) {
    if (value === undefined || value === null) return null;
    const id = validSectionId(value);
    const row = await db.query(
      "SELECT 1 FROM course_resource_sections WHERE course_id=$1 AND id=$2",
      [courseId, id],
    );
    if (!row.rowCount) throw missing();
    return id;
  }
  async create(
    courseId: string,
    userId: string,
    input: {
      title: unknown;
      url: unknown;
      sectionId?: unknown;
      visibility?: unknown;
    },
    key?: string,
  ): Promise<CourseResource> {
    const name = title(input.title),
      url = link(input.url),
      access = visibility(input.visibility);
    if (key !== undefined && (!key.length || key.length > 255))
      throw invalid("Idempotency-Key is invalid");
    const scope = `course-resource-link-create:${userId}:${courseId}`,
      hash = createHash("sha256")
        .update(
          JSON.stringify(
            access === "class" && input.sectionId == null
              ? { title: name, url }
              : {
                  title: name,
                  url,
                  visibility: access,
                  sectionId: input.sectionId ?? null,
                },
          ),
        )
        .digest();
    return this.tx(async (db) => {
      const status = await this.authorize(db, courseId, userId, true, !!key);
      if (key) {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const old = await db.query<{
          request_hash: Buffer;
          response_body: CourseResource;
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
          try {
            await this.read(courseId, old.rows[0].response_body.id, userId, db);
          } catch (e) {
            if (e instanceof AuthError && e.status === 404)
              throw new AuthError(
                409,
                "idempotency_key_reused",
                "Idempotency key refers to an unavailable resource",
              );
            throw e;
          }
          return old.rows[0].response_body;
        }
      }
      if (status.status !== "active")
        throw new AuthError(409, "course_archived", "Course is archived");
      const section = await this.section(db, courseId, input.sectionId),
        id = uuid(),
        revision = uuid();
      await db.query(
        "INSERT INTO course_resources(id,course_id,section_id,title,visibility,position,active_revision_id) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position)+1,0) FROM course_resources WHERE course_id=$2 AND section_id IS NOT DISTINCT FROM $3),$6)",
        [id, courseId, section, name, access, revision],
      );
      await db.query(
        "INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,url) VALUES($1,$2,$3,'link',$4)",
        [revision, id, courseId, url],
      );
      await this.changed(db, courseId);
      const value = await this.read(courseId, id, userId, db);
      if (key)
        await db.query(
          "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,201,$4,now()+interval '24 hours') ON CONFLICT(scope,key) DO UPDATE SET request_hash=$3,response_body=$4,response_status=201,expires_at=now()+interval '24 hours'",
          [scope, key, hash, value],
        );
      return value;
    });
  }
  async updateSection(
    courseId: string,
    userId: string,
    id: string,
    input: { title?: unknown; visibility?: unknown },
    etag?: string,
  ) {
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const rows = await db.query<{
        id: string;
        title: string;
        visibility: "class" | "staff";
        position: number;
        version: number;
      }>(
        "SELECT * FROM course_resource_sections WHERE course_id=$1 AND id=$2 FOR UPDATE",
        [courseId, id],
      );
      const row = rows.rows[0];
      if (!row) throw missing();
      this.match(row.version, etag);
      const name = input.title === undefined ? row.title : title(input.title),
        access =
          input.visibility === undefined
            ? row.visibility
            : visibility(input.visibility);
      await db.query(
        "UPDATE course_resource_sections SET title=$3,visibility=$4,version=version+1 WHERE course_id=$1 AND id=$2",
        [courseId, id, name, access],
      );
      await this.changed(db, courseId);
      return {
        id,
        courseId,
        title: name,
        visibility: access,
        position: row.position,
        version: row.version + 1,
      };
    });
  }
  async deleteSection(
    courseId: string,
    userId: string,
    id: string,
    etag?: string,
  ) {
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const rows = await db.query<{ visibility: string; version: number }>(
        "SELECT visibility,version FROM course_resource_sections WHERE course_id=$1 AND id=$2 FOR UPDATE",
        [courseId, id],
      );
      const row = rows.rows[0];
      if (!row) throw missing();
      this.match(row.version, etag);
      await db.query(
        "UPDATE course_resources SET section_id=NULL,visibility=CASE WHEN $3='staff' THEN 'staff' ELSE visibility END,version=version+1 WHERE course_id=$1 AND section_id=$2",
        [courseId, id, row.visibility],
      );
      await db.query("DELETE FROM course_resource_sections WHERE id=$1", [id]);
      await this.changed(db, courseId);
    });
  }
  private async retire(
    db: PoolClient,
    courseId: string,
    fileId: string | undefined,
  ) {
    if (!fileId) return;
    const f = await db.query<{ object_key: string }>(
      "SELECT object_key FROM course_files WHERE course_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
      [courseId, fileId],
    );
    if (!f.rows[0]) return;
    const refs = await db.query(
      "SELECT 1 FROM course_resources r JOIN course_resource_revisions v ON v.id=r.active_revision_id WHERE r.deleted_at IS NULL AND v.file_id=$1",
      [fileId],
    );
    if (refs.rowCount) return;
    await db.query(
      "UPDATE course_files SET deleted_at=clock_timestamp() WHERE id=$1",
      [fileId],
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload,deduplication_key) VALUES($1,'delete_course_file',$2,$3) ON CONFLICT(kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
      [
        uuid(),
        { courseId, fileId, objectKey: f.rows[0].object_key },
        `file-delete:${fileId}`,
      ],
    );
  }
  async update(
    courseId: string,
    userId: string,
    id: string,
    input: {
      title?: unknown;
      visibility?: unknown;
      sectionId?: unknown;
      url?: unknown;
    },
    etag?: string,
  ) {
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const current = await this.read(courseId, id, userId, db);
      this.match(current.version, etag);
      const name =
          input.title === undefined ? current.title : title(input.title),
        access =
          input.visibility === undefined
            ? current.visibility
            : visibility(input.visibility),
        section =
          input.sectionId === undefined
            ? current.sectionId
            : await this.section(db, courseId, input.sectionId);
      let revision: string | undefined;
      if (input.url !== undefined) {
        const url = link(input.url);
        revision = uuid();
        await db.query(
          "INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,url) VALUES($1,$2,$3,'link',$4)",
          [revision, id, courseId, url],
        );
      }
      await db.query(
        "UPDATE course_resources SET title=$3,visibility=$4,section_id=$5,active_revision_id=COALESCE($6,active_revision_id),version=version+1 WHERE course_id=$1 AND id=$2",
        [courseId, id, name, access, section, revision ?? null],
      );
      if (revision && current.kind === "upload")
        await this.retire(db, courseId, current.fileId);
      await this.changed(db, courseId);
      return this.read(courseId, id, userId, db);
    });
  }
  async delete(courseId: string, userId: string, id: string, etag?: string) {
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      const current = await this.read(courseId, id, userId, db);
      this.match(current.version, etag);
      await db.query(
        "UPDATE course_resources SET deleted_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [id],
      );
      if (current.kind === "upload")
        await this.retire(db, courseId, current.fileId);
      await this.changed(db, courseId);
    });
  }
  async reorder(
    courseId: string,
    userId: string,
    ids: unknown,
    etag: string | undefined,
    sectionId?: unknown,
  ) {
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw invalid();
    return this.tx(async (db) => {
      await this.authorize(db, courseId, userId, true);
      this.match(await this.version(db, courseId), etag);
      const table =
        sectionId === undefined
          ? "course_resource_sections"
          : "course_resources";
      const section =
        sectionId === undefined
          ? undefined
          : await this.section(db, courseId, sectionId);
      const found = await db.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE course_id=$1 ${section === undefined ? "" : "AND section_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL"}`,
        section === undefined ? [courseId] : [courseId, section],
      );
      if (
        found.rows.length !== ids.length ||
        found.rows.some((row) => !ids.includes(row.id))
      )
        throw invalid("Supply the complete current order");
      for (const [position, id] of ids.entries())
        await db.query(
          `UPDATE ${table} SET position=$2,version=version+1 WHERE id=$1`,
          [id, position],
        );
      await this.changed(db, courseId);
      return { version: await this.version(db, courseId) };
    });
  }

  async authorizeUpload(courseId: string, userId: string, key?: string) {
    await this.authorize(this.pool, courseId, userId, true, !!key);
  }
  async upload(
    courseId: string,
    userId: string,
    upload: NewUpload,
    input: { title?: unknown; visibility?: unknown; sectionId?: unknown },
    files: CourseFileService,
    key?: string,
    id?: string,
    etag?: string,
  ) {
    const name =
        input.title === undefined && id
          ? undefined
          : title(input.title === undefined ? upload.fileName : input.title),
      access =
        input.visibility === undefined && id
          ? undefined
          : visibility(input.visibility),
      sectionInput =
        input.sectionId === undefined && id
          ? undefined
          : input.sectionId === ""
            ? null
            : (input.sectionId ?? null);
    await this.authorizeUpload(courseId, userId, key);
    if (sectionInput !== undefined && sectionInput !== null)
      validSectionId(sectionInput);
    const responseScope = `catalog-upload-response:${userId}:${courseId}`,
      context = {
        id: id ?? null,
        etag: id ? (etag ?? null) : null,
        title: name,
        visibility: access,
        sectionId: sectionInput,
      };
    let value: CourseResource | undefined;
    const file = await files.create(
      courseId,
      userId,
      upload,
      key,
      async (db, file) => {
        await this.authorize(db, courseId, userId, true);
        let current: CourseResource | undefined;
        if (id) {
          current = await this.read(courseId, id, userId, db);
          this.match(current.version, etag);
        }
        const effectiveName = name ?? current!.title,
          effectiveAccess = access ?? current!.visibility,
          section =
            sectionInput === undefined
              ? current!.sectionId
              : await this.section(db, courseId, sectionInput),
          revision = uuid();
        if (id) {
          await db.query(
            "UPDATE course_resources SET title=$3,visibility=$4,section_id=$5,active_revision_id=$6,version=version+1 WHERE course_id=$1 AND id=$2",
            [courseId, id, effectiveName, effectiveAccess, section, revision],
          );
        } else
          await db.query(
            "INSERT INTO course_resources(id,course_id,section_id,title,visibility,position,active_revision_id) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position)+1,0) FROM course_resources WHERE course_id=$2 AND section_id IS NOT DISTINCT FROM $3),$6)",
            [
              file.id,
              courseId,
              section,
              effectiveName,
              effectiveAccess,
              revision,
            ],
          );
        await db.query(
          "INSERT INTO course_resource_revisions(id,resource_id,course_id,kind,file_id) VALUES($1,$2,$3,'upload',$4)",
          [revision, id ?? file.id, courseId, file.id],
        );
        await queueFileTextExtraction(db, courseId, file.id);
        if (current?.kind === "upload")
          await this.retire(db, courseId, current.fileId);
        await this.changed(db, courseId);
        value = await this.read(courseId, id ?? file.id, userId, db);
        if (key)
          await db.query(
            "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours') ON CONFLICT(scope,key) DO UPDATE SET request_hash=$3,response_status=$4,response_body=$5,expires_at=now()+interval '24 hours'",
            [
              responseScope,
              key,
              createHash("sha256").update(JSON.stringify(context)).digest(),
              id ? 200 : 201,
              value,
            ],
          );
      },
      { scopePrefix: "catalog-upload", requestContext: context },
    );
    if (value) return value;
    const saved = await this.pool.query<{ response_body: CourseResource }>(
      "SELECT response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
      [responseScope, key],
    );
    const replay = saved.rows[0]?.response_body;
    if (!replay)
      throw new AuthError(
        409,
        "idempotency_key_reused",
        "Upload response is no longer available",
      );
    await this.read(courseId, replay.id, userId);
    if (replay.kind !== "upload" || replay.fileId !== file.id)
      throw new AuthError(
        409,
        "idempotency_key_reused",
        "Upload is no longer current",
      );
    return replay;
  }
}
