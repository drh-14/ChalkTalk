/**
 * Private posts are readable only by their author and the course's current
 * TAs and instructors, and scheduled announcements only by staff until they
 * publish; to everyone else they do not exist.
 */
export const STAFF_ROLES = ["ta", "instructor"] as const;

/** SQL that is true when the viewer may read the post aliased `post`. */
export const readablePost = (post: string, viewer: string, role: string) =>
  `(${role} IN ('ta','instructor') OR (${post}.scheduled_for IS NULL AND (NOT ${post}.private OR ${post}.author_user_id = ${viewer})))`;

export function canReadPost(
  post: {
    private: boolean;
    author_user_id: string | null;
    scheduled_for: Date | null;
  },
  viewerId: string,
  role: string,
): boolean {
  if ((STAFF_ROLES as readonly string[]).includes(role)) return true;
  return (
    post.scheduled_for === null &&
    (!post.private || post.author_user_id === viewerId)
  );
}
