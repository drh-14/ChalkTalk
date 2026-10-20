import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";

export const SESSION_LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "sql", label: "SQL" },
] as const;
export type SessionLanguage = (typeof SESSION_LANGUAGES)[number]["value"];

const TAG_LANGUAGES: Record<string, SessionLanguage> = {
  python: "python",
  py: "python",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  sql: "sql",
};

/** The first post tag that names a session language, else plain text. */
export function languageFromTags(tags: readonly string[]): SessionLanguage {
  for (const tag of tags) {
    const language = TAG_LANGUAGES[tag.trim().toLowerCase()];
    if (language) return language;
  }
  return "plaintext";
}

export type SessionParticipant = {
  userId: string;
  displayName: string;
  role: "creator" | "invitee";
};
export type CodeSession = {
  id: string;
  courseId: string;
  status: "active" | "ended";
  anchor: { postId: string };
  title: string;
  language: SessionLanguage;
  createdBy: string;
  participants: SessionParticipant[];
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type Versioned<T> = { data: T; etag: string };
export type ConnectionTicket = {
  ticket: string;
  webSocketUrl: string;
  documentId: string;
  expiresAt: string;
};
export type SessionSnapshot = {
  collaborationSessionId: string;
  documentId: string;
  sessionStatus: "active" | "ended";
  content: string;
  /** Excalidraw elements, non-deleted, in drawing order. */
  whiteboard: ({ id: string; type: string } & Record<string, unknown>)[];
  persistedAt: string;
  capturedAt: string;
};

async function receive<T>(response: Response): Promise<T> {
  const payload =
    response.status === 204
      ? {}
      : ((await response.json()) as {
          error?: { code?: string; message?: string; requestId?: string };
        });
  if (!response.ok) {
    const error = (
      payload as {
        error?: { code?: string; message?: string; requestId?: string };
      }
    ).error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "Something went wrong. Please try again.",
      error?.requestId,
    );
  }
  return payload as T;
}

const read = (path: string, signal?: AbortSignal) =>
  fetch(path, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

function write(
  method: string,
  path: string,
  csrfToken: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(path, {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-Token": csrfToken,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function versioned(response: Response): Promise<Versioned<CodeSession>> {
  const payload = await receive<{ data: CodeSession }>(response);
  return {
    data: payload.data,
    etag: response.headers.get("ETag") ?? `"v${payload.data.version}"`,
  };
}

const sessionPath = (sessionId: string) =>
  `/api/v1/collaboration-sessions/${encodeURIComponent(sessionId)}`;

export async function listSessions(
  courseId: string,
  options: {
    postId?: string;
    status?: "active" | "ended";
    cursor?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Page<CodeSession>> {
  const query = new URLSearchParams();
  if (options.postId) {
    query.set("anchorType", "post");
    query.set("anchorId", options.postId);
  }
  if (options.status) query.set("status", options.status);
  if (options.cursor) query.set("cursor", options.cursor);
  const suffix = query.size ? `?${query}` : "";
  return receive<Page<CodeSession>>(
    await read(
      `/api/v1/courses/${encodeURIComponent(courseId)}/collaboration-sessions${suffix}`,
      options.signal,
    ),
  );
}

export async function createSession(
  courseId: string,
  input: { postId: string; language: SessionLanguage; title?: string },
  csrfToken: string,
): Promise<Versioned<CodeSession>> {
  return versioned(
    await write(
      "POST",
      `/api/v1/courses/${encodeURIComponent(courseId)}/collaboration-sessions`,
      csrfToken,
      {
        anchor: { postId: input.postId },
        language: input.language,
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      },
      { "Idempotency-Key": crypto.randomUUID() },
    ),
  );
}

export async function getSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<Versioned<CodeSession>> {
  return versioned(await read(sessionPath(sessionId), signal));
}

export async function updateSession(
  sessionId: string,
  change: { language?: SessionLanguage; title?: string } | { status: "ended" },
  etag: string,
  csrfToken: string,
): Promise<Versioned<CodeSession>> {
  return versioned(
    await write("PATCH", sessionPath(sessionId), csrfToken, change, {
      "If-Match": etag,
    }),
  );
}

export async function inviteParticipant(
  sessionId: string,
  userId: string,
  csrfToken: string,
): Promise<Versioned<CodeSession>> {
  return versioned(
    await write("POST", `${sessionPath(sessionId)}/participants`, csrfToken, {
      userId,
    }),
  );
}

export async function removeParticipant(
  sessionId: string,
  userId: string,
  csrfToken: string,
): Promise<void> {
  await receive(
    await write(
      "DELETE",
      `${sessionPath(sessionId)}/participants/${encodeURIComponent(userId)}`,
      csrfToken,
    ),
  );
}

export async function createTicket(
  sessionId: string,
  csrfToken: string,
): Promise<ConnectionTicket> {
  const payload = await receive<{ data: ConnectionTicket }>(
    await write(
      "POST",
      `${sessionPath(sessionId)}/connection-tickets`,
      csrfToken,
    ),
  );
  return payload.data;
}

export async function getSnapshot(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionSnapshot> {
  const payload = await receive<{ data: SessionSnapshot }>(
    await read(`${sessionPath(sessionId)}/snapshot`, signal),
  );
  return payload.data;
}

export const sessionRoute = (courseId: string, sessionId: string) =>
  `/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}`;
