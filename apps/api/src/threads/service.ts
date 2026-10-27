import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import {
  hideThreadAttachmentsForBoard,
  hideThreadAttachmentsForMessage,
  listThreadAttachments,
  type ThreadAttachment,
} from "./attachments.js";
import { onThreadMessageCreated, threadUnreadCounts } from "./watch.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Membership = { role: Role; status: "active" | "archived" | "deleting" };
type BoardRow = {
  id: string;
  course_id: string;
  title: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};
type ConversationRow = {
  id: string;
  course_id: string;
  board_id: string;
  created_at: Date;
  updated_at: Date;
  updated_cursor?: string;
};
type MessageRow = {
  id: string;
  course_id: string;
  board_id: string;
  conversation_id: string;
  ordinal: string;
  author_user_id: string | null;
  author_role_at_posting: Role;
  display_name: string | null;
  body_markdown: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};
export type ThreadBoard = {
  id: string;
  courseId: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
};
export type ThreadMessage = {
  id: string;
  conversationId: string;
  bodyMarkdown: string;
  author: { id: string; displayName: string } | null;
  authorRoleAtPosting: Role | null;
  ordinal: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  attachments: ThreadAttachment[];
};
export type ThreadConversation = {
  id: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  openingMessage?: ThreadMessage;
  unreadCount: number;
};
const conversation = (row: ConversationRow): ThreadConversation => ({
  id: row.id,
  threadId: row.board_id,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  unreadCount: 0,
});
const message = (row: MessageRow): ThreadMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  bodyMarkdown: row.deleted_at ? "" : row.body_markdown,
  author:
    row.deleted_at || !row.author_user_id
      ? null
      : { id: row.author_user_id, displayName: row.display_name! },
  authorRoleAtPosting: row.deleted_at ? null : row.author_role_at_posting,
  ordinal: Number(row.ordinal),
  version: row.version,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  deleted: row.deleted_at !== null,
  attachments: [],
});
const board = (row: BoardRow): ThreadBoard => ({
  id: row.id,
  courseId: row.course_id,
  title: row.title,
  version: row.version,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  unreadCount: 0,
});
export type ThreadPage<T> = {
  data: T[];
  page: { hasMore: boolean; nextCursor: string | null };
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decodeCursor(
  cursor: string | undefined,
  scope: string,
  courseId: string,
  parentId?: string,
): string | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url");
    const parts: unknown = JSON.parse(raw.toString("utf8"));
    if (
      raw.toString("base64url") !== cursor ||
      !Array.isArray(parts) ||
      parts.length !== 4 ||
      parts[0] !== scope ||
      parts[1] !== courseId ||
      parts[2] !== (parentId ?? null) ||
      typeof parts[3] !== "string" ||
      !uuidPattern.test(parts[3])
    )
      throw Error();
    return parts[3];
  } catch {
    throw new AuthError(400, "invalid_request", "Pagination cursor is invalid");
  }
}
function encodeCursor(
  scope: string,
  courseId: string,
  parentId: string | null,
  id: string,
): string {
  return Buffer.from(JSON.stringify([scope, courseId, parentId, id])).toString(
    "base64url",
  );
}
function decodeActivityCursor(
  cursor: string | undefined,
  courseId: string,
  boardId: string,
): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url");
    const parts: unknown = JSON.parse(raw.toString("utf8"));
    if (
      raw.toString("base64url") !== cursor ||
      !Array.isArray(parts) ||
      parts.length !== 5 ||
      parts[0] !== "conversations:activity:v1" ||
      parts[1] !== courseId ||
      parts[2] !== boardId ||
      typeof parts[3] !== "string" ||
      parts[3].length > 64 ||
      Number.isNaN(Date.parse(parts[3])) ||
      typeof parts[4] !== "string" ||
      !uuidPattern.test(parts[4])
    )
      throw Error();
    return { updatedAt: parts[3], id: parts[4] };
  } catch {
    throw new AuthError(400, "invalid_request", "Pagination cursor is invalid");
  }
}
function encodeActivityCursor(
  courseId: string,
  boardId: string,
  row: ConversationRow,
): string {
  return Buffer.from(
    JSON.stringify([
      "conversations:activity:v1",
      courseId,
      boardId,
      row.updated_cursor,
      row.id,
    ]),
  ).toString("base64url");
}
function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new AuthError(400, "invalid_request", "Pagination is invalid");
}
function decodeChangeCursor(
  cursor: string | undefined,
  courseId: string,
): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, "base64url");
    const value: unknown = JSON.parse(raw.toString("utf8"));
    if (
      raw.toString("base64url") !== cursor ||
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== "changes:v1" ||
      value[1] !== courseId ||
      !Number.isSafeInteger(value[2]) ||
      (value[2] as number) < 0
    )
      throw Error();
    return value[2] as number;
  } catch {
    throw new AuthError(400, "invalid_request", "Change cursor is invalid");
  }
}
function encodeChangeCursor(courseId: string, sequence: number): string {
  return Buffer.from(
    JSON.stringify(["changes:v1", courseId, sequence]),
  ).toString("base64url");
}
export const threadEtag = (value: { version: number }) => `"v${value.version}"`;
const missing = () => new AuthError(404, "not_found", "Thread is not found");
const invalid = (message = "Thread content is invalid") =>
  new AuthError(422, "validation_failed", message);
function validTitle(value: unknown): string {
  if (typeof value !== "string") throw invalid("Title is invalid");
  const title = value.trim();
  if (!title || [...title].length > 200 || title.includes("\0"))
    throw invalid("Title is invalid");
  return title;
}
function validBody(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > 100000 ||
    value.includes("\0")
  )
    throw invalid("Message body is invalid");
  return value;
}
async function membership(
  db: Db,
  courseId: string,
  userId: string,
  write = false,
): Promise<Membership> {
  const result = await db.query<Membership>(
    `SELECT m.role,c.status FROM courses c JOIN course_memberships m ON m.course_id=c.id JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE c.id=$1 AND m.user_id=$2${write ? " FOR UPDATE OF c,m" : ""}`,
    [courseId, userId],
  );
  const row = result.rows[0];
  if (!row || row.status === "deleting") throw missing();
  if (write && row.status !== "active")
    throw new AuthError(409, "course_archived", "Course is read-only");
  return row;
}
async function appendChange(
  db: PoolClient,
  courseId: string,
  boardId: string,
  kind: string,
  entityId: string,
): Promise<number> {
  const counter = await db.query<{ sequence: string }>(
    `INSERT INTO thread_course_counters(course_id,sequence) VALUES ($1,1)
     ON CONFLICT(course_id) DO UPDATE SET sequence=thread_course_counters.sequence+1
     RETURNING sequence`,
    [courseId],
  );
  const sequence = Number(counter.rows[0]!.sequence);
  await db.query(
    "INSERT INTO thread_changes(course_id,sequence,board_id,kind,entity_id) VALUES ($1,$2,$3,$4,$5)",
    [courseId, sequence, boardId, kind, entityId],
  );
  await db.query(
    "SELECT pg_notify('thread_changes',json_build_object('courseId',$1::text,'boardId',$2::text,'sequence',$3::bigint)::text)",
    [courseId, boardId, sequence],
  );
  return sequence;
}
export { appendChange };

export class ThreadService {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
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

  private async replay<T>(
    db: PoolClient,
    scope: string,
    key: string | undefined,
    input: unknown,
    visible: (value: T) => Promise<void>,
  ): Promise<T | undefined> {
    if (key === undefined) return undefined;
    if (!key || key.length > 255) throw invalid("Idempotency-Key is invalid");
    const hash = createHash("sha256").update(JSON.stringify(input)).digest();
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      scope,
      key,
    ]);
    const old = await db.query<{ request_hash: Buffer; response_body: T }>(
      "SELECT request_hash,response_body FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
      [scope, key],
    );
    if (!old.rows[0]) {
      await db.query(
        "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
        [scope, key],
      );
      return undefined;
    }
    if (!old.rows[0].request_hash.equals(hash))
      throw new AuthError(
        409,
        "idempotency_key_reused",
        "Idempotency key was reused",
      );
    try {
      await visible(old.rows[0].response_body);
    } catch (error) {
      if (error instanceof AuthError && error.status === 404)
        throw new AuthError(
          409,
          "idempotency_key_reused",
          "Idempotency key refers to unavailable content",
        );
      throw error;
    }
    return old.rows[0].response_body;
  }

  private async saveReplay(
    db: PoolClient,
    scope: string,
    key: string | undefined,
    input: unknown,
    responseBody: unknown,
  ): Promise<void> {
    if (key === undefined) return;
    const hash = createHash("sha256").update(JSON.stringify(input)).digest();
    await db.query(
      "INSERT INTO idempotency_records(scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,201,$4,now()+interval '24 hours')",
      [scope, key, hash, responseBody],
    );
  }

  async changes(
    courseId: string,
    userId: string,
    limit = 30,
    after?: string,
  ): Promise<
    ThreadPage<{
      sequence: number;
      boardId: string;
      kind: string;
      entityId: string;
    }>
  > {
    checkLimit(limit);
    const afterSequence = decodeChangeCursor(after, courseId);
    await membership(this.pool, courseId, userId);
    const result = await this.pool.query<{
      sequence: string;
      board_id: string;
      kind: string;
      entity_id: string;
    }>(
      "SELECT sequence,board_id,kind,entity_id FROM thread_changes WHERE course_id=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3",
      [courseId, afterSequence, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const latest = rows.at(-1);
    const sequence = latest ? Number(latest.sequence) : afterSequence;
    if (!Number.isSafeInteger(sequence))
      throw new Error("Thread change sequence exceeds safe integer range");
    return {
      data: rows.map((row) => ({
        sequence: Number(row.sequence),
        boardId: row.board_id,
        kind: row.kind,
        entityId: row.entity_id,
      })),
      page: {
        hasMore: result.rows.length > limit,
        nextCursor: sequence ? encodeChangeCursor(courseId, sequence) : null,
      },
    };
  }

  async listBoards(
    courseId: string,
    userId: string,
    limit = 30,
    cursor?: string,
  ): Promise<ThreadPage<ThreadBoard>> {
    checkLimit(limit);
    const beforeId = decodeCursor(cursor, "boards:v1", courseId);
    await membership(this.pool, courseId, userId);
    const result = await this.pool.query<BoardRow>(
      "SELECT id,course_id,title,version,created_at,updated_at FROM thread_boards WHERE course_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id<$2::uuid) ORDER BY id DESC LIMIT $3",
      [courseId, beforeId, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const unread = await threadUnreadCounts(
      this.pool,
      courseId,
      userId,
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) => ({
        ...board(row),
        unreadCount: unread.byBoard[row.id] ?? 0,
      })),
      page: {
        hasMore: result.rows.length > limit,
        nextCursor:
          result.rows.length > limit
            ? encodeCursor("boards:v1", courseId, null, rows.at(-1)!.id)
            : null,
      },
    };
  }

  async createBoard(
    courseId: string,
    userId: string,
    input: unknown,
    key?: string,
  ): Promise<ThreadBoard> {
    return this.tx(async (db) => {
      const member = await membership(db, courseId, userId, true);
      if (member.role === "student")
        throw new AuthError(
          403,
          "permission_denied",
          "Staff access is required",
        );
      const title = validTitle(input);
      const scope = `thread-board-create:${userId}:${courseId}`;
      const inputHash = { title };
      const previous = await this.replay<ThreadBoard>(
        db,
        scope,
        key,
        inputHash,
        async (value) => {
          await this.activeBoard(db, courseId, value.id);
        },
      );
      if (previous) return previous;
      const id = uuidv7();
      const result = await db.query<BoardRow>(
        "INSERT INTO thread_boards(id,course_id,title) VALUES ($1,$2,$3) RETURNING id,course_id,title,version,created_at,updated_at",
        [id, courseId, title],
      );
      await appendChange(db, courseId, id, "board_created", id);
      const value = board(result.rows[0]!);
      await this.saveReplay(db, scope, key, inputHash, value);
      return value;
    });
  }

  async getBoard(
    courseId: string,
    boardId: string,
    userId: string,
  ): Promise<ThreadBoard> {
    await membership(this.pool, courseId, userId);
    const found = board(await this.activeBoard(this.pool, courseId, boardId));
    const unread = await threadUnreadCounts(this.pool, courseId, userId, [
      boardId,
    ]);
    return { ...found, unreadCount: unread.byBoard[boardId] ?? 0 };
  }

  async changeBoard(
    courseId: string,
    boardId: string,
    userId: string,
    ifMatch: string | undefined,
    newTitle?: unknown,
  ): Promise<ThreadBoard | null> {
    return this.tx(async (db) => {
      const member = await membership(db, courseId, userId, true);
      if (member.role === "student")
        throw new AuthError(
          403,
          "permission_denied",
          "Staff access is required",
        );
      const existing = await this.activeBoard(db, courseId, boardId, true);
      if (!ifMatch)
        throw new AuthError(
          428,
          "precondition_required",
          "If-Match is required",
        );
      if (ifMatch !== threadEtag(existing))
        throw new AuthError(412, "version_conflict", "Thread has changed");
      const title = newTitle === undefined ? undefined : validTitle(newTitle);
      if (title === undefined) {
        await hideThreadAttachmentsForBoard(db, boardId);
        await db.query(
          "UPDATE thread_boards SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [boardId],
        );
        await appendChange(db, courseId, boardId, "board_deleted", boardId);
        return null;
      }
      const result = await db.query<BoardRow>(
        "UPDATE thread_boards SET title=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING id,course_id,title,version,created_at,updated_at",
        [boardId, title],
      );
      await appendChange(db, courseId, boardId, "board_updated", boardId);
      return board(result.rows[0]!);
    });
  }

  private async activeBoard(
    db: Db,
    courseId: string,
    boardId: string,
    lock = false,
  ): Promise<BoardRow> {
    const result = await db.query<BoardRow>(
      `SELECT id,course_id,title,version,created_at,updated_at FROM thread_boards WHERE course_id=$1 AND id=$2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
      [courseId, boardId],
    );
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }

  async createConversation(
    courseId: string,
    boardId: string,
    userId: string,
    input: unknown,
    key?: string,
  ): Promise<{ data: ThreadConversation; openingMessage: ThreadMessage }> {
    return this.tx(async (db) => {
      const member = await membership(db, courseId, userId, true);
      await this.activeBoard(db, courseId, boardId, true);
      const body = validBody(input);
      const scope = `thread-conversation-create:${userId}:${courseId}:${boardId}`;
      const inputHash = { bodyMarkdown: body };
      const previous = await this.replay<{
        data: ThreadConversation;
        openingMessage: ThreadMessage;
      }>(db, scope, key, inputHash, async (value) => {
        await this.activeConversation(db, courseId, boardId, value.data.id);
        const opening = await db.query(
          `SELECT 1 FROM thread_messages
           WHERE course_id=$1 AND board_id=$2 AND conversation_id=$3 AND id=$4 AND deleted_at IS NULL`,
          [courseId, boardId, value.data.id, value.openingMessage.id],
        );
        if (!opening.rowCount) throw missing();
      });
      if (previous) return previous;
      const conversationId = uuidv7();
      const messageId = uuidv7();
      const result = await db.query<ConversationRow>(
        "INSERT INTO thread_conversations(id,course_id,board_id,next_message_ordinal) VALUES ($1,$2,$3,2) RETURNING id,course_id,board_id,created_at,updated_at",
        [conversationId, courseId, boardId],
      );
      const opening = await db.query<MessageRow>(
        `INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7)
         RETURNING id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,$8::text AS display_name,body_markdown,version,created_at,updated_at,deleted_at`,
        [
          messageId,
          courseId,
          boardId,
          conversationId,
          userId,
          member.role,
          body,
          await this.displayName(db, userId),
        ],
      );
      await onThreadMessageCreated(db, {
        courseId,
        conversationId,
        messageId,
        actorUserId: userId,
        isOpening: true,
      });
      await appendChange(
        db,
        courseId,
        boardId,
        "conversation_created",
        conversationId,
      );
      const value = {
        data: conversation(result.rows[0]!),
        openingMessage: message(opening.rows[0]!),
      };
      await this.saveReplay(db, scope, key, inputHash, value);
      return value;
    });
  }

  private async displayName(db: Db, userId: string): Promise<string> {
    const result = await db.query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE id=$1",
      [userId],
    );
    return result.rows[0]!.display_name;
  }

  private async activeConversation(
    db: Db,
    courseId: string,
    boardId: string,
    conversationId: string,
    lock = false,
  ): Promise<ConversationRow> {
    const result = await db.query<ConversationRow>(
      `SELECT c.id,c.course_id,c.board_id,c.created_at,c.updated_at FROM thread_conversations c JOIN thread_boards b ON b.id=c.board_id AND b.course_id=c.course_id WHERE c.course_id=$1 AND c.board_id=$2 AND c.id=$3 AND b.deleted_at IS NULL${lock ? " FOR UPDATE OF c" : ""}`,
      [courseId, boardId, conversationId],
    );
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }

  private async openingMessage(
    db: Db,
    conversationId: string,
  ): Promise<ThreadMessage> {
    const found = await db.query<MessageRow>(
      `SELECT m.id,m.course_id,m.board_id,m.conversation_id,m.ordinal,m.author_user_id,m.author_role_at_posting,u.display_name,m.body_markdown,m.version,m.created_at,m.updated_at,m.deleted_at
       FROM thread_messages m LEFT JOIN users u ON u.id=m.author_user_id WHERE m.conversation_id=$1 AND m.ordinal=1`,
      [conversationId],
    );
    const value = message(found.rows[0]!);
    value.attachments = value.deleted
      ? []
      : await listThreadAttachments(db, value.id);
    return value;
  }

  async listConversations(
    courseId: string,
    boardId: string,
    userId: string,
    limit = 30,
    cursor?: string,
  ): Promise<ThreadPage<ThreadConversation>> {
    checkLimit(limit);
    const before = decodeActivityCursor(cursor, courseId, boardId);
    await membership(this.pool, courseId, userId);
    await this.activeBoard(this.pool, courseId, boardId);
    const found = await this.pool.query<ConversationRow>(
      `SELECT id,course_id,board_id,created_at,updated_at,updated_at::text AS updated_cursor
       FROM thread_conversations WHERE course_id=$1 AND board_id=$2
         AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid))
       ORDER BY updated_at DESC,id DESC LIMIT $5`,
      [
        courseId,
        boardId,
        before?.updatedAt ?? null,
        before?.id ?? null,
        limit + 1,
      ],
    );
    const rows = found.rows.slice(0, limit);
    const unread = await threadUnreadCounts(
      this.pool,
      courseId,
      userId,
      [boardId],
      rows.map((row) => row.id),
    );
    const data = await Promise.all(
      rows.map(async (row) => ({
        ...conversation(row),
        openingMessage: await this.openingMessage(this.pool, row.id),
        unreadCount: unread.byConversation[row.id] ?? 0,
      })),
    );
    return {
      data,
      page: {
        hasMore: found.rows.length > limit,
        nextCursor:
          found.rows.length > limit
            ? encodeActivityCursor(courseId, boardId, rows.at(-1)!)
            : null,
      },
    };
  }

  async getConversation(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
  ): Promise<ThreadConversation> {
    await membership(this.pool, courseId, userId);
    const row = await this.activeConversation(
      this.pool,
      courseId,
      boardId,
      conversationId,
    );
    const unread = await threadUnreadCounts(
      this.pool,
      courseId,
      userId,
      [boardId],
      [conversationId],
    );
    return {
      ...conversation(row),
      openingMessage: await this.openingMessage(this.pool, conversationId),
      unreadCount: unread.byConversation[conversationId] ?? 0,
    };
  }

  async listMessages(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
    limit = 30,
    cursor?: string,
  ): Promise<ThreadPage<ThreadMessage>> {
    checkLimit(limit);
    const afterId = decodeCursor(
      cursor,
      "messages:v1",
      courseId,
      conversationId,
    );
    await membership(this.pool, courseId, userId);
    await this.activeConversation(this.pool, courseId, boardId, conversationId);
    let beforeOrdinal: number | null = null;
    if (afterId) {
      const prior = await this.pool.query<{ ordinal: string }>(
        "SELECT ordinal FROM thread_messages WHERE id=$1 AND conversation_id=$2",
        [afterId, conversationId],
      );
      if (!prior.rows[0])
        throw new AuthError(
          400,
          "invalid_request",
          "Pagination cursor is invalid",
        );
      beforeOrdinal = Number(prior.rows[0].ordinal);
    }
    const result = await this.pool.query<MessageRow>(
      `SELECT m.id,m.course_id,m.board_id,m.conversation_id,m.ordinal,m.author_user_id,m.author_role_at_posting,u.display_name,m.body_markdown,m.version,m.created_at,m.updated_at,m.deleted_at
       FROM thread_messages m LEFT JOIN users u ON u.id=m.author_user_id
       WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.ordinal<$2::bigint) ORDER BY m.ordinal DESC LIMIT $3`,
      [conversationId, beforeOrdinal, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const projected = rows.slice().reverse().map(message);
    await Promise.all(
      projected.map(async (item) => {
        item.attachments = item.deleted
          ? []
          : await listThreadAttachments(this.pool, item.id);
      }),
    );
    return {
      data: projected,
      page: {
        hasMore: result.rows.length > limit,
        nextCursor:
          result.rows.length > limit
            ? encodeCursor(
                "messages:v1",
                courseId,
                conversationId,
                rows.at(-1)!.id,
              )
            : null,
      },
    };
  }

  async getMessage(
    courseId: string,
    boardId: string,
    conversationId: string,
    messageId: string,
    userId: string,
  ): Promise<ThreadMessage> {
    await membership(this.pool, courseId, userId);
    await this.activeConversation(this.pool, courseId, boardId, conversationId);
    const found = await this.pool.query<MessageRow>(
      `SELECT m.id,m.course_id,m.board_id,m.conversation_id,m.ordinal,m.author_user_id,m.author_role_at_posting,u.display_name,m.body_markdown,m.version,m.created_at,m.updated_at,m.deleted_at
       FROM thread_messages m LEFT JOIN users u ON u.id=m.author_user_id WHERE m.course_id=$1 AND m.board_id=$2 AND m.conversation_id=$3 AND m.id=$4`,
      [courseId, boardId, conversationId, messageId],
    );
    if (!found.rows[0]) throw missing();
    const value = message(found.rows[0]);
    value.attachments = value.deleted
      ? []
      : await listThreadAttachments(this.pool, messageId);
    return value;
  }

  async createReply(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
    input: unknown,
    key?: string,
  ): Promise<ThreadMessage> {
    return this.tx(async (db) => {
      const member = await membership(db, courseId, userId, true);
      await this.activeBoard(db, courseId, boardId, true);
      await this.activeConversation(
        db,
        courseId,
        boardId,
        conversationId,
        true,
      );
      const body = validBody(input);
      const scope = `thread-reply-create:${userId}:${courseId}:${conversationId}`;
      const inputHash = { bodyMarkdown: body };
      const previous = await this.replay<ThreadMessage>(
        db,
        scope,
        key,
        inputHash,
        async (value) => {
          const found = await db.query(
            "SELECT 1 FROM thread_messages WHERE course_id=$1 AND conversation_id=$2 AND id=$3 AND deleted_at IS NULL",
            [courseId, conversationId, value.id],
          );
          if (!found.rowCount) throw missing();
        },
      );
      if (previous) return previous;
      const ordinal = await db.query<{ ordinal: string }>(
        "UPDATE thread_conversations SET next_message_ordinal=next_message_ordinal+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING next_message_ordinal-1 AS ordinal",
        [conversationId],
      );
      const id = uuidv7();
      const result = await db.query<MessageRow>(
        `INSERT INTO thread_messages(id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,body_markdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,$9::text AS display_name,body_markdown,version,created_at,updated_at,deleted_at`,
        [
          id,
          courseId,
          boardId,
          conversationId,
          ordinal.rows[0]!.ordinal,
          userId,
          member.role,
          body,
          await this.displayName(db, userId),
        ],
      );
      await onThreadMessageCreated(db, {
        courseId,
        conversationId,
        messageId: id,
        actorUserId: userId,
        isOpening: false,
      });
      await appendChange(db, courseId, boardId, "message_created", id);
      const value = message(result.rows[0]!);
      await this.saveReplay(db, scope, key, inputHash, value);
      return value;
    });
  }

  private async existingMessage(
    db: PoolClient,
    courseId: string,
    boardId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MessageRow> {
    const result = await db.query<MessageRow>(
      `SELECT m.id,m.course_id,m.board_id,m.conversation_id,m.ordinal,m.author_user_id,m.author_role_at_posting,u.display_name,m.body_markdown,m.version,m.created_at,m.updated_at,m.deleted_at
       FROM thread_messages m LEFT JOIN users u ON u.id=m.author_user_id
       WHERE m.course_id=$1 AND m.board_id=$2 AND m.conversation_id=$3 AND m.id=$4 FOR UPDATE OF m`,
      [courseId, boardId, conversationId, messageId],
    );
    if (!result.rows[0] || result.rows[0].deleted_at) throw missing();
    return result.rows[0];
  }

  async changeMessage(
    courseId: string,
    boardId: string,
    conversationId: string,
    messageId: string,
    userId: string,
    ifMatch: string | undefined,
    newBody?: unknown,
  ): Promise<ThreadMessage | null> {
    return this.tx(async (db) => {
      const member = await membership(db, courseId, userId, true);
      await this.activeBoard(db, courseId, boardId, true);
      await this.activeConversation(
        db,
        courseId,
        boardId,
        conversationId,
        true,
      );
      const existing = await this.existingMessage(
        db,
        courseId,
        boardId,
        conversationId,
        messageId,
      );
      if (
        existing.author_user_id !== userId &&
        !(
          member.role !== "student" &&
          existing.author_role_at_posting === "student"
        )
      )
        throw new AuthError(
          403,
          "permission_denied",
          "Message edit is not allowed",
        );
      if (!ifMatch)
        throw new AuthError(
          428,
          "precondition_required",
          "If-Match is required",
        );
      if (ifMatch !== threadEtag(existing))
        throw new AuthError(412, "version_conflict", "Message has changed");
      const body = newBody === undefined ? undefined : validBody(newBody);
      if (body === undefined) {
        await hideThreadAttachmentsForMessage(db, messageId);
        await db.query(
          "UPDATE thread_messages SET body_markdown='',deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [messageId],
        );
        await appendChange(db, courseId, boardId, "message_deleted", messageId);
        return null;
      }
      const updated = await db.query<MessageRow>(
        `UPDATE thread_messages SET body_markdown=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1
         RETURNING id,course_id,board_id,conversation_id,ordinal,author_user_id,author_role_at_posting,$3::text AS display_name,body_markdown,version,created_at,updated_at,deleted_at`,
        [messageId, body, existing.display_name],
      );
      await appendChange(db, courseId, boardId, "message_updated", messageId);
      const value = message(updated.rows[0]!);
      value.attachments = await listThreadAttachments(db, messageId);
      return value;
    });
  }
}
