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
  onOpenPost: (courseId: string, postId?: string, hash?: string) => void;
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelGeneration = useRef(0);
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
    const generation = ++panelGeneration.current;
    setItems(undefined);
    setNextCursor(null);
    setLoadingMore(false);
    setError(undefined);
    void listNotifications({ signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || generation !== panelGeneration.current)
          return;
        setItems(page.data);
        setNextCursor(page.page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (
          !controller.signal.aborted &&
          generation === panelGeneration.current
        )
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
      panelGeneration.current = generation + 1;
      controller.abort();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, refreshCount, reload]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const generation = panelGeneration.current;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await listNotifications({ cursor: nextCursor });
      if (generation !== panelGeneration.current) return;
      setItems((current) => {
        const seen = new Set(current?.map((item) => item.id));
        return [
          ...(current ?? []),
          ...page.data.filter((item) => !seen.has(item.id)),
        ];
      });
      setNextCursor(page.page.nextCursor);
    } catch (caught) {
      if (generation !== panelGeneration.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Notifications could not be loaded.",
      );
    } finally {
      if (generation === panelGeneration.current) setLoadingMore(false);
    }
  }

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
      const destination = item.destination;
      if (destination.kind === "course") onOpenPost(destination.courseId);
      else if (destination.kind === "answer" || destination.kind === "followup")
        onOpenPost(
          item.courseId,
          destination.postId,
          `#${destination.kind}-${destination.responseId}`,
        );
      else onOpenPost(item.courseId, destination.postId);
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
          {error && (
            <p className="form-message error" role="alert">
              {error}
            </p>
          )}
          {error && !items && (
            <button
              type="button"
              className="notification-load-more"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry
            </button>
          )}
          {!items && !error ? (
            <p className="notification-empty" aria-live="polite">
              Loading…
            </p>
          ) : !items ? null : items.length === 0 ? (
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
                        {item.kind === "thread_reply_created" ? (
                          <strong>{item.threadTitle}</strong>
                        ) : (
                          item.postTitle && <strong>{item.postTitle}</strong>
                        )}
                      </span>
                      {(item.kind === "thread_reply_created"
                        ? item.preview
                        : item.preview || item.responseUnavailable) && (
                        <span className="notification-preview">
                          {item.kind !== "thread_reply_created" && item.responseUnavailable
                            ? "Response no longer available"
                            : item.preview}
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
          {items && nextCursor && (
            <button
              type="button"
              className="notification-load-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
