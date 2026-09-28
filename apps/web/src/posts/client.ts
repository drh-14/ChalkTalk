import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";

export type Post = {
  id: string;
  courseId: string;
  type: "question" | "note";
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
  createdAt: string;
  lastActivityAt: string;
  version: number;
  duplicateStatus?: "none" | "suggested" | "confirmed";
  duplicateOfPostId?: string | null;
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
  type: "question" | "note";
  title: string;
  bodyMarkdown: string;
  anonymous: boolean;
  tags: string[];
};
export type PostListOptions = {
  q?: string;
  sort?: "relevance";
  cursor?: string;
  type?: "question";
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
  if (options.sort) query.set("sort", options.sort);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.type) query.set("type", options.type);
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
