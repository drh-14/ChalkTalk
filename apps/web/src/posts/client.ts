import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";
import type { Attachment } from "../attachments/client.js";

export type PollOption = {
  id: string;
  label: string;
  voteCount: number;
  /** Whether the viewer chose this option. */
  selected: boolean;
};
export type PollState = { options: PollOption[]; totalVotes: number };
export type Post = {
  id: string;
  courseId: string;
  type: "question" | "note" | "poll";
  deleted: false;
  title: string;
  bodyMarkdown: string;
  author: {
    userId: string | null;
    displayName: string;
    anonymous: boolean;
    deleted: boolean;
  };
  anonymous: boolean;
  tags: string[];
  attachments?: Attachment[];
  createdAt: string;
  lastActivityAt: string;
  version: number;
  duplicateStatus?: "none" | "suggested" | "confirmed";
  duplicateOfPostId?: string | null;
  pinned?: boolean;
  /** Staff notes pinned and emailed to the course. */
  announcement?: boolean;
  discussionLocked?: boolean;
  /** Readable only by the author and course staff. */
  private?: boolean;
  answered?: boolean;
  /** Questions only: active followup discussions still unresolved. */
  unresolvedFollowups?: number;
  /** Whether the viewer is notified of activity on the post. */
  following?: boolean;
  /** Whether the post changed since the viewer last opened it. */
  unread?: boolean;
  /** Present on polls. */
  options?: PollOption[];
  totalVotes?: number;
};
export type PostDetail = Post | { id: string; courseId: string; deleted: true };
export type MergedPost = {
  id: string;
  courseId: string;
  type: "question" | "note";
  title: string;
  duplicateStatus: "confirmed";
  duplicateOfPostId: string;
  canonicalTitle: string;
  version: number;
};
export type PostRedirect = { redirectToPostId: string };
export type CreatePostInput = {
  type: "question" | "note" | "poll";
  title: string;
  bodyMarkdown: string;
  anonymous: boolean;
  tags: string[];
  options?: { label: string }[];
  announcement?: boolean;
  private?: boolean;
};
export type PostSort = "relevance" | "newest" | "oldest" | "recent_activity";
export type PostListOptions = {
  q?: string;
  semanticQuery?: string;
  sort?: PostSort;
  cursor?: string;
  type?: "question" | "note" | "poll";
  announcement?: true;
  private?: true;
  unresolvedFollowups?: true;
  answered?: boolean;
  pinned?: boolean;
  authorId?: string;
  authorRole?: "instructor" | "ta";
  tags?: string[];
  /** How several tags combine; the feed matches all of them unless told otherwise. */
  tagMatch?: "any" | "all";
  limit?: number;
  signal?: AbortSignal;
};

async function receive<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    data?: T;
    page?: Page<T>["page"];
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Something went wrong. Please try again.",
      payload.error?.requestId,
    );
  return payload as T;
}

export async function listPosts(
  courseId: string,
  options: PostListOptions = {},
): Promise<Page<Post>> {
  const query = new URLSearchParams();
  if (options.q) query.set("q", options.q);
  if (options.semanticQuery) query.set("semanticQuery", options.semanticQuery);
  if (options.sort) query.set("sort", options.sort);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.type) query.set("type", options.type);
  if (options.answered !== undefined)
    query.set("answered", String(options.answered));
  if (options.pinned !== undefined) query.set("pinned", String(options.pinned));
  if (options.announcement) query.set("announcement", "true");
  if (options.private) query.set("private", "true");
  if (options.unresolvedFollowups) query.set("unresolvedFollowups", "true");
  if (options.authorId) query.set("authorId", options.authorId);
  if (options.authorRole) query.set("authorRole", options.authorRole);
  const tags = options.tags ?? [];
  for (const tag of tags) query.append("tag", tag);
  if (tags.length > 1) query.set("tagMatch", options.tagMatch ?? "all");
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query}` : "";
  return receive<Page<Post>>(
    await fetch(
      `/api/v1/courses/${encodeURIComponent(courseId)}/posts${suffix}`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: options.signal,
      },
    ),
  );
}

export async function getPost(
  postId: string,
  signal?: AbortSignal,
): Promise<PostDetail | PostRedirect> {
  const response = await fetch(`/api/v1/posts/${encodeURIComponent(postId)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.redirected) {
    const match = new URL(response.url, window.location.origin).pathname.match(
      /^\/api\/v1\/posts\/([^/]+)$/,
    );
    if (match && match[1] !== postId)
      return { redirectToPostId: decodeURIComponent(match[1]) };
  }
  const payload = await receive<{ data: PostDetail }>(response);
  return payload.data;
}

export async function getDuplicateReview(
  postId: string,
  signal?: AbortSignal,
): Promise<Post> {
  const response = await fetch(
    `/api/v1/posts/${encodeURIComponent(postId)}/duplicate-review`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const payload = await receive<{ data: Post }>(response);
  return payload.data;
}

export async function listMergedPosts(
  courseId: string,
  options: PostListOptions = {},
): Promise<Page<MergedPost>> {
  const query = new URLSearchParams({ duplicateStatus: "confirmed" });
  if (options.q) query.set("q", options.q);
  if (options.sort) query.set("sort", options.sort);
  if (options.cursor) query.set("cursor", options.cursor);
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/posts?${query}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: options.signal,
    },
  );
  return receive<Page<MergedPost>>(response);
}

export async function updatePost(
  post: Pick<Post, "id" | "version">,
  input: Omit<CreatePostInput, "type">,
  csrfToken: string,
): Promise<Post> {
  const result = await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${post.version}"`,
      },
      body: JSON.stringify(input),
    }),
  );
  return result.data;
}

export async function unmergePost(
  post: MergedPost,
  csrfToken: string,
): Promise<void> {
  await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${post.version}"`,
      },
      body: JSON.stringify({
        duplicateStatus: "none",
        duplicateOfPostId: null,
      }),
    }),
  );
}

export async function confirmMergePost(
  source: Post,
  targetId: string,
  csrfToken: string,
): Promise<void> {
  await receive<{ data: { duplicateOfPostId: string } }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(source.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${source.version}"`,
      },
      body: JSON.stringify({
        duplicateStatus: "confirmed",
        duplicateOfPostId: targetId,
      }),
    }),
  );
}

export async function setPostDiscussionLocked(
  post: Post,
  locked: boolean,
  csrfToken: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(
      `/api/v1/posts/${encodeURIComponent(post.id)}/discussion-lock`,
      {
        method: "PUT",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "If-Match": `"v${post.version}"`,
        },
        body: JSON.stringify({ locked }),
      },
    ),
  );
  return payload.data;
}

export async function setPostPinned(
  post: Post,
  pinned: boolean,
  csrfToken: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${post.version}"`,
      },
      body: JSON.stringify({ pinned }),
    }),
  );
  return payload.data;
}

/** Makes a private post readable by the whole course; this cannot be undone. */
export async function makePostPublic(
  post: Post,
  csrfToken: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${post.version}"`,
      },
      body: JSON.stringify({ private: false }),
    }),
  );
  return payload.data;
}

/** Follows or unfollows a post for the viewer. */
export async function setFollowing(
  postId: string,
  following: boolean,
  csrfToken: string,
): Promise<boolean> {
  const payload = await receive<{ data: { following: boolean } }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/follow`, {
      method: following ? "PUT" : "DELETE",
      credentials: "include",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    }),
  );
  return payload.data.following;
}

/** Marks every post in the course read for the viewer. */
export async function markCourseRead(
  courseId: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/read-marks`,
    {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    },
  );
  if (!response.ok) await receive<never>(response);
}

/** Casts or changes the viewer's single vote on a poll. */
export async function votePoll(
  postId: string,
  optionId: string,
  csrfToken: string,
): Promise<PollState & { postId: string }> {
  const payload = await receive<{ data: PollState & { postId: string } }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/vote`, {
      method: "PUT",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ optionId }),
    }),
  );
  return payload.data;
}

export async function retractVote(
  postId: string,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/posts/${encodeURIComponent(postId)}/vote`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    },
  );
  if (!response.ok) await receive<never>(response);
}

export async function createPost(
  courseId: string,
  input: CreatePostInput,
  csrfToken: string,
  idempotencyKey: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}/posts`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    }),
  );
  return payload.data;
}
