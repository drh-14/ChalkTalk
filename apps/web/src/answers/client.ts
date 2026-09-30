import { ApiError } from "../auth/client.js";

export type Answer = {
  id: string;
  postId: string;
  kind: "student" | "staff";
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
};
export type CreateAnswerInput = { bodyMarkdown: string; anonymous: boolean };

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

export async function listAnswers(
  postId: string,
  signal?: AbortSignal,
): Promise<Answer[]> {
  return receive<Answer[]>(
    await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/answers`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
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
