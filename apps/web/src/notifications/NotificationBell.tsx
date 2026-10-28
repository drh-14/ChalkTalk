import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatPostTime } from "../posts/time.js";
import {
  describeNotification,
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
  type Notification,
} from "./client.js";

/** How often the unread count refreshes while the page is visible. */
export const NOTIFICATION_POLL_MS = 60_000;

export function NotificationBell({
  csrfToken,
  onOpenPost,
  onOpenThread,
}: {
  csrfToken: string;
  onOpenPost: (courseId: string, postId: string) => void;
  onOpenThread: (
    courseId: string,
    threadId: string,
    conversationId: string,
    messageId: string,
    notificationId: string,
  ) => void;
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>();
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const refreshCount = useCallback(() => {
    void unreadNotificationCount()
      .then(setCount)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") refreshCount();
    }, NOTIFICATION_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    window.addEventListener("focus", refreshCount);
    window.addEventListener("chalktalk:notifications-changed", refreshCount);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshCount);
      window.removeEventListener(
        "chalktalk:notifications-changed",
        refreshCount,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(undefined);
    void listNotifications({ signal: controller.signal })
      .then((page) => setItems(page.data))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Notifications could not be loaded.",
          );
      });
    refreshCount();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      controller.abort();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, refreshCount]);

  async function choose(item: Notification) {
    setOpen(false);
    if (!item.readAt && item.kind !== "thread_reply_created") {
      setCount((value) => Math.max(0, value - 1));
      try {
        await markNotificationsRead(csrfToken, [item.id]);
      } catch {
        // Opening the post marks it read as well.
      }
    }
    if (item.kind === "thread_reply_created") {
      onOpenThread(
        item.courseId,
        item.threadId,
        item.conversationId,
        item.messageId,
        item.id,
      );
    } else {
      onOpenPost(item.courseId, item.postId);
    }
  }

  async function markAll() {
    try {
      await markNotificationsRead(csrfToken);
      const now = new Date().toISOString();
      setItems((value) =>
        value?.map((item) => ({ ...item, readAt: item.readAt ?? now })),
      );
      setCount(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
    }
  }

  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <div className="notification-bell" ref={root}>
      <button
        ref={button}
        type="button"
        className="notification-bell-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M6 9a6 6 0 1 1 12 0c0 4.5 2 6 2 6H4s2-1.5 2-6Zm4 9a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {count > 0 && (
          <span className="notification-count" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="notification-panel"
          id={panelId}
          role="region"
          aria-label="Notifications"
        >
          <div className="notification-panel-head">
            <h2>Notifications</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => void markAll()}
              disabled={!items?.some((item) => !item.readAt)}
            >
              Mark all read
            </button>
          </div>
          {error ? (
            <p className="form-message error" role="alert">
              {error}
            </p>
          ) : !items ? (
            <p className="notification-empty" aria-live="polite">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="notification-empty">
              Nothing yet. Activity on posts you follow shows up here.
            </p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => {
                const time = formatPostTime(item.createdAt);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`notification-item${item.readAt ? "" : " unread"}`}
                      onClick={() => void choose(item)}
                    >
                      <span className="notification-text">
                        {describeNotification(item)}{" "}
                        <strong>
                          {item.kind === "thread_reply_created"
                            ? item.threadTitle
                            : item.postTitle}
                        </strong>
                      </span>
                      {item.kind === "thread_reply_created" && item.preview && (
                        <span className="notification-preview">
                          {item.preview}
                        </span>
                      )}
                      <span className="notification-meta">
                        {item.courseName}
                        {time && (
                          <>
                            {" · "}
                            <time dateTime={time.dateTime} title={time.title}>
                              {time.label}
                            </time>
                          </>
                        )}
                        {!item.readAt && (
                          <span className="visually-hidden">, unread</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
