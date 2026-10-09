import type { Pool, PoolClient } from "pg";
import * as Y from "yjs";

const EMPTY_UPDATE = Buffer.from([0, 0]);
const MAX_UPDATE_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;

type AnswerRow = {
  body_markdown: string | null;
  deleted_at: Date | null;
  endorsed_at: Date | null;
  version: string;
  course_status: string;
};
type DocumentRow = {
  yjs_state: Buffer;
  lifecycle_state: string;
  persistence_revision: string;
};
type LockedDocument = {
  answer: AnswerRow;
  document: DocumentRow;
  ydoc: Y.Doc;
  seeded: boolean;
};

export type AnswerDocument = {
  state: Uint8Array;
  text: string;
  answerVersion: number;
  persistenceRevision: number;
};

export class AnswerDocumentError extends Error {
  constructor(
    readonly code:
      | "not_available"
      | "integrity_error"
      | "invalid_update"
      | "invalid_content",
  ) {
    super(code);
  }
}

export class AnswerDocumentStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  private async lock(
    db: PoolClient,
    answerId: string,
  ): Promise<LockedDocument> {
    const answer = await db.query<AnswerRow>(
      `SELECT a.body_markdown,a.deleted_at,a.endorsed_at,a.version,c.status AS course_status
       FROM answers a JOIN courses c ON c.id=a.course_id WHERE a.id=$1
       FOR UPDATE OF a FOR SHARE OF c`,
      [answerId],
    );
    const row = answer.rows[0];
    if (
      !row ||
      row.deleted_at ||
      row.endorsed_at ||
      row.course_status !== "active"
    )
      throw new AnswerDocumentError("not_available");
    const document = await db.query<DocumentRow>(
      "SELECT yjs_state,lifecycle_state,persistence_revision FROM answer_collaboration_documents WHERE answer_id=$1 FOR UPDATE",
      [answerId],
    );
    const saved = document.rows[0];
    if (!saved || saved.lifecycle_state !== "active")
      throw new AnswerDocumentError("not_available");
    const ydoc = new Y.Doc();
    try {
      Y.applyUpdate(ydoc, saved.yjs_state);
    } catch {
      throw new AnswerDocumentError("integrity_error");
    }
    const seeded = saved.yjs_state.equals(EMPTY_UPDATE);
    if (seeded) {
      ydoc.getText("content").insert(0, row.body_markdown!);
    } else if (ydoc.getText("content").toString() !== row.body_markdown) {
      throw new AnswerDocumentError("integrity_error");
    }
    return { answer: row, document: saved, ydoc, seeded };
  }

  private result(
    locked: LockedDocument,
    state: Uint8Array,
    revision: number,
    answerVersion: number,
  ): AnswerDocument {
    return {
      state: Uint8Array.from(state),
      text: locked.ydoc.getText("content").toString(),
      answerVersion,
      persistenceRevision: revision,
    };
  }

  async load(answerId: string): Promise<AnswerDocument> {
    return this.transaction(async (db) => {
      const locked = await this.lock(db, answerId);
      const state = locked.seeded
        ? Buffer.from(Y.encodeStateAsUpdate(locked.ydoc))
        : locked.document.yjs_state;
      const revision =
        Number(locked.document.persistence_revision) + (locked.seeded ? 1 : 0);
      if (locked.seeded)
        await db.query(
          "UPDATE answer_collaboration_documents SET yjs_state=$2,persistence_revision=$3,persisted_at=now() WHERE answer_id=$1",
          [answerId, state, revision],
        );
      return this.result(
        locked,
        state,
        revision,
        Number(locked.answer.version),
      );
    });
  }

  async applyUpdate(
    answerId: string,
    update: Uint8Array,
  ): Promise<AnswerDocument> {
    if (
      !(update instanceof Uint8Array) ||
      update.length === 0 ||
      update.length > MAX_UPDATE_BYTES
    )
      throw new AnswerDocumentError("invalid_update");
    return this.transaction(async (db) => {
      const locked = await this.lock(db, answerId);
      const previousText = locked.ydoc.getText("content").toString();
      const previousState = Buffer.from(Y.encodeStateAsUpdate(locked.ydoc));
      try {
        Y.applyUpdate(locked.ydoc, update);
      } catch {
        throw new AnswerDocumentError("invalid_update");
      }
      const text = locked.ydoc.getText("content").toString();
      if (!text.trim() || text.length > MAX_TEXT_LENGTH)
        throw new AnswerDocumentError("invalid_content");
      const state = Buffer.from(Y.encodeStateAsUpdate(locked.ydoc));
      const binaryChanged = locked.seeded || !state.equals(previousState);
      const textChanged = text !== previousText;
      const revision =
        Number(locked.document.persistence_revision) + (binaryChanged ? 1 : 0);
      const answerVersion =
        Number(locked.answer.version) + (textChanged ? 1 : 0);
      if (binaryChanged) {
        await db.query(
          "UPDATE answer_collaboration_documents SET yjs_state=$2,persistence_revision=$3,persisted_at=now() WHERE answer_id=$1",
          [answerId, state, revision],
        );
      }
      if (textChanged) {
        await db.query(
          "UPDATE answers SET body_markdown=$2,version=version+1,updated_at=now() WHERE id=$1",
          [answerId, text],
        );
      }
      return this.result(locked, state, revision, answerVersion);
    });
  }
}
