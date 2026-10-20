import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import { consumeRateLimit } from "../database/rate-limit.js";

export const COLLABORATION_LANGUAGES = [
  "plaintext",
  "python",
  "java",
  "c",
  "cpp",
  "javascript",
  "typescript",
  "sql",
] as const;
export type CollaborationLanguage = (typeof COLLABORATION_LANGUAGES)[number];
export const COLLABORATION_EVENTS_CHANNEL = "collaboration_events";
export const documentName = (sessionId: string) =>
  `collaboration-session:${sessionId}`;
export const TICKET_LIFETIME_MS = 5 * 60 * 1000;

type Role = "student" | "ta" | "instructor";
type Db = Pool | PoolClient;
const STAFF = new Set<Role>(["ta", "instructor"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CollaborationEvent =
  | { type: "session_ending"; sessionId: string }
  | { type: "session_ended"; sessionId: string }
  | { type: "session_updated"; sessionId: string }
  | {
      type: "access_changed";
      sessionId?: string;
      courseId?: string;
      userIds: string[];
    };

export type CollaborationParticipant = {
  userId: string;
  displayName: string;
  role: "creator" | "invitee";
};
export type CollaborationSession = {
  id: string;
  courseId: string;
  status: "active" | "ended";
  anchor: { postId: string };
  title: string;
  language: CollaborationLanguage;
  createdBy: string;
  participants: CollaborationParticipant[];
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type CreateCollaborationSession = {
  postId: string;
  title?: string;
  language?: CollaborationLanguage;
};
export type UpdateCollaborationSession =
  { title?: string; language?: CollaborationLanguage } | { status: "ended" };
export type ListCollaborationSessions = {
  status?: "active" | "ended";
  anchorId?: string;
  cursor?: string;
  limit: number;
};

type SessionRow = {
  id: string;
  course_id: string;
  post_id: string;
  title: string;
  language: CollaborationLanguage;
  lifecycle_state: "active" | "ending" | "ended";
  created_by_user_id: string;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: string;
};
type Access = { row: SessionRow; role: Role; courseStatus: string };

export const collaborationEtag = (session: { version: number }) =>
  `"v${session.version}"`;
const notFound = () =>
  new AuthError(404, "not_found", "Collaboration session is not found");
const forbidden = () =>
  new AuthError(
    403,
    "forbidden",
    "Only the session creator or course staff may do this",
  );
const ended = () =>
  new AuthError(409, "session_ended", "The collaboration session has ended");
const archived = () =>
  new AuthError(409, "course_archived", "Course is not active");
const invalidRequest = (message: string) =>
  new AuthError(400, "invalid_request", message);

export type CollaborationSessionServiceOptions = {
  webSocketUrl: string;
  /** How long ending waits for the collaboration server to persist the final text. */
  endTimeoutMs?: number;
  endPollMs?: number;
  /** Per-user limits: sessions created per hour and tickets per 10 minutes. */
  rateLimits?: { createPerHour: number; ticketsPerTenMinutes: number };
};

export class CollaborationSessionService {
  private readonly endTimeoutMs: number;
  private readonly endPollMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly options: CollaborationSessionServiceOptions,
  ) {
    this.endTimeoutMs = options.endTimeoutMs ?? 5000;
    this.endPollMs = options.endPollMs ?? 100;
  }

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

  static async notify(db: Db, event: CollaborationEvent) {
    await db.query("SELECT pg_notify($1, $2)", [
      COLLABORATION_EVENTS_CHANNEL,
      JSON.stringify(event),
    ]);
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
    return result.rows[0];
  }

  /**
   * Loads a session the caller may see: its creator, current course staff, or
   * a current invitee. Sessions on removed posts are visible to staff only.
   * Anything else is reported as not found.
   */
  private async access(
    db: Db,
    sessionId: string,
    userId: string,
    lock = false,
  ): Promise<Access> {
    if (!UUID_PATTERN.test(sessionId)) throw notFound();
    const result = await db.query<SessionRow>(
      `SELECT * FROM collaboration_sessions WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    const member = await this.membership(db, row.course_id, userId, lock);
    if (!member) throw notFound();
    const staff = STAFF.has(member.role);
    if (!staff) {
      const post = await db.query<{ removed: boolean }>(
        "SELECT (deleted_at IS NOT NULL OR duplicate_status='confirmed') AS removed FROM posts WHERE id=$1",
        [row.post_id],
      );
      if (post.rows[0]?.removed) throw notFound();
      if (row.created_by_user_id !== userId) {
        const invited = await db.query(
          "SELECT 1 FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2",
          [row.id, userId],
        );
        if (!invited.rowCount) throw notFound();
      }
    }
    return { row, role: member.role, courseStatus: member.status };
  }

  private manager(access: Access, userId: string) {
    if (!STAFF.has(access.role) && access.row.created_by_user_id !== userId)
      throw forbidden();
  }

  private active(access: Access) {
    if (access.courseStatus !== "active") throw archived();
    if (access.row.lifecycle_state !== "active") throw ended();
  }

  private async project(
    db: Db,
    row: SessionRow,
  ): Promise<CollaborationSession> {
    const participants = await db.query<{
      user_id: string;
      display_name: string;
    }>(
      "SELECT p.user_id,u.display_name FROM collaboration_participants p JOIN users u ON u.id=p.user_id WHERE p.collaboration_session_id=$1 ORDER BY (p.user_id=$2) DESC,p.created_at,p.user_id",
      [row.id, row.created_by_user_id],
    );
    return {
      id: row.id,
      courseId: row.course_id,
      status: row.lifecycle_state === "ended" ? "ended" : "active",
      anchor: { postId: row.post_id },
      title: row.title,
      language: row.language,
      createdBy: row.created_by_user_id,
      participants: participants.rows.map((participant) => ({
        userId: participant.user_id,
        displayName: participant.display_name,
        role:
          participant.user_id === row.created_by_user_id
            ? "creator"
            : "invitee",
      })),
      endedAt: row.ended_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
    };
  }

  private async reload(db: Db, sessionId: string) {
    const result = await db.query<SessionRow>(
      "SELECT * FROM collaboration_sessions WHERE id=$1",
      [sessionId],
    );
    return result.rows[0]!;
  }

  private async touch(db: Db, sessionId: string) {
    await db.query(
      "UPDATE collaboration_sessions SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [sessionId],
    );
  }

  async create(
    courseId: string,
    userId: string,
    body: CreateCollaborationSession,
    key?: string,
  ): Promise<{ value: CollaborationSession; status: number }> {
    if (key !== undefined && (key.length < 1 || key.length > 255))
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is invalid",
      );
    if (!UUID_PATTERN.test(courseId)) throw notFound();
    const scope = `collaboration-session-create:${userId}:${courseId}`;
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    return this.tx(async (db) => {
      const member = await this.membership(db, courseId, userId, true);
      if (!member) throw notFound();
      if (key !== undefined) {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [scope, key],
        );
        const old = await db.query<{
          request_hash: Buffer;
          response_body: CollaborationSession;
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
          const current = await db.query<SessionRow>(
            "SELECT * FROM collaboration_sessions WHERE id=$1",
            [old.rows[0].response_body.id],
          );
          if (!current.rows[0]) throw notFound();
          return {
            value: await this.project(db, current.rows[0]),
            status: old.rows[0].response_status,
          };
        }
        await db.query(
          "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
          [scope, key],
        );
      }
      if (member.status !== "active") throw archived();
      const post = UUID_PATTERN.test(body.postId)
        ? await db.query<{ title: string }>(
            "SELECT title FROM posts WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL AND duplicate_status<>'confirmed' FOR SHARE",
            [body.postId, courseId],
          )
        : undefined;
      if (!post?.rows[0])
        throw new AuthError(
          422,
          "cross_course_anchor",
          "The anchor is invalid or belongs to another course",
        );
      const title =
        body.title ?? post.rows[0].title.trim().slice(0, 120).trim();
      // After the idempotent replay check, so a replay is never limited.
      await consumeRateLimit(
        db,
        "collaboration-create",
        userId,
        this.options.rateLimits?.createPerHour ?? 30,
        3600,
      );
      const id = uuidv7();
      await db.query(
        "INSERT INTO collaboration_sessions (id,course_id,post_id,title,language,created_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp())",
        [
          id,
          courseId,
          body.postId,
          title,
          body.language ?? "plaintext",
          userId,
        ],
      );
      await db.query(
        "INSERT INTO collaboration_participants (collaboration_session_id,course_id,user_id,invited_by_user_id) VALUES ($1,$2,$3,$3)",
        [id, courseId, userId],
      );
      const value = await this.project(db, await this.reload(db, id));
      if (key !== undefined)
        await db.query(
          "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
          [scope, key, hash, value],
        );
      return { value, status: 201 };
    });
  }

  private cursorFor(
    courseId: string,
    userId: string,
    filters: string,
    row: { created_at: Date; id: string },
  ) {
    return Buffer.from(
      JSON.stringify({
        c: courseId,
        u: userId,
        f: filters,
        t: row.created_at.toISOString(),
        i: row.id,
      }),
    ).toString("base64url");
  }

  async list(
    courseId: string,
    userId: string,
    query: ListCollaborationSessions,
  ) {
    if (!UUID_PATTERN.test(courseId)) throw notFound();
    const member = await this.membership(this.pool, courseId, userId);
    if (!member) throw notFound();
    const staff = STAFF.has(member.role);
    const filters = JSON.stringify([
      query.status ?? null,
      query.anchorId ?? null,
    ]);
    const values: unknown[] = [courseId, userId, staff];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const clauses = [
      "s.course_id=$1",
      "($3 OR s.created_by_user_id=$2 OR EXISTS (SELECT 1 FROM collaboration_participants cp WHERE cp.collaboration_session_id=s.id AND cp.user_id=$2))",
      "($3 OR (p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'))",
    ];
    if (query.status === "ended") clauses.push("s.lifecycle_state='ended'");
    if (query.status === "active") clauses.push("s.lifecycle_state<>'ended'");
    if (query.anchorId) {
      if (!UUID_PATTERN.test(query.anchorId))
        return { data: [], page: { nextCursor: null, hasMore: false } };
      clauses.push(`s.post_id=${add(query.anchorId)}`);
    }
    if (query.cursor) {
      let decoded: {
        c?: string;
        u?: string;
        f?: string;
        t?: string;
        i?: string;
      };
      try {
        decoded = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw invalidRequest("Pagination cursor is invalid");
      }
      if (
        decoded.c !== courseId ||
        decoded.u !== userId ||
        decoded.f !== filters ||
        typeof decoded.t !== "string" ||
        Number.isNaN(Date.parse(decoded.t)) ||
        typeof decoded.i !== "string" ||
        !UUID_PATTERN.test(decoded.i)
      )
        throw invalidRequest("Pagination cursor is invalid");
      clauses.push(
        `(s.created_at,s.id)<(${add(decoded.t)}::timestamptz,${add(decoded.i)}::uuid)`,
      );
    }
    const rows = await this.pool.query<SessionRow>(
      `SELECT s.* FROM collaboration_sessions s JOIN posts p ON p.id=s.post_id WHERE ${clauses.join(" AND ")} ORDER BY s.created_at DESC,s.id DESC LIMIT ${add(query.limit + 1)}`,
      values,
    );
    const hasMore = rows.rows.length > query.limit;
    const page = rows.rows.slice(0, query.limit);
    const data = [];
    for (const row of page) data.push(await this.project(this.pool, row));
    return {
      data,
      page: {
        nextCursor: hasMore
          ? this.cursorFor(courseId, userId, filters, page.at(-1)!)
          : null,
        hasMore,
      },
    };
  }

  /** The viewer's own sessions across their active courses, newest first. */
  async listForUser(
    userId: string,
    query: Omit<ListCollaborationSessions, "anchorId">,
  ) {
    // Cursors carry this scope so a course-list cursor cannot be replayed here.
    const scope = "me";
    const filters = JSON.stringify([query.status ?? null]);
    const values: unknown[] = [userId];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const clauses = ["p.deleted_at IS NULL", "p.duplicate_status<>'confirmed'"];
    if (query.status === "ended") clauses.push("s.lifecycle_state='ended'");
    if (query.status === "active") clauses.push("s.lifecycle_state<>'ended'");
    if (query.cursor) {
      let decoded: {
        c?: string;
        u?: string;
        f?: string;
        t?: string;
        i?: string;
      };
      try {
        decoded = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw invalidRequest("Pagination cursor is invalid");
      }
      if (
        decoded.c !== scope ||
        decoded.u !== userId ||
        decoded.f !== filters ||
        typeof decoded.t !== "string" ||
        Number.isNaN(Date.parse(decoded.t)) ||
        typeof decoded.i !== "string" ||
        !UUID_PATTERN.test(decoded.i)
      )
        throw invalidRequest("Pagination cursor is invalid");
      clauses.push(
        `(s.created_at,s.id)<(${add(decoded.t)}::timestamptz,${add(decoded.i)}::uuid)`,
      );
    }
    // The creator always has a participant row, so one join covers both roles.
    const rows = await this.pool.query<SessionRow & { course_name: string }>(
      `SELECT s.*,c.name AS course_name
       FROM collaboration_participants cp
       JOIN collaboration_sessions s ON s.id=cp.collaboration_session_id
       JOIN courses c ON c.id=s.course_id AND c.status='active'
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$1
       JOIN posts p ON p.id=s.post_id
       WHERE cp.user_id=$1 AND ${clauses.join(" AND ")}
       ORDER BY s.created_at DESC,s.id DESC LIMIT ${add(query.limit + 1)}`,
      values,
    );
    const hasMore = rows.rows.length > query.limit;
    const page = rows.rows.slice(0, query.limit);
    const data = [];
    for (const row of page)
      data.push({
        ...(await this.project(this.pool, row)),
        courseName: row.course_name,
      });
    return {
      data,
      page: {
        nextCursor: hasMore
          ? this.cursorFor(scope, userId, filters, page.at(-1)!)
          : null,
        hasMore,
      },
    };
  }

  async get(sessionId: string, userId: string) {
    const access = await this.access(this.pool, sessionId, userId);
    return this.project(this.pool, access.row);
  }

  private checkRevision(row: SessionRow, etag: string | undefined) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== collaborationEtag({ version: Number(row.version) }))
      throw new AuthError(
        412,
        "version_conflict",
        "The collaboration session has changed",
      );
  }

  async update(
    sessionId: string,
    userId: string,
    etag: string | undefined,
    body: UpdateCollaborationSession,
  ): Promise<CollaborationSession> {
    if ("status" in body) return this.end(sessionId, userId, etag);
    return this.tx(async (db) => {
      const access = await this.access(db, sessionId, userId, true);
      this.manager(access, userId);
      this.checkRevision(access.row, etag);
      this.active(access);
      await db.query(
        "UPDATE collaboration_sessions SET title=coalesce($2,title),language=coalesce($3,language),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [sessionId, body.title ?? null, body.language ?? null],
      );
      await CollaborationSessionService.notify(db, {
        type: "session_updated",
        sessionId,
      });
      return this.project(db, await this.reload(db, sessionId));
    });
  }

  /**
   * Marks the session ending so the collaboration server persists the final
   * text, waits for it to confirm, then completes the end itself if needed.
   */
  private async end(
    sessionId: string,
    userId: string,
    etag: string | undefined,
  ) {
    await this.tx(async (db) => {
      const access = await this.access(db, sessionId, userId, true);
      this.manager(access, userId);
      this.checkRevision(access.row, etag);
      if (access.row.lifecycle_state !== "active") throw ended();
      await db.query(
        "UPDATE collaboration_sessions SET lifecycle_state='ending',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [sessionId],
      );
      await CollaborationSessionService.notify(db, {
        type: "session_ending",
        sessionId,
      });
    });
    const deadline = Date.now() + this.endTimeoutMs;
    while (Date.now() < deadline) {
      const state = await this.pool.query<{ lifecycle_state: string }>(
        "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1",
        [sessionId],
      );
      if (state.rows[0]?.lifecycle_state !== "ending") break;
      await new Promise((resolve) => setTimeout(resolve, this.endPollMs));
    }
    await CollaborationSessionService.finishEnding(this.pool, sessionId);
    return this.project(this.pool, await this.reload(this.pool, sessionId));
  }

  /** Completes an end that the collaboration server did not confirm. */
  static async finishEnding(db: Db, sessionId: string) {
    const result = await db.query(
      "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle_state='ending'",
      [sessionId],
    );
    if (result.rowCount)
      await CollaborationSessionService.notify(db, {
        type: "session_ended",
        sessionId,
      });
  }

  async invite(sessionId: string, userId: string, targetUserId: string) {
    return this.tx(async (db) => {
      const access = await this.access(db, sessionId, userId, true);
      this.manager(access, userId);
      this.active(access);
      const target = UUID_PATTERN.test(targetUserId)
        ? await this.membership(db, access.row.course_id, targetUserId, true)
        : undefined;
      if (!target)
        throw new AuthError(
          422,
          "not_course_member",
          "The user is not a current member of the course",
        );
      const inserted = await db.query<{ created_at: Date }>(
        "INSERT INTO collaboration_participants (collaboration_session_id,course_id,user_id,invited_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING created_at",
        [sessionId, access.row.course_id, targetUserId, userId],
      );
      const invitation = inserted.rows[0];
      if (invitation) {
        await this.touch(db, sessionId);
        // The participant's created_at keys the email, so a new invitation
        // after a removal sends again while a retried job does not.
        await db.query(
          "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'send_collaboration_invitation_email',$2,$3) ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
          [
            uuidv7(),
            {
              sessionId,
              inviteeUserId: targetUserId,
              inviterUserId: userId,
            },
            `${sessionId}:${targetUserId}:${invitation.created_at.getTime()}`,
          ],
        );
      }
      return this.project(db, await this.reload(db, sessionId));
    });
  }

  async remove(sessionId: string, userId: string, targetUserId: string) {
    await this.tx(async (db) => {
      const access = await this.access(db, sessionId, userId, true);
      this.manager(access, userId);
      if (access.row.lifecycle_state !== "active") throw ended();
      if (targetUserId === access.row.created_by_user_id)
        throw new AuthError(
          422,
          "creator_not_removable",
          "The session creator cannot be removed",
        );
      const removed = UUID_PATTERN.test(targetUserId)
        ? await db.query(
            "DELETE FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2",
            [sessionId, targetUserId],
          )
        : undefined;
      if (!removed?.rowCount)
        throw new AuthError(
          404,
          "not_found",
          "Collaboration participant is not found",
        );
      await db.query(
        "UPDATE collaboration_connection_tickets SET revoked_at=now() WHERE collaboration_session_id=$1 AND user_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL",
        [sessionId, targetUserId],
      );
      await this.touch(db, sessionId);
      await CollaborationSessionService.notify(db, {
        type: "access_changed",
        sessionId,
        userIds: [targetUserId],
      });
    });
  }

  async ticket(sessionId: string, userId: string, authSessionId: string) {
    return this.tx(async (db) => {
      const access = await this.access(db, sessionId, userId, true);
      this.active(access);
      await consumeRateLimit(
        db,
        "collaboration-ticket",
        userId,
        this.options.rateLimits?.ticketsPerTenMinutes ?? 300,
        600,
      );
      const ticket = randomBytes(32).toString("base64url");
      const issued = await db.query<{ expires_at: Date }>(
        "INSERT INTO collaboration_connection_tickets (id,token_hash,collaboration_session_id,course_id,user_id,auth_session_id,permission,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'write',now(),now()+make_interval(secs => $7)) RETURNING expires_at",
        [
          uuidv7(),
          hashTicket(ticket),
          sessionId,
          access.row.course_id,
          userId,
          authSessionId,
          TICKET_LIFETIME_MS / 1000,
        ],
      );
      return {
        ticket,
        webSocketUrl: this.options.webSocketUrl,
        documentId: documentName(sessionId),
        expiresAt: issued.rows[0]!.expires_at.toISOString(),
      };
    });
  }

  async snapshot(sessionId: string, userId: string) {
    const access = await this.access(this.pool, sessionId, userId);
    const document = await this.pool.query<{
      text_projection: string;
      whiteboard_projection: unknown[];
      persisted_at: Date;
    }>(
      "SELECT text_projection,whiteboard_projection,persisted_at FROM collaboration_documents WHERE collaboration_session_id=$1",
      [sessionId],
    );
    return {
      collaborationSessionId: sessionId,
      documentId: documentName(sessionId),
      sessionStatus:
        access.row.lifecycle_state === "ended"
          ? ("ended" as const)
          : ("active" as const),
      content: document.rows[0]?.text_projection ?? "",
      whiteboard: document.rows[0]?.whiteboard_projection ?? [],
      persistedAt: (
        document.rows[0]?.persisted_at ?? access.row.created_at
      ).toISOString(),
      capturedAt: new Date().toISOString(),
    };
  }
}

export const hashTicket = (ticket: string) =>
  createHash("sha256").update(ticket, "utf8").digest();
