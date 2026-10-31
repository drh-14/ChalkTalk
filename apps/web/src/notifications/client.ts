import { ApiError } from "../auth/client.js";
import type { Page } from "../courses/client.js";

export type NotificationKind =
  | "answer_created"
  | "answer_edited"
  | "answer_endorsed"
  | "followup_created"
  | "reply_created"
  | "announcement"
  | "post_published"
  | "mentioned"
  | "post_staff_edited"
  | "post_merged"
  | "post_staff_deleted";
export type Notification = {
  id: string;
  kind: NotificationKind;
  courseId: string;
  courseName: string;
  postId: string;
  postTitle: string | null;
  preview?: string | null;
  responseUnavailable?: boolean;
  addressedToOwner?: boolean;
  destination:
    | { kind: "course"; courseId: string }
    | { kind: "post"; postId: string }
    | { kind: "answer" | "followup"; postId: string; responseId: string };
  /** "Anonymous" for a hidden actor; null for a deleted account. */
  actor: { displayName: string } | null;
  createdAt: string;
  readAt: string | null;
};

async function receive<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as T & {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Something went wrong. Please try again.",
      payload.error?.requestId,
    );
  return payload;
}

export async function listNotifications(
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<Page<Notification>> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.cursor) query.set("cursor", options.cursor);
  return receive<Page<Notification>>(
    await fetch(`/api/v1/users/me/notifications?${query}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: options.signal,
    }),
  );
}

export async function unreadNotificationCount(
  signal?: AbortSignal,
): Promise<number> {
  const payload = await receive<{ data: { count: number } }>(
    await fetch("/api/v1/users/me/notifications/unread-count", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    }),
  );
  return payload.data.count;
}

/** Marks the given notifications, or all of them when ids is omitted, read. */
export async function markNotificationsRead(
  csrfToken: string,
  ids?: string[],
): Promise<void> {
  await receive<void>(
    await fetch("/api/v1/users/me/notifications/read", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        ...(ids ? { "Content-Type": "application/json" } : {}),
      },
      ...(ids ? { body: JSON.stringify({ ids }) } : {}),
    }),
  );
}

const VERBS: Record<NotificationKind, string> = {
  answer_created: "answered",
  answer_edited: "updated the answer to",
  answer_endorsed: "endorsed an answer to",
  followup_created: "posted a followup on",
  reply_created: "replied on",
  announcement: "announced",
  post_published: "made your post public:",
  mentioned: "mentioned you on",
  post_staff_edited: "edited your post:",
  post_merged: "marked your question as a duplicate:",
  post_staff_deleted: "deleted your post",
};

/** "Grace Hopper answered" style lead-in for a notification. */
export function describeNotification(notification: Notification): string {
  const actor =
    notification.actor?.displayName ??
    (notification.kind.startsWith("post_")
      ? "A course staff member"
      : "Deleted user");
  if (
    notification.addressedToOwner &&
    ["answer_created", "followup_created", "reply_created"].includes(
      notification.kind,
    )
  )
    return `${actor} replied to your message`;
  return `${actor} ${VERBS[notification.kind]}`;
}
