import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";
import type { Attachment } from "../attachments/client.js";

export type PollOption = {
  id: string;
  label: string;
  voteCount?: number;
  /** Whether the viewer chose this option. */
  selected: boolean;
};
export type PollState = {
  options: PollOption[];
  totalVotes?: number;
  selectionMode?: "single" | "multiple";
  maxSelections?: number;
  closesAt?: string | null;
  closed?: boolean;
  releaseMode?: "live" | "manual" | "automatic";
  resultsReleased?: boolean;
  explanation?: string | null;
};
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
  selectionMode?: PollState["selectionMode"];
  maxSelections?: number;
  closesAt?: string | null;
  closed?: boolean;
  releaseMode?: PollState["releaseMode"];
  resultsReleased?: boolean;
  explanation?: string | null;
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
  selectionMode?: PollState["selectionMode"];
  maxSelections?: number;
  closesAt?: string | null;
  releaseMode?: PollState["releaseMode"];
  explanation?: string;
  announcement?: boolean;
  private?: boolean;
  draftVersion?: number;
};
export type PostDraftContent = {
  type: "question" | "note" | "poll";
  title: string;
  bodyMarkdown: string;
  anonymous: boolean;
  tags: string[];
  options?: string[];
  announcement?: boolean;
  private?: boolean;
};
export type PostDraft = {
  courseId: string;
  content: PostDraftContent | null;
  updatedAt: string | null;
  version: number;
};
export type DraftRevision = { draft: PostDraft; etag: string };
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

function postListParams(options: PostListOptions): URLSearchParams {
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
  return query;
}

export async function listPosts(
  courseId: string,
  options: PostListOptions = {},
): Promise<Page<Post> & { snapshot?: string }> {
  const query = postListParams(options);
  const suffix = query.size ? `?${query}` : "";
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/posts${suffix}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: options.signal,
    },
  );
  return {
    ...(await receive<Page<Post>>(response)),
    snapshot: response.headers.get("X-Feed-Snapshot") ?? undefined,
  };
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

/** Deletes an authorized post using the version last shown to the viewer. */
export async function deletePost(
  post: Pick<Post, "id" | "version">,
  csrfToken: string,
): Promise<void> {
  const response = await fetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
      "If-Match": `"v${post.version}"`,
    },
  });
  if (!response.ok) await receive<never>(response);
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

export async function countNewPosts(
  courseId: string,
  snapshot: string,
  options: PostListOptions = {},
): Promise<number> {
  const query = new URLSearchParams();
  query.set("snapshot", snapshot);
  for (const [key, value] of postListParams(options)) query.append(key, value);
  const payload = await receive<{ data: { count: number } }>(
    await fetch(
      `/api/v1/courses/${encodeURIComponent(courseId)}/posts/new-count?${query}`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: options.signal,
      },
    ),
  );
  return payload.data.count;
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

/** Replaces the viewer's ballot on a poll. */
export async function votePoll(
  postId: string,
  optionIds: string | string[],
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
      body: JSON.stringify(
        typeof optionIds === "string" ? { optionId: optionIds } : { optionIds },
      ),
    }),
  );
  return payload.data;
}

export async function changePollLifecycle(
  postId: string,
  action: "close" | "reopen" | "release",
  version: number,
  csrfToken: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/${action}`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": `"v${version}"`,
      },
    }),
  );
  return payload.data;
}

export async function clonePoll(
  postId: string,
  csrfToken: string,
): Promise<Post> {
  const payload = await receive<{ data: Post }>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/clone`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    }),
  );
  return payload.data;
}

export async function exportPollResults(postId: string): Promise<Blob> {
  const response = await fetch(
    `/api/v1/posts/${encodeURIComponent(postId)}/poll-results.csv`,
    {
      credentials: "include",
      headers: { Accept: "text/csv" },
    },
  );
  if (!response.ok) await receive<never>(response);
  return response.blob();
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

const draftPath = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}/post-draft`;

async function draftRevision(response: Response): Promise<DraftRevision> {
  const payload = await receive<{ data: PostDraft }>(response);
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Draft response has no version.");
  return { draft: payload.data, etag };
}

export async function getPostDraft(courseId: string): Promise<DraftRevision> {
  return draftRevision(
    await fetch(draftPath(courseId), {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
  );
}

export async function updatePostDraft(
  courseId: string,
  etag: string,
  content: PostDraftContent,
  csrfToken: string,
): Promise<DraftRevision> {
  return draftRevision(
    await fetch(draftPath(courseId), {
      method: "PUT",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": etag,
      },
      body: JSON.stringify({ content }),
    }),
  );
}

export async function deletePostDraft(
  courseId: string,
  etag: string,
  csrfToken: string,
): Promise<DraftRevision> {
  return draftRevision(
    await fetch(draftPath(courseId), {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": etag,
      },
    }),
  );
}
