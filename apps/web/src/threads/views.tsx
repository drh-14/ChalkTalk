import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { PostBody } from "../posts/PostBody.js";
import { markNotificationsRead } from "../notifications/client.js";
import {
  createBoard,
  createConversation,
  createReply,
  deleteBoard,
  deleteMessage,
  editMessage,
  getBoard,
  getMessage,
  listBoards,
  listConversations,
  listMessages,
  markRead,
  readWatch,
  renameBoard,
  setNotices,
  uploadAttachment,
  unreadCount,
  type Conversation,
  type ThreadBoard,
  type ThreadMessage,
  type Watch,
} from "./client.js";
import "./styles.css";

type Props = {
  courseId: string;
  boardId?: string;
  conversationId?: string;
  userId: string;
  staff: boolean;
  active: boolean;
  csrfToken: string;
  onNavigate: (path: string) => void;
  onUnreadChange?: (count: number) => void;
  signalVersion: number;
  onSignalSettled: (version: number, error?: Error) => void;
  live: {
    connected: boolean;
    typing: (active: boolean) => void;
    stopTyping: () => void;
  };
  typingNames: string[];
};
const err = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
const boardUrl = (
  courseId: string,
  boardId?: string,
  conversationId?: string,
) =>
  `/courses/${encodeURIComponent(courseId)}/threads${boardId ? `/${encodeURIComponent(boardId)}` : ""}${conversationId ? `/conversations/${encodeURIComponent(conversationId)}` : ""}`;
const pageLink = (
  event: MouseEvent<HTMLAnchorElement>,
  to: string,
  onNavigate: Props["onNavigate"],
) => {
  if (
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  onNavigate(to);
};

export function CourseThreads(props: Props) {
  const {
    courseId,
    boardId,
    conversationId,
    userId,
    staff,
    active,
    csrfToken,
    onNavigate,
    onUnreadChange,
    signalVersion,
    onSignalSettled,
    live,
    typingNames,
  } = props;
  const [boards, setBoards] = useState<ThreadBoard[]>([]);
  const [board, setBoard] = useState<ThreadBoard>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [boardCursor, setBoardCursor] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(
    null,
  );
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [watch, setWatch] = useState<Watch>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedLookup = useRef<string | null>(null);
  const openedConversation = useRef<string | null>(null);
  const clearedNotice = useRef<string | null>(null);
  const refreshNow = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    selectedLookup.current = null;
    clearedNotice.current = null;
  }, [conversationId]);
  useEffect(() => {
    if (
      !conversationId ||
      !boardId ||
      loading ||
      !window.location.hash.startsWith("#thread-message-")
    )
      return;
    const id = window.location.hash.slice("#thread-message-".length);
    const message = messages.find((item) => item.id === id);
    if (!message) {
      if (selectedLookup.current === id) return;
      selectedLookup.current = id;
      void getMessage(courseId, boardId, conversationId, id)
        .then((item) => {
          setMessages((old) =>
            old.some((existing) => existing.id === item.id)
              ? old
              : [...old, item].sort((a, b) =>
                  a.createdAt.localeCompare(b.createdAt),
                ),
          );
          if (active && !item.deleted) {
            void markRead(
              courseId,
              boardId,
              conversationId,
              [item.id],
              csrfToken,
            )
              .then(() => unreadCount(courseId))
              .then((count) => onUnreadChange?.(count))
              .catch(() => {
                /* The target remains readable even if read marking fails. */
              });
          }
        })
        .catch((caught) => {
          selectedLookup.current = null;
          setError(err(caught));
        });
      return;
    }
    const target = document.getElementById(`thread-message-${id}`);
    target?.scrollIntoView({ block: "center" });
    target?.focus();
    const notificationId = new URLSearchParams(window.location.search).get(
      "notificationId",
    );
    if (
      !target ||
      message.deleted ||
      !notificationId ||
      clearedNotice.current === notificationId
    )
      return;
    clearedNotice.current = notificationId;
    void markNotificationsRead(csrfToken, [notificationId])
      .then(() =>
        window.dispatchEvent(new Event("chalktalk:notifications-changed")),
      )
      .catch(() => {
        clearedNotice.current = null;
      });
  }, [
    messages,
    conversationId,
    boardId,
    courseId,
    csrfToken,
    loading,
    active,
    onUnreadChange,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      listBoards(courseId, undefined, controller.signal),
      unreadCount(courseId),
    ])
      .then(async ([result, count]) => {
        if (controller.signal.aborted) return;
        setBoards(result.data);
        setBoardCursor(result.page?.nextCursor ?? null);
        onUnreadChange?.(count);
        const current = boardId
          ? (result.data.find((item) => item.id === boardId) ??
            (await getBoard(courseId, boardId, controller.signal)))
          : undefined;
        setBoard(current);
        if (!boardId) return;
        const listing = await listConversations(
          courseId,
          boardId,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setConversations(listing.data);
        setConversationCursor(listing.page?.nextCursor ?? null);
        if (!conversationId) return;
        const [page, currentWatch] = await Promise.all([
          listMessages(
            courseId,
            boardId,
            conversationId,
            undefined,
            controller.signal,
          ),
          readWatch(courseId, boardId, conversationId),
        ]);
        if (controller.signal.aborted) return;
        setMessages(page.data);
        setMessageCursor(page.page?.nextCursor ?? null);
        setWatch(currentWatch);
        const openingLoad = openedConversation.current !== conversationId;
        if (openingLoad) openedConversation.current = conversationId;
        const readableIds = page.data
          .filter((item) => !item.deleted)
          .map((item) => item.id);
        if (openingLoad && readableIds.length && active) {
          await markRead(
            courseId,
            boardId,
            conversationId,
            readableIds,
            csrfToken,
          );
          if (!controller.signal.aborted)
            onUnreadChange?.(await unreadCount(courseId));
        }
      })
      .then(() => {
        if (!controller.signal.aborted) onSignalSettled(signalVersion);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(err(caught));
          onSignalSettled(
            signalVersion,
            caught instanceof Error ? caught : new Error(err(caught)),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    courseId,
    boardId,
    conversationId,
    refresh,
    signalVersion,
    onSignalSettled,
    active,
    csrfToken,
    onUnreadChange,
  ]);

  async function loadMoreBoards() {
    if (!boardCursor) return;
    try {
      const page = await listBoards(courseId, boardCursor);
      setBoards((old) => [...old, ...page.data]);
      setBoardCursor(page.page.nextCursor);
    } catch (caught) {
      setError(err(caught));
    }
  }
  async function loadMoreConversations() {
    if (!boardId || !conversationCursor) return;
    try {
      const page = await listConversations(
        courseId,
        boardId,
        conversationCursor,
      );
      setConversations((old) => [...old, ...page.data]);
      setConversationCursor(page.page.nextCursor);
    } catch (caught) {
      setError(err(caught));
    }
  }
  async function loadMoreMessages() {
    if (!boardId || !conversationId || !messageCursor) return;
    try {
      const page = await listMessages(
        courseId,
        boardId,
        conversationId,
        messageCursor,
      );
      setMessages((old) => [...page.data, ...old]);
      setMessageCursor(page.page.nextCursor);
      const readableIds = page.data
        .filter((item) => !item.deleted)
        .map((item) => item.id);
      if (active && readableIds.length) {
        await markRead(
          courseId,
          boardId,
          conversationId,
          readableIds,
          csrfToken,
        );
        onUnreadChange?.(await unreadCount(courseId));
      }
    } catch (caught) {
      setError(err(caught));
    }
  }
  async function submitBoard(event: FormEvent) {
    event.preventDefault();
    if (!active || !staff || pending) return;
    if (
      Array.from(title.trim()).length < 1 ||
      Array.from(title.trim()).length > 200
    ) {
      setError("Thread title must be between 1 and 200 characters.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result =
        mode === "rename" && board
          ? await renameBoard(courseId, board, title.trim(), csrfToken)
          : await createBoard(courseId, title.trim(), csrfToken);
      setMode(null);
      setTitle("");
      if (mode === "rename") setBoard(result);
      refreshNow();
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function removeBoard() {
    if (!board || !staff || !active || pending) return;
    if (
      !window.confirm(
        `Delete “${board.title}” and all its conversations and files? This cannot be undone.`,
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      await deleteBoard(courseId, board, csrfToken);
      onNavigate(boardUrl(courseId));
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function submitConversation(event: FormEvent) {
    event.preventDefault();
    if (!boardId || !body.trim() || pending || !active) return;
    setPending(true);
    setError("");
    try {
      const result = await createConversation(
        courseId,
        boardId,
        body,
        csrfToken,
      );
      setBody("");
      onNavigate(boardUrl(courseId, boardId, result.id));
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!boardId || !conversationId || !reply.trim() || pending || !active)
      return;
    setPending(true);
    setError("");
    try {
      await createReply(courseId, boardId, conversationId, reply, csrfToken);
      setReply("");
      live.stopTyping();
      refreshNow();
      inputRef.current?.focus();
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function saveEdit(message: ThreadMessage) {
    if (!boardId || !conversationId || !editText.trim() || pending || !active)
      return;
    setPending(true);
    setError("");
    try {
      const updated = await editMessage(
        courseId,
        boardId,
        conversationId,
        message,
        editText,
        csrfToken,
      );
      setMessages((old) =>
        old.map((item) => (item.id === message.id ? updated : item)),
      );
      setEditing(null);
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function removeMessage(message: ThreadMessage) {
    if (!boardId || !conversationId || pending || !active) return;
    if (
      !window.confirm(
        "Delete this message and its attachments? This cannot be undone.",
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      await deleteMessage(
        courseId,
        boardId,
        conversationId,
        message,
        csrfToken,
      );
      refreshNow();
    } catch (caught) {
      setError(err(caught));
    } finally {
      setPending(false);
    }
  }
  async function upload(message: ThreadMessage, file?: File) {
    if (!file || !active) return;
    setUploading(message.id);
    setError("");
    try {
      await uploadAttachment(message.id, file, csrfToken);
      refreshNow();
    } catch (caught) {
      setError(`Message saved, but file upload failed: ${err(caught)}`);
    } finally {
      setUploading(null);
    }
  }
  async function toggleNotices() {
    if (!boardId || !conversationId || !watch || !active) return;
    try {
      setWatch(
        await setNotices(
          courseId,
          boardId,
          conversationId,
          !watch.noticesEnabled,
          csrfToken,
        ),
      );
    } catch (caught) {
      setError(err(caught));
    }
  }

  const crumbs = (
    <nav aria-label="Thread breadcrumbs" className="threads-crumbs">
      <a
        href={boardUrl(courseId)}
        onClick={(event) => pageLink(event, boardUrl(courseId), onNavigate)}
      >
        Threads
      </a>
      {board && (
        <>
          <span aria-hidden="true">/</span>
          <a
            href={boardUrl(courseId, board.id)}
            onClick={(event) =>
              pageLink(event, boardUrl(courseId, board.id), onNavigate)
            }
          >
            {board.title}
          </a>
        </>
      )}
      {conversationId && (
        <>
          <span aria-hidden="true">/</span>
          <span>Conversation</span>
        </>
      )}
    </nav>
  );
  return (
    <section className="threads-area" aria-label="Threads">
      {crumbs}
      <div className="threads-toolbar">
        <h2>{conversationId ? "Conversation" : (board?.title ?? "Threads")}</h2>
        <button type="button" className="button secondary" onClick={refreshNow}>
          Refresh
        </button>
        <span role="status" className="threads-connection">
          {live.connected ? "Live" : "Offline · refresh manually"}
        </span>
      </div>
      {!active && (
        <p className="form-message" role="status">
          This course is archived. Threads are read-only.
        </p>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}{" "}
          <button type="button" className="text-button" onClick={refreshNow}>
            Try again
          </button>
        </p>
      )}
      {loading && <p role="status">Loading Threads…</p>}
      {!boardId && (
        <>
          <div className="threads-list" aria-label="Public threads">
            {boards.map((item) => (
              <a
                key={item.id}
                className="threads-card"
                href={boardUrl(courseId, item.id)}
                onClick={(event) =>
                  pageLink(event, boardUrl(courseId, item.id), onNavigate)
                }
              >
                <h3>{item.title}</h3>
                {Boolean(item.unreadCount) && (
                  <span
                    className="threads-unread"
                    aria-label={`${item.unreadCount} unread messages`}
                  >
                    {item.unreadCount}
                  </span>
                )}
              </a>
            ))}
          </div>
          {!loading && !boards.length && <p>No threads yet.</p>}
          {boardCursor && (
            <button type="button" onClick={loadMoreBoards}>
              Load more threads
            </button>
          )}
          {staff && active && (
            <>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setTitle("");
                  setMode("create");
                }}
              >
                Create thread
              </button>
              {mode === "create" && (
                <form className="threads-form" onSubmit={submitBoard}>
                  <label>
                    Thread title
                    <input
                      autoFocus
                      required
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <div className="threads-actions">
                    <button className="button primary" disabled={pending}>
                      Create
                    </button>
                    <button type="button" onClick={() => setMode(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </>
      )}
      {boardId && board && !conversationId && (
        <>
          {staff && active && (
            <div className="threads-actions">
              <button
                type="button"
                onClick={() => {
                  setTitle(board.title);
                  setMode("rename");
                }}
              >
                Rename thread
              </button>
              <button type="button" className="danger" onClick={removeBoard}>
                Delete thread
              </button>
            </div>
          )}
          {mode === "rename" && (
            <form className="threads-form" onSubmit={submitBoard}>
              <label>
                Thread title
                <input
                  autoFocus
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="threads-actions">
                <button disabled={pending}>Save title</button>
                <button type="button" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="threads-list" aria-label="Conversations">
            {conversations.map((item) => (
              <a
                key={item.id}
                className="threads-card"
                href={boardUrl(courseId, boardId, item.id)}
                onClick={(event) =>
                  pageLink(
                    event,
                    boardUrl(courseId, boardId, item.id),
                    onNavigate,
                  )
                }
              >
                <div className="threads-excerpt">
                  <PostBody
                    bodyMarkdown={
                      item.openingMessage?.deleted
                        ? "Message deleted"
                        : (item.openingMessage?.bodyMarkdown ?? "Conversation")
                    }
                    inertLinks
                    disableImages
                  />
                </div>
                {Boolean(item.unreadCount) && (
                  <span
                    className="threads-unread"
                    aria-label={`${item.unreadCount} unread messages`}
                  >
                    {item.unreadCount}
                  </span>
                )}
              </a>
            ))}
          </div>
          {!loading && !conversations.length && (
            <p>No conversations yet. Start one below.</p>
          )}
          {conversationCursor && (
            <button type="button" onClick={loadMoreConversations}>
              Load more conversations
            </button>
          )}
          {active && (
            <form className="threads-form" onSubmit={submitConversation}>
              <label>
                Start a conversation
                <textarea
                  required
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="threads-actions">
                <button
                  className="button primary"
                  disabled={pending || !body.trim()}
                >
                  Post conversation
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {boardId && conversationId && (
        <>
          {watch && active && (
            <button type="button" onClick={toggleNotices}>
              {watch.noticesEnabled
                ? "Unfollow notifications"
                : "Follow notifications"}
            </button>
          )}
          {messageCursor && (
            <button type="button" onClick={loadMoreMessages}>
              Load earlier messages
            </button>
          )}
          <ol className="threads-messages">
            {messages.map((item) => {
              const canEdit =
                active &&
                !item.deleted &&
                (item.author?.id === userId ||
                  (staff && item.authorRoleAtPosting === "student"));
              return (
                <li
                  key={item.id}
                  id={`thread-message-${item.id}`}
                  className="threads-message"
                  tabIndex={-1}
                >
                  <div className="threads-message-head">
                    <strong>
                      {item.deleted
                        ? "Deleted message"
                        : (item.author?.displayName ?? "Former member")}
                    </strong>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </div>
                  {item.deleted ? (
                    <p className="threads-tombstone">Message deleted</p>
                  ) : editing === item.id ? (
                    <div className="threads-form">
                      <label>
                        Edit message
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          rows={4}
                        />
                      </label>
                      <div className="threads-actions">
                        <button
                          type="button"
                          disabled={pending || !editText.trim()}
                          onClick={() => void saveEdit(item)}
                        >
                          Save edit
                        </button>
                        <button type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="threads-body">
                      <PostBody bodyMarkdown={item.bodyMarkdown ?? ""} />
                    </div>
                  )}
                  {!item.deleted && (
                    <ul className="threads-files">
                      {(item.attachments ?? []).map((file) => (
                        <li key={file.id}>
                          <a href={file.downloadUrl}>{file.fileName}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canEdit && editing !== item.id && (
                    <div className="threads-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(item.id);
                          setEditText(item.bodyMarkdown ?? "");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMessage(item)}
                      >
                        Delete
                      </button>
                      <label className="threads-upload">
                        {uploading === item.id ? "Uploading…" : "Attach file"}
                        <input
                          type="file"
                          disabled={Boolean(uploading)}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            void upload(item, file);
                          }}
                        />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!loading && !messages.length && <p>No messages available.</p>}
          {active && (
            <form className="threads-form" onSubmit={submitReply}>
              <label>
                Reply
                <textarea
                  ref={inputRef}
                  required
                  value={reply}
                  onChange={(event) => {
                    setReply(event.target.value);
                    live.typing(event.target.value.length > 0);
                  }}
                  onBlur={live.stopTyping}
                  rows={4}
                />
              </label>
              {typingNames.length > 0 && (
                <p className="threads-typing" role="status">
                  {typingNames.join(", ")}{" "}
                  {typingNames.length === 1 ? "is" : "are"} typing…
                </p>
              )}
              <button
                className="button primary"
                disabled={pending || !reply.trim()}
              >
                Reply
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
