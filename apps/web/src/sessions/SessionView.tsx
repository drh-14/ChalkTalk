import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { ApiError } from "../auth/client.js";
import { listMembers, type Membership } from "../courses/client.js";
import { getPost } from "../posts/client.js";
import { CodeEditor } from "./CodeEditor.js";
import { PostToDiscussion, type PostContent } from "./PostToDiscussion.js";
import {
  connectWithHocuspocus,
  type Connect,
  type ConnectionState,
  type SessionConnection,
} from "./connection.js";
import {
  SESSION_LANGUAGES,
  createTicket,
  getSession,
  getSnapshot,
  inviteParticipant,
  removeParticipant,
  updateSession,
  type CodeSession,
  type SessionLanguage,
  type Versioned,
} from "./client.js";

// Excalidraw is large, so it loads only when someone opens the whiteboard.
const Whiteboard = lazy(() => import("./Whiteboard.js"));

type Tab = "code" | "whiteboard";
const TABS: { id: Tab; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "whiteboard", label: "Whiteboard" },
];

const STATE_TEXT: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  ended: "Session ended (read-only)",
  removed: "You no longer have access to this session",
};

type Presence = { userId: string; name: string; color: string };

function useAwarenessUsers(awareness: Awareness | null) {
  const [users, setUsers] = useState<Presence[]>([]);
  useEffect(() => {
    if (!awareness) {
      setUsers([]);
      return;
    }
    const read = () => {
      const seen = new Map<string, Presence>();
      for (const state of awareness.getStates().values()) {
        const user = state.user as Presence | undefined;
        if (user?.userId) seen.set(user.userId, user);
      }
      setUsers([...seen.values()]);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);
  return users;
}

async function allMembers(courseId: string) {
  const members: Membership[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await listMembers(courseId, cursor);
    members.push(...result.data);
    if (!result.page.nextCursor) break;
    cursor = result.page.nextCursor;
  }
  return members;
}

export function SessionView({
  courseId,
  sessionId,
  viewerId,
  staff,
  csrfToken,
  onNavigate,
  connect = connectWithHocuspocus,
}: {
  courseId: string;
  sessionId: string;
  viewerId: string;
  staff: boolean;
  csrfToken: string;
  onNavigate: (path: string) => void;
  connect?: Connect;
}) {
  const [session, setSession] = useState<Versioned<CodeSession>>();
  const [unavailable, setUnavailable] = useState(false);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [members, setMembers] = useState<Membership[]>();
  const [inviteeId, setInviteeId] = useState("");
  const [document, setDocument] = useState(() => new Y.Doc());
  const connection = useRef<SessionConnection | null>(null);
  const finalState = useRef(false);
  const text = useMemo(() => document.getText("content"), [document]);
  const board = useMemo(() => document.getMap("whiteboard"), [document]);
  const [tab, setTab] = useState<Tab>("code");
  const [whiteboardOpened, setWhiteboardOpened] = useState(false);
  const [boardActions, setBoardActions] = useState<HTMLDivElement | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [self, setSelf] = useState<Presence>();
  const [viewOnly, setViewOnly] = useState(false);
  const [anchorIsQuestion, setAnchorIsQuestion] = useState(false);
  const [posting, setPosting] = useState<PostContent>();
  const [invitePermission, setInvitePermission] = useState<"edit" | "view">(
    "edit",
  );
  const online = useAwarenessUsers(awareness);

  const refresh = useCallback(async () => {
    try {
      setSession(await getSession(sessionId));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404)
        setUnavailable(true);
    }
  }, [sessionId]);

  const showFinalText = useCallback(
    async (reason: "ended" | "removed") => {
      if (finalState.current) return;
      finalState.current = true;
      connection.current?.destroy();
      connection.current = null;
      setAwareness(null);
      setState(reason);
      if (reason === "removed") return;
      try {
        const snapshot = await getSnapshot(sessionId);
        const finished = new Y.Doc();
        finished.getText("content").insert(0, snapshot.content);
        const finishedBoard = finished.getMap("whiteboard");
        for (const element of snapshot.whiteboard ?? [])
          finishedBoard.set(element.id, element);
        setDocument(finished);
      } catch {
        // Keep the text already on screen if the snapshot cannot be read.
      }
      void refresh();
    },
    [refresh, sessionId],
  );

  useEffect(() => {
    let active = true;
    finalState.current = false;
    setSession(undefined);
    setUnavailable(false);
    setState("connecting");
    void getSession(sessionId)
      .then(async (loaded) => {
        if (!active) return;
        setSession(loaded);
        if (loaded.data.status === "ended") {
          await showFinalText("ended");
          return;
        }
        let first: string | undefined;
        let url: string;
        try {
          const ticket = await createTicket(sessionId, csrfToken);
          first = ticket.ticket;
          url = ticket.webSocketUrl;
          setViewOnly(ticket.permission === "read");
        } catch (caught) {
          if (!active) return;
          if (caught instanceof ApiError && caught.code === "session_ended")
            await showFinalText("ended");
          else setUnavailable(true);
          return;
        }
        if (!active) return;
        const doc = new Y.Doc();
        setDocument(doc);
        let connectedOnce = false;
        const opened = connect({
          url,
          name: `collaboration-session:${sessionId}`,
          document: doc,
          token: async () => {
            if (first) {
              const ticket = first;
              first = undefined;
              return ticket;
            }
            try {
              return (await createTicket(sessionId, csrfToken)).ticket;
            } catch (caught) {
              if (caught instanceof ApiError)
                void showFinalText(
                  caught.code === "session_ended" ? "ended" : "removed",
                );
              throw caught;
            }
          },
          onStatus: (status) => {
            if (finalState.current) return;
            if (status === "connected" && connectedOnce) setState("connected");
            if (status === "disconnected" && connectedOnce)
              setState("reconnecting");
          },
          onSynced: () => {
            if (finalState.current) return;
            connectedOnce = true;
            setState("connected");
          },
          onClose: (reason) => {
            if (reason === "session-ended") void showFinalText("ended");
            else if (reason === "access-removed") void showFinalText("removed");
            else if (!finalState.current && connectedOnce)
              setState("reconnecting");
          },
          onAuthenticationFailed: () => {
            void getSession(sessionId)
              .then((current) => {
                if (current.data.status === "ended")
                  void showFinalText("ended");
              })
              .catch(() => void showFinalText("removed"));
          },
          onStateless: (payload) => {
            let message: { type?: string };
            try {
              message = JSON.parse(payload);
            } catch {
              return;
            }
            if (message.type === "session-ended") void showFinalText("ended");
            if (message.type === "session-updated") void refresh();
            if (message.type === "presence")
              setSelf((message as { user?: Presence }).user);
          },
        });
        connection.current = opened;
        setAwareness(opened.awareness);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
      connection.current?.destroy();
      connection.current = null;
    };
    // The session identity owns the connection; callbacks read current state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, csrfToken, connect]);

  const manager = Boolean(
    session && (staff || session.data.createdBy === viewerId),
  );
  const editable =
    (state === "connected" || state === "reconnecting") && !viewOnly;
  const postPath = session
    ? `/courses/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(session.data.anchor.postId)}`
    : `/courses/${encodeURIComponent(courseId)}`;

  // Answers and followups exist only on questions.
  const anchorPostId = session?.data.anchor.postId;
  useEffect(() => {
    if (!anchorPostId) return;
    let active = true;
    void getPost(anchorPostId)
      .then((post) => {
        if (active)
          setAnchorIsQuestion("type" in post && post.type === "question");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [anchorPostId]);

  useEffect(() => {
    if (!manager || state === "ended" || state === "removed" || members) return;
    void allMembers(courseId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [courseId, manager, members, state]);

  async function act(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "version_conflict") {
        await refresh();
        setError("This session changed. Try again.");
      } else
        setError(
          caught instanceof Error ? caught.message : "Something went wrong.",
        );
    } finally {
      setPending(false);
    }
  }
  const choose = (next: Tab) => {
    setTab(next);
    if (next === "whiteboard") setWhiteboardOpened(true);
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length]!.id;
    choose(next);
    window.document.getElementById(`session-tab-${next}`)?.focus();
  };
  const follow = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(path);
  };

  if (unavailable)
    return (
      <section
        className="session-view session-unavailable"
        aria-labelledby="session-heading"
      >
        <h2 id="session-heading">This session isn't available</h2>
        <p>It may not exist, or you may not have been invited.</p>
        <a
          href={`/courses/${encodeURIComponent(courseId)}`}
          onClick={(event) =>
            follow(event, `/courses/${encodeURIComponent(courseId)}`)
          }
        >
          Back to discussion
        </a>
      </section>
    );
  if (!session)
    return (
      <p className="session-view" role="status">
        Loading session…
      </p>
    );

  const invitable = (members ?? []).filter(
    (member) =>
      !session.data.participants.some(
        (participant) => participant.userId === member.user.id,
      ),
  );
  const colors = new Map(online.map((user) => [user.userId, user.color]));
  const onlineIds = new Set(online.map((user) => user.userId));
  // Awareness relays this viewer's presence only to others; the server sends
  // the viewer their own color when they connect.
  if (state === "connected") {
    onlineIds.add(viewerId);
    if (self) colors.set(viewerId, self.color);
  }
  const sessionActive = state !== "ended" && state !== "removed";
  const canPost = sessionActive && !viewOnly && anchorIsQuestion;
  const languageLabel = SESSION_LANGUAGES.find(
    (option) => option.value === session.data.language,
  )?.label;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(text.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The code couldn't be copied. Select it and copy instead.");
    }
  }

  return (
    <section className="session-view" aria-labelledby="session-heading">
      <header className="session-header">
        <div>
          <a
            className="session-back"
            href={postPath}
            onClick={(event) => follow(event, postPath)}
          >
            Back to post
          </a>
          <h2 id="session-heading">{session.data.title}</h2>
          <p className="session-meta">Live session</p>
        </div>
        <div className="session-header-actions">
          {viewOnly && state !== "ended" && state !== "removed" && (
            <p className="session-view-only">View only</p>
          )}
          <p
            className={`session-state session-state-${state}`}
            role="status"
            aria-live="polite"
          >
            {STATE_TEXT[state]}
          </p>
          {manager && sessionActive && (
            <button
              type="button"
              className="button danger"
              disabled={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    "End this session for everyone? The code and whiteboard become read-only.",
                  )
                )
                  return;
                void act(async () => {
                  const ended = await updateSession(
                    sessionId,
                    { status: "ended" },
                    session.etag,
                    csrfToken,
                  );
                  setSession(ended);
                  await showFinalText("ended");
                });
              }}
            >
              End session
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <div className="session-layout">
        <div className="session-workspace">
          {state === "removed" ? (
            <p className="session-removed">
              Your access to this session was removed.
            </p>
          ) : (
            <>
              <div className="session-tab-bar">
                <div
                  className="session-tabs"
                  role="tablist"
                  aria-label="Session workspace"
                >
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      id={`session-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      aria-controls={`session-panel-${item.id}`}
                      tabIndex={tab === item.id ? 0 : -1}
                      onClick={() => choose(item.id)}
                      onKeyDown={moveTab}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="session-tab-actions" hidden={tab !== "code"}>
                  {manager && sessionActive ? (
                    <label className="session-language">
                      <span className="visually-hidden">Language</span>
                      <select
                        value={session.data.language}
                        disabled={pending}
                        onChange={(event) => {
                          const language = event.target
                            .value as SessionLanguage;
                          void act(async () => {
                            setSession(
                              await updateSession(
                                sessionId,
                                { language },
                                session.etag,
                                csrfToken,
                              ),
                            );
                          });
                        }}
                      >
                        {SESSION_LANGUAGES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="session-language-label">
                      {languageLabel}
                    </span>
                  )}
                  {canPost && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        setPosting({
                          kind: "code",
                          code: text.toString(),
                          language: session.data.language,
                        })
                      }
                    >
                      Post to discussion
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void copyCode()}
                  >
                    {copied ? "Copied" : "Copy code"}
                  </button>
                  <span className="visually-hidden" aria-live="polite">
                    {copied ? "Code copied to the clipboard" : ""}
                  </span>
                </div>
                <div
                  className="session-tab-actions"
                  hidden={tab !== "whiteboard"}
                  ref={setBoardActions}
                />
              </div>
              <div
                id="session-panel-code"
                className="session-panel"
                role="tabpanel"
                aria-labelledby="session-tab-code"
                hidden={tab !== "code"}
              >
                <CodeEditor
                  key={document.guid}
                  text={text}
                  awareness={awareness}
                  language={session.data.language}
                  readOnly={!editable}
                />
              </div>
              <div
                id="session-panel-whiteboard"
                className="session-panel"
                role="tabpanel"
                aria-labelledby="session-tab-whiteboard"
                hidden={tab !== "whiteboard"}
              >
                {whiteboardOpened && (
                  <Suspense
                    fallback={
                      <p className="session-loading">Loading whiteboard…</p>
                    }
                  >
                    <Whiteboard
                      key={document.guid}
                      board={board}
                      awareness={awareness}
                      readOnly={!editable}
                      visible={tab === "whiteboard"}
                      title={session.data.title}
                      actions={boardActions}
                      onPost={
                        canPost
                          ? (file) => setPosting({ kind: "board", file })
                          : undefined
                      }
                    />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </div>
        <aside className="session-side" aria-label="Session details">
          <section aria-labelledby="participants-heading">
            <div className="session-side-heading">
              <h3 id="participants-heading">Participants</h3>
              {manager && sessionActive && !inviting && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setInviting(true)}
                >
                  + Invite
                </button>
              )}
            </div>
            {manager && sessionActive && inviting && (
              <form
                className="session-invite"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!inviteeId) return;
                  void act(async () => {
                    setSession(
                      await inviteParticipant(
                        sessionId,
                        inviteeId,
                        csrfToken,
                        invitePermission,
                      ),
                    );
                    setInviteeId("");
                    setInvitePermission("edit");
                    setInviting(false);
                  });
                }}
              >
                <label htmlFor="session-invitee">Invite a course member</label>
                <select
                  id="session-invitee"
                  value={inviteeId}
                  onChange={(event) => setInviteeId(event.target.value)}
                  disabled={!members}
                >
                  <option value="">
                    {members
                      ? invitable.length
                        ? "Choose a member"
                        : "Everyone is already here"
                      : "Loading members…"}
                  </option>
                  {invitable.map((member) => (
                    <option key={member.user.id} value={member.user.id}>
                      {member.user.displayName} (
                      {member.role === "ta" ? "TA" : member.role})
                    </option>
                  ))}
                </select>
                <fieldset className="session-invite-permission">
                  <legend className="visually-hidden">Permission</legend>
                  {(
                    [
                      ["edit", "Can edit"],
                      ["view", "Can view"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="session-invite-permission"
                        value={value}
                        checked={invitePermission === value}
                        onChange={() => setInvitePermission(value)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="session-invite-actions">
                  <button
                    type="submit"
                    className="button secondary"
                    disabled={!inviteeId || pending}
                  >
                    Invite
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setInviting(false);
                      setInviteeId("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <ul className="session-participants">
              {session.data.participants.map((participant) => {
                const isOnline = onlineIds.has(participant.userId);
                const color = colors.get(participant.userId);
                return (
                  <li key={participant.userId}>
                    <span
                      className="session-avatar"
                      style={color ? { background: color } : undefined}
                      aria-hidden="true"
                    >
                      {participant.displayName.trim().charAt(0).toUpperCase()}
                      <span
                        className={`presence-dot${isOnline ? " online" : ""}`}
                      />
                    </span>
                    <span>
                      {participant.displayName}
                      {participant.userId === viewerId ? " (you)" : ""}
                      <span className="session-participant-note">
                        {participant.role === "creator"
                          ? "Started this"
                          : participant.permission === "view"
                            ? "Invited · Viewer"
                            : "Invited"}
                      </span>
                      <span className="visually-hidden">
                        {isOnline ? ", online" : ", offline"}
                      </span>
                    </span>
                    {manager &&
                      sessionActive &&
                      participant.role === "invitee" && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={pending}
                          aria-label={`Remove ${participant.displayName}`}
                          onClick={() =>
                            void act(async () => {
                              await removeParticipant(
                                sessionId,
                                participant.userId,
                                csrfToken,
                              );
                              await refresh();
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
      {posting && (
        <PostToDiscussion
          postId={session.data.anchor.postId}
          postPath={postPath}
          sessionTitle={session.data.title}
          staff={staff}
          csrfToken={csrfToken}
          content={posting}
          onClose={() => setPosting(undefined)}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}
