import type { Pool, PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";

type Db = Pool | PoolClient;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ThreadWatch = { watching: boolean; noticesEnabled: boolean };

/** Called in the message-write transaction, before commit. No email job is queued. */
export async function onThreadMessageCreated(
  db: PoolClient,
  activity: {
    courseId: string;
    conversationId: string;
    messageId: string;
    actorUserId: string;
    isOpening: boolean;
  },
): Promise<void> {
  const { courseId, conversationId, messageId, actorUserId, isOpening } =
    activity;
  await db.query(
    `INSERT INTO thread_watches(course_id,conversation_id,user_id,notices_enabled)
     VALUES ($1,$2,$3,true) ON CONFLICT (conversation_id,user_id) DO NOTHING`,
    [courseId, conversationId, actorUserId],
  );
  await db.query(
    `INSERT INTO thread_message_reads(course_id,message_id,user_id) VALUES ($3,$1,$2)
     ON CONFLICT (message_id,user_id) DO NOTHING`,
    [messageId, actorUserId, courseId],
  );
  if (isOpening) return;
  await db.query(
    `INSERT INTO thread_notifications(id,course_id,conversation_id,message_id,recipient_user_id,actor_user_id)
     SELECT gen_random_uuid(),$1,$2,$3,w.user_id,$4
     FROM thread_watches w
     JOIN course_memberships m ON m.course_id=w.course_id AND m.user_id=w.user_id
     JOIN users u ON u.id=w.user_id AND u.deleted_at IS NULL
     WHERE w.course_id=$1 AND w.conversation_id=$2 AND w.notices_enabled AND w.user_id<>$4`,
    [courseId, conversationId, messageId, actorUserId],
  );
}

export async function threadUnreadCounts(
  db: Db,
  courseId: string,
  userId: string,
  boardIds?: string[],
  conversationIds?: string[],
): Promise<{
  total: number;
  byBoard: Record<string, number>;
  byConversation: Record<string, number>;
}> {
  const result = await db.query<{
    board_id: string;
    conversation_id: string;
    count: number;
  }>(
    `SELECT c.board_id,c.id AS conversation_id,count(*)::int AS count
     FROM thread_watches w
     JOIN course_memberships member ON member.course_id=w.course_id AND member.user_id=w.user_id
     JOIN thread_conversations c ON c.id=w.conversation_id AND c.course_id=w.course_id
     JOIN thread_boards b ON b.id=c.board_id AND b.deleted_at IS NULL
     JOIN thread_messages msg ON msg.conversation_id=c.id AND msg.deleted_at IS NULL
     LEFT JOIN thread_message_reads r ON r.message_id=msg.id AND r.user_id=w.user_id
     WHERE w.course_id=$1 AND w.user_id=$2 AND r.message_id IS NULL
       AND ($3::uuid[] IS NULL OR c.board_id=ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR c.id=ANY($4::uuid[]))
     GROUP BY c.board_id,c.id`,
    [courseId, userId, boardIds ?? null, conversationIds ?? null],
  );
  const byBoard: Record<string, number> = {};
  const byConversation: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows) {
    total += row.count;
    byBoard[row.board_id] = (byBoard[row.board_id] ?? 0) + row.count;
    byConversation[row.conversation_id] = row.count;
  }
  return { total, byBoard, byConversation };
}

export class ThreadWatchService {
  constructor(private readonly pool: Pool) {}

  private async visible(
    db: Db,
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
    write = false,
  ) {
    const result = await db.query<{ status: string }>(
      `SELECT course.status FROM thread_conversations c
       JOIN thread_boards b ON b.id=c.board_id AND b.deleted_at IS NULL
       JOIN courses course ON course.id=c.course_id
       JOIN course_memberships m ON m.course_id=c.course_id AND m.user_id=$4
       WHERE c.course_id=$1 AND c.board_id=$2 AND c.id=$3${write ? " FOR UPDATE OF course,m" : ""}`,
      [courseId, boardId, conversationId, userId],
    );
    if (!result.rowCount || result.rows[0]?.status === "deleting")
      throw new AuthError(
        404,
        "not_found",
        "Thread conversation was not found",
      );
    return result.rows[0]!.status;
  }

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

  async get(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
  ): Promise<ThreadWatch> {
    await this.visible(this.pool, courseId, boardId, conversationId, userId);
    const result = await this.pool.query<{ notices_enabled: boolean }>(
      "SELECT notices_enabled FROM thread_watches WHERE course_id=$1 AND conversation_id=$2 AND user_id=$3",
      [courseId, conversationId, userId],
    );
    return {
      watching: Boolean(result.rowCount),
      noticesEnabled: result.rows[0]?.notices_enabled ?? false,
    };
  }

  async set(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
    noticesEnabled: boolean,
  ): Promise<ThreadWatch> {
    if (typeof noticesEnabled !== "boolean")
      throw new AuthError(
        422,
        "validation_failed",
        "Notification preference is invalid",
      );
    return this.tx(async (db) => {
      if (
        (await this.visible(
          db,
          courseId,
          boardId,
          conversationId,
          userId,
          true,
        )) !== "active"
      )
        throw new AuthError(409, "course_archived", "Course is archived");
      await db.query(
        `INSERT INTO thread_watches(course_id,conversation_id,user_id,notices_enabled)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (conversation_id,user_id) DO UPDATE
           SET notices_enabled=excluded.notices_enabled,updated_at=clock_timestamp()`,
        [courseId, conversationId, userId, noticesEnabled],
      );
      return { watching: true, noticesEnabled };
    });
  }

  async markRead(
    courseId: string,
    boardId: string,
    conversationId: string,
    userId: string,
    messageIds: string[],
  ): Promise<void> {
    if (
      !Array.isArray(messageIds) ||
      !messageIds.length ||
      messageIds.length > 100 ||
      messageIds.some((id) => typeof id !== "string" || !UUID.test(id))
    )
      throw new AuthError(422, "validation_failed", "Message ids are invalid");
    const unique = [...new Set(messageIds)];
    await this.tx(async (db) => {
      if (
        (await this.visible(
          db,
          courseId,
          boardId,
          conversationId,
          userId,
          true,
        )) !== "active"
      )
        throw new AuthError(409, "course_archived", "Course is archived");
      const result = await db.query<{ id: string }>(
        `SELECT id FROM thread_messages WHERE conversation_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL`,
        [conversationId, unique],
      );
      if (result.rows.length !== unique.length)
        throw new AuthError(
          422,
          "validation_failed",
          "Message ids are invalid",
        );
      await db.query(
        `INSERT INTO thread_message_reads(course_id,message_id,user_id)
         SELECT $3::uuid,unnest($1::uuid[]),$2::uuid ON CONFLICT (message_id,user_id) DO NOTHING`,
        [unique, userId, courseId],
      );
    });
  }

  async unreadCount(courseId: string, userId: string) {
    const member = await this.pool.query(
      `SELECT 1 FROM course_memberships m JOIN courses c ON c.id=m.course_id
       WHERE m.course_id=$1 AND m.user_id=$2 AND c.status<>'deleting'`,
      [courseId, userId],
    );
    if (!member.rowCount)
      throw new AuthError(404, "not_found", "Course was not found");
    const { total } = await threadUnreadCounts(this.pool, courseId, userId);
    return { count: total };
  }
}
