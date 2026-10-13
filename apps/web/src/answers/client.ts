import { ApiError } from "../auth/client.js";

export type Answer = {
  id: string;
  postId: string;
  deleted: false;
  bodyMarkdown: string;
  contributors: { id: string; displayName: string }[] | null;
  anonymous: boolean;
  attachments: [];
  endorsedAt: string | null;
  endorsedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  upvoteCount: number;
  viewerUpvoted: boolean;
};
export type CreateAnswerInput = { bodyMarkdown: string; anonymous: boolean };
export type Followup = {
  id: string;
  postId: string;
  parentId: string | null;
  author: { id: string; displayName: string } | null;
  anonymous: boolean;
  bodyMarkdown: string | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  upvoteCount: number;
  viewerUpvoted: boolean;
  replyCount: number;
};
export type FollowupPage = {
  data: Followup[];
  meta: { total: number; nextCursor: string | null };
};

async function receive<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as {
    data?: T;
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Something went wrong. Please try again.",
      payload.error?.requestId,
    );
  return payload.data as T;
}
const conditional = (answer: Answer, csrfToken: string) => ({
  Accept: "application/json",
  "X-CSRF-Token": csrfToken,
  "If-Match": `"v${answer.version}"`,
});
const writeHeaders = (csrfToken: string) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-CSRF-Token": csrfToken,
});
const voteHeaders = (csrfToken: string) => ({
  Accept: "application/json",
  "X-CSRF-Token": csrfToken,
});

export async function listAnswers(
  postId: string,
  signal?: AbortSignal,
): Promise<Answer[]> {
  const data = await receive<Answer[]>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/answers`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    }),
  );
  if (
    !Array.isArray(data) ||
    data.some(
      (item) =>
        !item ||
        (!Array.isArray(item.contributors) && item.contributors !== null) ||
        typeof item.bodyMarkdown !== "string",
    )
  )
    throw new Error("Answer response is invalid");
  return data;
}
export async function getAnswer(id: string): Promise<Answer> {
  return receive<Answer>(
    await fetch(`/api/v1/answers/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
  );
}

export async function createAnswer(
  postId: string,
  input: CreateAnswerInput,
  csrfToken: string,
  idempotencyKey: string,
): Promise<Answer> {
  return receive<Answer>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/answers`, {
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
}

export async function endorseAnswer(
  answer: Answer,
  csrfToken: string,
): Promise<Answer> {
  return receive<Answer>(
    await fetch(
      `/api/v1/answers/${encodeURIComponent(answer.id)}/endorsement`,
      {
        method: "PUT",
        credentials: "include",
        headers: conditional(answer, csrfToken),
      },
    ),
  );
}

export async function deleteAnswer(
  answer: Answer,
  csrfToken: string,
): Promise<void> {
  await receive<void>(
    await fetch(`/api/v1/answers/${encodeURIComponent(answer.id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: conditional(answer, csrfToken),
    }),
  );
}

export async function editAnswer(
  answer: Answer,
  bodyMarkdown: string,
  csrfToken: string,
): Promise<Answer> {
  return receive<Answer>(
    await fetch(`/api/v1/answers/${encodeURIComponent(answer.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        ...conditional(answer, csrfToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bodyMarkdown }),
    }),
  );
}
export async function voteAnswer(
  answer: Answer,
  enabled: boolean,
  csrfToken: string,
): Promise<Answer> {
  return receive<Answer>(
    await fetch(`/api/v1/answers/${encodeURIComponent(answer.id)}/upvote`, {
      method: enabled ? "PUT" : "DELETE",
      credentials: "include",
      headers: voteHeaders(csrfToken),
    }),
  );
}
export async function listFollowups(
  postId: string,
  parentId?: string,
  cursor?: string,
): Promise<FollowupPage> {
  const base = parentId
    ? `/api/v1/followups/${encodeURIComponent(parentId)}/replies`
    : `/api/v1/posts/${encodeURIComponent(postId)}/followups`;
  const url = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as FollowupPage & {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Something went wrong.",
      payload.error?.requestId,
    );
  if (
    !Array.isArray(payload.data) ||
    !payload.meta ||
    typeof payload.meta.total !== "number" ||
    payload.data.some((item) => !item || typeof item.version !== "number")
  )
    throw new Error("Followup response is invalid");
  return payload;
}
export async function getFollowup(id: string): Promise<Followup> {
  return receive<Followup>(
    await fetch(`/api/v1/followups/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
  );
}
export async function createFollowup(
  postId: string,
  input: CreateAnswerInput,
  csrfToken: string,
  key: string,
  parentId?: string,
): Promise<Followup> {
  const url = parentId
    ? `/api/v1/followups/${encodeURIComponent(parentId)}/replies`
    : `/api/v1/posts/${encodeURIComponent(postId)}/followups`;
  return receive<Followup>(
    await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { ...writeHeaders(csrfToken), "Idempotency-Key": key },
      body: JSON.stringify(input),
    }),
  );
}
export async function editFollowup(
  item: Followup,
  bodyMarkdown: string,
  csrfToken: string,
): Promise<Followup> {
  return receive<Followup>(
    await fetch(`/api/v1/followups/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { ...writeHeaders(csrfToken), "If-Match": `"v${item.version}"` },
      body: JSON.stringify({ bodyMarkdown }),
    }),
  );
}
export async function deleteFollowup(
  item: Followup,
  csrfToken: string,
): Promise<void> {
  await receive<void>(
    await fetch(`/api/v1/followups/${encodeURIComponent(item.id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: { ...voteHeaders(csrfToken), "If-Match": `"v${item.version}"` },
    }),
  );
}
export async function voteFollowup(
  item: Followup,
  enabled: boolean,
  csrfToken: string,
): Promise<Followup> {
  return receive<Followup>(
    await fetch(`/api/v1/followups/${encodeURIComponent(item.id)}/upvote`, {
      method: enabled ? "PUT" : "DELETE",
      credentials: "include",
      headers: voteHeaders(csrfToken),
    }),
  );
}
