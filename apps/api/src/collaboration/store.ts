import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import * as Y from "yjs";
import { AuthError } from "../auth/errors.js";
import { previewContentUpdate } from "./update.js";

export type LiveDocumentKind = "answer" | "followup";
type Role = "student" | "ta" | "instructor";
type DocumentMeta = {
  kind: LiveDocumentKind;
  id: string;
  courseId: string;
  postId: string;
  body: string;
  version: number;
};
type SavedDocument = {
  yjs_state: Buffer;
  persistence_revision: string;
};
export type LiveDocument = {
  state: Uint8Array;
  text: string;
  version: number;
  persistenceRevision: number;
};
export type LiveTicketContext = {
  kind: LiveDocumentKind;
  documentId: string;
  userId: string;
  sessionId: string;
};
const EMPTY_UPDATE = Buffer.from([0, 0]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rank: Record<Role, number> = { student: 0, ta: 1, instructor: 2 };
const hidden = () => new AuthError(404, "not_found", "Document is not found");

export class CollaborationStore {
  constructor(private readonly pool: Pool) {}

  async listenForRevisions(
    notify: (kind: LiveDocumentKind, id: string) => void,
  ): Promise<() => Promise<void>> {
    const db = await this.pool.connect();
    const receive = (message: { channel: string; payload?: string }) => {
      if (message.channel !== "chalktalk_collaboration_revision") return;
      try {
        const value: unknown = JSON.parse(message.payload ?? "");
        if (!value || typeof value !== "object") return;
        const { kind, id } = value as { kind?: unknown; id?: unknown };
        if (
          (kind === "answer" || kind === "followup") &&
          typeof id === "string" &&
          UUID.test(id)
        )
          notify(kind, id);
      } catch {
        /* Ignore malformed notifications; reconciliation still runs. */
      }
    };
    db.on("notification", receive);
    try {
      await db.query("LISTEN chalktalk_collaboration_revision");
    } catch (error) {
      db.off("notification", receive);
      db.release();
      throw error;
    }
    return async () => {
      db.off("notification", receive);
      try {
        await db.query("UNLISTEN chalktalk_collaboration_revision");
      } finally {
        db.release();
      }
    };
  }

  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const value = await work(db);
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  private async session(db: PoolClient, userId: string, sessionId: string) {
    const user = await db.query(
      "SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
      [userId],
    );
    if (!user.rowCount)
      throw new AuthError(
        401,
        "authentication_required",
        "Session is no longer valid",
      );
    const result = await db.query(
      `SELECT 1 FROM sessions s
       WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL
         AND s.expires_at>statement_timestamp()
       FOR SHARE OF s`,
      [sessionId, userId],
    );
    if (!result.rowCount)
      throw new AuthError(
        401,
        "authentication_required",
        "Session is no longer valid",
      );
  }

  private async postRole(
    db: PoolClient,
    postId: string,
    userId: string,
    lock: boolean,
  ) {
    const result = await db.query<{
      role: Role;
      status: string;
      type: string;
      deleted_at: Date | null;
      duplicate_status: string;
    }>(
      `SELECT m.role,c.status,p.type,p.deleted_at,p.duplicate_status
       FROM posts p JOIN courses c ON c.id=p.course_id
       JOIN course_memberships m ON m.course_id=p.course_id AND m.user_id=$2
       WHERE p.id=$1${lock ? " FOR SHARE OF p,c,m" : ""}`,
      [postId, userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.deleted_at ||
      row.duplicate_status === "confirmed" ||
      row.type !== "question"
    )
      throw hidden();
    if (row.status !== "active")
      throw new AuthError(409, "course_archived", "Course is not active");
    return row.role;
  }

  private async authorized(
    db: PoolClient,
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    lock: boolean | "read",
  ): Promise<DocumentMeta> {
    if (!UUID.test(id)) throw hidden();
    if (kind === "answer") {
      const result = await db.query<{
        id: string;
        course_id: string;
        post_id: string;
        body_markdown: string | null;
        deleted_at: Date | null;
        edit_role_floor: Role;
        version: string;
      }>(
        `SELECT id,course_id,post_id,body_markdown,deleted_at,edit_role_floor,version
         FROM answers WHERE id=$1${lock === "read" ? " FOR SHARE" : lock ? " FOR UPDATE" : ""}`,
        [id],
      );
      const row = result.rows[0];
      if (!row || row.deleted_at || row.body_markdown === null) throw hidden();
      const role = await this.postRole(db, row.post_id, userId, lock !== false);
      if (rank[role] < rank[row.edit_role_floor])
        throw new AuthError(
          403,
          "permission_denied",
          "Role cannot edit this answer",
        );
      return {
        kind,
        id,
        courseId: row.course_id,
        postId: row.post_id,
        body: row.body_markdown,
        version: Number(row.version),
      };
    }
    // Followup REST editing locks its question before the followup row.
    const found = await db.query<{ post_id: string }>(
      "SELECT post_id FROM followups WHERE id=$1",
      [id],
    );
    if (!found.rows[0]) throw hidden();
    const role = await this.postRole(
      db,
      found.rows[0].post_id,
      userId,
      lock !== false,
    );
    const result = await db.query<{
      id: string;
      course_id: string;
      post_id: string;
      body_markdown: string | null;
      author_user_id: string;
      deleted_at: Date | null;
      version: string;
    }>(
      `SELECT id,course_id,post_id,body_markdown,author_user_id,deleted_at,version
       FROM followups WHERE id=$1${lock === "read" ? " FOR SHARE" : lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.deleted_at ||
      row.body_markdown === null ||
      row.post_id !== found.rows[0].post_id
    )
      throw hidden();
    if (row.author_user_id !== userId && role === "student")
      throw new AuthError(
        403,
        "permission_denied",
        "Author or staff role is required",
      );
    return {
      kind,
      id,
      courseId: row.course_id,
      postId: row.post_id,
      body: row.body_markdown,
      version: Number(row.version),
    };
  }

  async issueTicket(
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    sessionId: string,
  ): Promise<string> {
    return this.transaction(async (db) => {
      await this.session(db, userId, sessionId);
      await this.authorized(db, kind, id, userId, false);
      const token = randomBytes(32).toString("base64url");
      await db.query(
        `INSERT INTO collaboration_tickets
         (token_hash,session_id,user_id,document_type,document_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,statement_timestamp()+interval '5 minutes')`,
        [
          createHash("sha256").update(token).digest(),
          sessionId,
          userId,
          kind,
          id,
        ],
      );
      return token;
    });
  }

  async consumeTicket(
    token: string,
    kind: LiveDocumentKind,
    id: string,
  ): Promise<LiveTicketContext> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !UUID.test(id))
      throw new AuthError(401, "invalid_ticket", "Ticket is invalid");
    return this.transaction(async (db) => {
      const result = await db.query<{
        session_id: string;
        user_id: string;
        document_type: LiveDocumentKind;
        document_id: string;
        consumed_at: Date | null;
        expires_at: Date;
      }>(
        "SELECT session_id,user_id,document_type,document_id,consumed_at,expires_at FROM collaboration_tickets WHERE token_hash=$1 FOR UPDATE",
        [createHash("sha256").update(token).digest()],
      );
      const row = result.rows[0];
      if (!row || row.consumed_at || row.expires_at.getTime() <= Date.now())
        throw new AuthError(401, "invalid_ticket", "Ticket is invalid");
      if (row.document_type !== kind || row.document_id !== id)
        throw new AuthError(
          403,
          "ticket_target_mismatch",
          "Ticket is for another document",
        );
      await this.session(db, row.user_id, row.session_id);
      await this.authorized(db, kind, id, row.user_id, false);
      await db.query(
        "UPDATE collaboration_tickets SET consumed_at=statement_timestamp() WHERE token_hash=$1",
        [createHash("sha256").update(token).digest()],
      );
      return {
        kind,
        documentId: id,
        userId: row.user_id,
        sessionId: row.session_id,
      };
    });
  }

  private async document(
    db: PoolClient,
    meta: DocumentMeta,
  ): Promise<{ state: Buffer; revision: number }> {
    const table =
      meta.kind === "answer"
        ? "answer_collaboration_documents"
        : "followup_collaboration_documents";
    const key = meta.kind === "answer" ? "answer_id" : "followup_id";
    const result = await db.query<SavedDocument & { lifecycle_state?: string }>(
      `SELECT yjs_state,persistence_revision${meta.kind === "answer" ? ",lifecycle_state" : ""}
       FROM ${table} WHERE ${key}=$1 FOR UPDATE`,
      [meta.id],
    );
    const row = result.rows[0];
    if (!row || (meta.kind === "answer" && row.lifecycle_state !== "active"))
      throw hidden();
    if (!row.yjs_state.equals(EMPTY_UPDATE)) {
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, row.yjs_state);
        if (doc.getText("content").toString() !== meta.body)
          throw new AuthError(
            500,
            "integrity_error",
            "Document disagrees with Markdown",
          );
      } finally {
        doc.destroy();
      }
      return {
        state: row.yjs_state,
        revision: Number(row.persistence_revision),
      };
    }
    const doc = new Y.Doc();
    try {
      doc.getText("content").insert(0, meta.body);
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      await db.query(
        `UPDATE ${table} SET yjs_state=$2,persistence_revision=persistence_revision+1,persisted_at=statement_timestamp() WHERE ${key}=$1`,
        [meta.id, state],
      );
      return { state, revision: Number(row.persistence_revision) + 1 };
    } finally {
      doc.destroy();
    }
  }

  async load(kind: LiveDocumentKind, id: string): Promise<LiveDocument> {
    return this.transaction(async (db) => {
      if (!UUID.test(id)) throw hidden();
      const table = kind === "answer" ? "answers" : "followups";
      const result = await db.query<{
        body_markdown: string | null;
        course_id: string;
        post_id: string;
        version: string;
      }>(
        `SELECT t.body_markdown,t.course_id,t.post_id,t.version
         FROM ${table} t JOIN posts p ON p.id=t.post_id
         JOIN courses c ON c.id=t.course_id
         WHERE t.id=$1 AND t.deleted_at IS NULL AND p.deleted_at IS NULL
           AND p.duplicate_status<>'confirmed' AND c.status='active'
         FOR UPDATE OF t`,
        [id],
      );
      const row = result.rows[0];
      if (!row || row.body_markdown === null) throw hidden();
      const meta: DocumentMeta = {
        kind,
        id,
        courseId: row.course_id,
        postId: row.post_id,
        body: row.body_markdown,
        version: Number(row.version),
      };
      const saved = await this.document(db, meta);
      return {
        state: saved.state,
        text: meta.body,
        version: meta.version,
        persistenceRevision: saved.revision,
      };
    });
  }

  async loadAuthorized(
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    sessionId: string,
  ): Promise<LiveDocument> {
    return this.transaction(async (db) => {
      await this.session(db, userId, sessionId);
      const meta = await this.authorized(db, kind, id, userId, "read");
      const saved = await this.document(db, meta);
      return {
        state: saved.state,
        text: meta.body,
        version: meta.version,
        persistenceRevision: saved.revision,
      };
    });
  }

  async sendAuthorized(
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    sessionId: string,
    send: () => void,
  ): Promise<void> {
    await this.transaction(async (db) => {
      await this.session(db, userId, sessionId);
      await this.authorized(db, kind, id, userId, "read");
      send();
    });
  }

  async checkAccess(
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    await this.transaction(async (db) => {
      await this.session(db, userId, sessionId);
      await this.authorized(db, kind, id, userId, false);
    });
  }

  async applyUpdate(
    kind: LiveDocumentKind,
    id: string,
    userId: string,
    sessionId: string,
    update: Uint8Array,
  ): Promise<LiveDocument> {
    return this.transaction(async (db) => {
      await this.session(db, userId, sessionId);
      const meta = await this.authorized(db, kind, id, userId, true);
      const saved = await this.document(db, meta);
      const preview = previewContentUpdate(saved.state, update);
      const revision = saved.revision + (preview.binaryChanged ? 1 : 0);
      const version = meta.version + (preview.textChanged ? 1 : 0);
      if (preview.binaryChanged) {
        const table =
          kind === "answer"
            ? "answer_collaboration_documents"
            : "followup_collaboration_documents";
        const key = kind === "answer" ? "answer_id" : "followup_id";
        await db.query(
          `UPDATE ${table} SET yjs_state=$2,persistence_revision=$3,persisted_at=statement_timestamp() WHERE ${key}=$1`,
          [id, Buffer.from(preview.state), revision],
        );
      }
      if (preview.textChanged) {
        if (kind === "answer") {
          await db.query(
            `UPDATE answers SET body_markdown=$2,endorsed_at=NULL,endorsed_by_user_id=NULL,
             version=version+1,updated_at=statement_timestamp() WHERE id=$1`,
            [id, preview.text],
          );
          await db.query(
            "INSERT INTO answer_contributors(answer_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [id, userId],
          );
          await db.query(
            "INSERT INTO answer_contribution_events(course_id,answer_id,user_id,contributed_at) VALUES($1,$2,$3,statement_timestamp())",
            [meta.courseId, id, userId],
          );
        } else {
          await db.query(
            "UPDATE followups SET body_markdown=$2,version=version+1,updated_at=statement_timestamp() WHERE id=$1",
            [id, preview.text],
          );
        }
        await db.query(
          "UPDATE posts SET last_activity_at=statement_timestamp() WHERE id=$1",
          [meta.postId],
        );
      }
      return {
        state: preview.state,
        text: preview.text,
        version,
        persistenceRevision: revision,
      };
    });
  }
}
