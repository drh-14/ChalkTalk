import type { Pool, PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";

/** A single current-membership rule for post and descendant SQL queries. */
export const readablePost = (post: string, viewer: string) => {
  return `EXISTS (SELECT 1 FROM course_memberships audience_member
    WHERE audience_member.course_id=${post}.course_id AND audience_member.user_id=${viewer}
      AND (${post}.audience='class'
        OR (${post}.audience='staff' AND (${post}.author_user_id=${viewer} OR audience_member.role IN ('ta','instructor')))
        OR (${post}.audience='selected_staff' AND (
          ${post}.author_user_id=${viewer} OR (audience_member.role IN ('ta','instructor') AND EXISTS (
            SELECT 1 FROM post_staff_recipients audience_recipient
            WHERE audience_recipient.post_id=${post}.id AND audience_recipient.user_id=${viewer}))))
        OR (${post}.audience='group' AND EXISTS (
          SELECT 1 FROM private_post_group_members audience_group_member
          WHERE audience_group_member.group_id=${post}.audience_group_id
            AND audience_group_member.course_id=${post}.course_id
            AND audience_group_member.user_id=${viewer}))))`;
};

export async function postVisible(
  db: Pool | PoolClient,
  postId: string,
  viewerId: string,
): Promise<boolean> {
  const found = await db.query<{
    audience: string;
    audience_group_id: string | null;
    author_user_id: string | null;
    course_id: string;
  }>(
    `SELECT p.audience,p.audience_group_id,p.author_user_id,p.course_id
     FROM posts p WHERE p.id=$1 AND ${readablePost("p", "$2")}`,
    [postId, viewerId],
  );
  const post = found.rows[0];
  if (!post) return false;
  if (post.audience === "group") {
    const membership = await db.query(
      "SELECT 1 FROM private_post_group_members WHERE group_id=$1 AND course_id=$2 AND user_id=$3 FOR SHARE",
      [post.audience_group_id, post.course_id, viewerId],
    );
    if (!membership.rowCount) return false;
  }
  if (post.audience === "selected_staff" && post.author_user_id !== viewerId) {
    const recipient = await db.query(
      "SELECT 1 FROM post_staff_recipients WHERE post_id=$1 AND user_id=$2 FOR SHARE",
      [postId, viewerId],
    );
    if (!recipient.rowCount) return false;
  }
  return true;
}

export async function assertPostVisible(
  db: Pool | PoolClient,
  postId: string,
  viewerId: string,
): Promise<void> {
  if (!(await postVisible(db, postId, viewerId)))
    throw new AuthError(404, "not_found", "Post is not found");
}
