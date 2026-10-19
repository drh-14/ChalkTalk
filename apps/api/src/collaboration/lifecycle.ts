import type { Pool, PoolClient } from "pg";
import { CollaborationSessionService } from "./service.js";

type Db = Pool | PoolClient;

/**
 * Ends every unfinished session of a course or post. Called inside the
 * transaction that archives or deletes the course, or removes the post; the
 * notification is delivered on commit so the collaboration server persists the
 * final text and closes the editors.
 */
export async function endCollaborationSessions(
  db: Db,
  scope: { courseId: string } | { postId: string },
) {
  const [column, id] =
    "courseId" in scope ? ["course_id", scope.courseId] : ["post_id", scope.postId];
  const ended = await db.query<{ id: string }>(
    `UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE ${column}=$1 AND lifecycle_state<>'ended' RETURNING id`,
    [id],
  );
  for (const row of ended.rows)
    await CollaborationSessionService.notify(db, {
      type: "session_ended",
      sessionId: row.id,
    });
}

/** Asks the collaboration server to recheck these users' open connections. */
export async function collaborationAccessChanged(
  db: Db,
  userIds: string[],
  courseId?: string,
) {
  if (!userIds.length) return;
  await CollaborationSessionService.notify(db, {
    type: "access_changed",
    ...(courseId ? { courseId } : {}),
    userIds,
  });
}
