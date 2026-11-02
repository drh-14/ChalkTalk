import type { Pool, PoolClient } from "pg";
import { CollaborationSessionService } from "./service.js";

type Db = Pool | PoolClient;

/**
 * Ends every unfinished session of a course. Called inside the transaction
 * that archives or deletes the course. The notification is delivered on commit
 * so the collaboration server closes the editors. A direct end cannot prove a
 * final editor flush, so the saved snapshot remains explicitly unconfirmed.
 */
export async function endCollaborationSessions(
  db: Db,
  scope: { courseId: string } | { creatorId: string; courseId?: string },
) {
  const byCreator = "creatorId" in scope;
  const ended = await db.query<{ id: string }>(
    `UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),final_snapshot_confirmed=false,version=version+1,updated_at=clock_timestamp()
     WHERE ${byCreator ? "created_by_user_id=$1" : "course_id=$1"}
       ${byCreator && scope.courseId ? "AND course_id=$2" : ""}
       AND lifecycle_state<>'ended' RETURNING id`,
    byCreator
      ? scope.courseId
        ? [scope.creatorId, scope.courseId]
        : [scope.creatorId]
      : [scope.courseId],
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
