/**
 * Private posts are readable only by their author and the course's current
 * TAs and instructors; to everyone else they do not exist.
 */
export const STAFF_ROLES = ["ta", "instructor"] as const;

/** SQL that is true when the viewer may read the post aliased `post`. */
export const readablePost = (post: string, viewer: string, role: string) =>
  `(NOT ${post}.private OR ${post}.author_user_id = ${viewer} OR ${role} IN ('ta','instructor'))`;

export function canReadPost(
  post: { private: boolean; author_user_id: string | null },
  viewerId: string,
  role: string,
): boolean {
  return (
    !post.private ||
    post.author_user_id === viewerId ||
    (STAFF_ROLES as readonly string[]).includes(role)
  );
}
