import { ApiError } from "../auth/client.js";

export type Attachment = {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
};
export type ThreadBoard = {
  id: string;
  courseId: string;
  title: string;
  unreadCount?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ThreadMessage = {
  id: string;
  conversationId: string;
  bodyMarkdown?: string;
  author?: { id: string; displayName: string } | null;
  authorRoleAtPosting?: "student" | "ta" | "instructor";
  attachments?: Attachment[];
  deleted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Conversation = {
  id: string;
  threadId: string;
  version: number;
  canDelete: boolean;
  openingMessage: ThreadMessage;
  unreadCount?: number;
  createdAt: string;
  updatedAt: string;
};
export type Page<T> = {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
};
export type Watch = { watching: boolean; noticesEnabled: boolean };

const base = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}/threads`;
const boardPath = (courseId: string, boardId: string) =>
  `${base(courseId)}/${encodeURIComponent(boardId)}`;
const conversationPath = (
  courseId: string,
  boardId: string,
  conversationId: string,
) =>
  `${boardPath(courseId, boardId)}/conversations/${encodeURIComponent(conversationId)}`;

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Threads are unavailable. Please try again.",
    );
  return payload as T;
}
function mutation(
  method: string,
  csrfToken: string,
  body?: object,
  version?: number,
  idempotencyKey?: string,
): RequestInit {
  return {
    method,
    headers: {
      "X-CSRF-Token": csrfToken,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST"
        ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }
        : {}),
      ...(version ? { "If-Match": `"v${version}"` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };
}
const cursorPath = (path: string, cursor?: string) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

export const listBoards = (
  courseId: string,
  cursor?: string,
  signal?: AbortSignal,
) => send<Page<ThreadBoard>>(cursorPath(base(courseId), cursor), { signal });
export const getBoard = (
  courseId: string,
  boardId: string,
  signal?: AbortSignal,
) =>
  send<{ data: ThreadBoard }>(boardPath(courseId, boardId), { signal }).then(
    (v) => v.data,
  );
export const createBoard = (
  courseId: string,
  title: string,
  csrfToken: string,
  idempotencyKey: string,
) =>
  send<{ data: ThreadBoard }>(
    base(courseId),
    mutation("POST", csrfToken, { title }, undefined, idempotencyKey),
  ).then((v) => v.data);
export const renameBoard = (
  courseId: string,
  board: ThreadBoard,
  title: string,
  csrfToken: string,
) =>
  send<{ data: ThreadBoard }>(
    boardPath(courseId, board.id),
    mutation("PATCH", csrfToken, { title }, board.version),
  ).then((v) => v.data);
export const deleteBoard = (
  courseId: string,
  board: ThreadBoard,
  csrfToken: string,
) =>
  send<void>(
    boardPath(courseId, board.id),
    mutation("DELETE", csrfToken, undefined, board.version),
  );
export const listConversations = (
  courseId: string,
  boardId: string,
  cursor?: string,
  signal?: AbortSignal,
) =>
  send<Page<Conversation>>(
    cursorPath(`${boardPath(courseId, boardId)}/conversations`, cursor),
    { signal },
  );
export const createConversation = (
  courseId: string,
  boardId: string,
  bodyMarkdown: string,
  csrfToken: string,
  idempotencyKey: string,
) =>
  send<{ data: Conversation; openingMessage?: ThreadMessage }>(
    `${boardPath(courseId, boardId)}/conversations`,
    mutation("POST", csrfToken, { bodyMarkdown }, undefined, idempotencyKey),
  ).then((v) => v.data);
export const getConversation = (
  courseId: string,
  boardId: string,
  conversationId: string,
  signal?: AbortSignal,
) =>
  send<{ data: Conversation }>(
    conversationPath(courseId, boardId, conversationId),
    { signal },
  ).then((v) => v.data);
export const deleteConversation = (
  courseId: string,
  boardId: string,
  conversation: Conversation,
  csrfToken: string,
) =>
  send<void>(
    conversationPath(courseId, boardId, conversation.id),
    mutation("DELETE", csrfToken, undefined, conversation.version),
  );
export const listMessages = (
  courseId: string,
  boardId: string,
  conversationId: string,
  cursor?: string,
  signal?: AbortSignal,
) =>
  send<Page<ThreadMessage>>(
    cursorPath(
      `${conversationPath(courseId, boardId, conversationId)}/messages`,
      cursor,
    ),
    { signal },
  );
export const getMessage = (
  courseId: string,
  boardId: string,
  conversationId: string,
  messageId: string,
) =>
  send<{ data: ThreadMessage }>(
    `${conversationPath(courseId, boardId, conversationId)}/messages/${encodeURIComponent(messageId)}`,
  ).then((v) => v.data);
export const createReply = (
  courseId: string,
  boardId: string,
  conversationId: string,
  bodyMarkdown: string,
  csrfToken: string,
  idempotencyKey: string,
) =>
  send<{ data: ThreadMessage }>(
    `${conversationPath(courseId, boardId, conversationId)}/messages`,
    mutation("POST", csrfToken, { bodyMarkdown }, undefined, idempotencyKey),
  ).then((v) => v.data);
export const editMessage = (
  courseId: string,
  boardId: string,
  conversationId: string,
  message: ThreadMessage,
  bodyMarkdown: string,
  csrfToken: string,
) =>
  send<{ data: ThreadMessage }>(
    `${conversationPath(courseId, boardId, conversationId)}/messages/${encodeURIComponent(message.id)}`,
    mutation("PATCH", csrfToken, { bodyMarkdown }, message.version),
  ).then((v) => v.data);
export const deleteMessage = (
  courseId: string,
  boardId: string,
  conversationId: string,
  message: ThreadMessage,
  csrfToken: string,
) =>
  send<void>(
    `${conversationPath(courseId, boardId, conversationId)}/messages/${encodeURIComponent(message.id)}`,
    mutation("DELETE", csrfToken, undefined, message.version),
  );
export const readWatch = (
  courseId: string,
  boardId: string,
  conversationId: string,
) =>
  send<{ data: Watch }>(
    `${conversationPath(courseId, boardId, conversationId)}/watch`,
  ).then((v) => v.data);
export const setNotices = (
  courseId: string,
  boardId: string,
  conversationId: string,
  noticesEnabled: boolean,
  csrfToken: string,
) =>
  send<{ data: Watch }>(
    `${conversationPath(courseId, boardId, conversationId)}/watch`,
    mutation("PUT", csrfToken, { noticesEnabled }),
  ).then((v) => v.data);
export const markRead = (
  courseId: string,
  boardId: string,
  conversationId: string,
  messageIds: string[],
  csrfToken: string,
) =>
  send<void>(
    `${conversationPath(courseId, boardId, conversationId)}/read`,
    mutation("POST", csrfToken, { messageIds }),
  );
export const unreadCount = (courseId: string) =>
  send<{ data: { count: number } }>(`${base(courseId)}/unread-count`).then(
    (v) => v.data.count,
  );
export async function uploadAttachment(
  messageId: string,
  file: File,
  csrfToken: string,
  idempotencyKey: string,
) {
  const body = new FormData();
  body.append("file", file);
  const result = await send<{ data: Attachment }>(
    `/api/v1/thread-messages/${encodeURIComponent(messageId)}/attachments`,
    {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body,
    },
  );
  return result.data;
}
export const removeAttachment = (attachmentId: string, csrfToken: string) =>
  send<void>(
    `/api/v1/thread-attachments/${encodeURIComponent(attachmentId)}`,
    mutation("DELETE", csrfToken),
  );
