import { useEffect, useRef, useState } from "react";
import { ApiError } from "../auth/client.js";

type Kind = "post" | "answer" | "followup";
type RevisionMetadata = {
  id: string;
  ordinal: number;
  resourceVersion: number;
  createdAt: string;
  baseline: boolean;
  restoredFromRevisionId: string | null;
  editor: { id: string; displayName: string } | null;
};
type Revision = RevisionMetadata & {
  title: string | null;
  bodyMarkdown: string;
};
type RevisionPage = {
  data: RevisionMetadata[];
  page: { nextCursor: string | null };
};
type Props = {
  kind: Kind;
  resourceId: string;
  version: number;
  canRestore: boolean;
  csrfToken: string;
  onRefresh: () => Promise<number>;
  onRestored: () => void;
};
const endpoint = (kind: Kind, id: string) =>
  `/api/v1/${kind === "post" ? "posts" : kind === "answer" ? "answers" : "followups"}/${encodeURIComponent(id)}/revisions`;

async function receive<T>(
  response: Response,
): Promise<{ data: T; page?: RevisionPage["page"] }> {
  const payload = (await response.json()) as {
    data?: T;
    page?: RevisionPage["page"];
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Request failed",
    );
  return payload as { data: T; page?: RevisionPage["page"] };
}

export function RevisionHistory({
  kind,
  resourceId,
  version,
  canRestore,
  csrfToken,
  onRefresh,
  onRestored,
}: Props) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionMetadata[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<Revision>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparison, setComparison] = useState<{
    left: Revision;
    right: Revision;
  }>();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const requestId = useRef(0);
  useEffect(() => setCurrentVersion(version), [version]);

  async function show() {
    const request = ++requestId.current;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setBusy(true);
    setError("");
    setRevisions([]);
    setSelectedRevision(undefined);
    setNextCursor(null);
    setComparison(undefined);
    try {
      const result = await receive<RevisionMetadata[]>(
        await fetch(endpoint(kind, resourceId), {
          credentials: "include",
          headers: { Accept: "application/json" },
        }),
      );
      if (request !== requestId.current) return;
      setRevisions(result.data);
      setNextCursor(result.page?.nextCursor ?? null);
      setLeftId(result.data[0]?.id ?? "");
      setRightId(result.data.at(-1)?.id ?? "");
    } catch (caught) {
      if (request !== requestId.current) return;
      setRevisions([]);
      setSelectedRevision(undefined);
      setNextCursor(null);
      setComparison(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : "History could not be loaded.",
      );
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    const request = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const result = await receive<RevisionMetadata[]>(
        await fetch(
          `${endpoint(kind, resourceId)}?cursor=${encodeURIComponent(nextCursor)}`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        ),
      );
      if (request !== requestId.current) return;
      setRevisions((current) => [...current, ...result.data]);
      setNextCursor(result.page?.nextCursor ?? null);
      if (rightId === revisions.at(-1)?.id)
        setRightId(result.data.at(-1)?.id ?? rightId);
    } catch (caught) {
      if (request !== requestId.current) return;
      setRevisions([]);
      setSelectedRevision(undefined);
      setNextCursor(null);
      setComparison(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : "History could not be loaded.",
      );
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  async function reveal(revisionId: string) {
    const request = ++requestId.current;
    setBusy(true);
    setError("");
    setSelectedRevision(undefined);
    try {
      const result = await receive<Revision>(
        await fetch(
          `${endpoint(kind, resourceId)}/${encodeURIComponent(revisionId)}`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        ),
      );
      if (request !== requestId.current) return;
      setSelectedRevision(result.data);
    } catch (caught) {
      if (request !== requestId.current) return;
      setRevisions([]);
      setSelectedRevision(undefined);
      setNextCursor(null);
      setComparison(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : "Version could not be loaded.",
      );
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  async function compare() {
    const request = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ left: leftId, right: rightId });
      const { data } = await receive<{ left: Revision; right: Revision }>(
        await fetch(`${endpoint(kind, resourceId)}/compare?${query}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        }),
      );
      if (request !== requestId.current) return;
      setComparison(
        data.left.ordinal <= data.right.ordinal
          ? data
          : { left: data.right, right: data.left },
      );
    } catch (caught) {
      if (request !== requestId.current) return;
      setRevisions([]);
      setSelectedRevision(undefined);
      setNextCursor(null);
      setComparison(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : "Comparison could not be loaded.",
      );
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  async function restore(revision: RevisionMetadata) {
    if (
      !window.confirm(
        `Restore version ${revision.ordinal}? This replaces the current text, but not attachments or other settings.`,
      )
    )
      return;
    const request = ++requestId.current;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const restored = await receive<{ version: number }>(
        await fetch(
          `${endpoint(kind, resourceId)}/${encodeURIComponent(revision.id)}/restore`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
              "If-Match": `"v${currentVersion}"`,
            },
            body: "{}",
          },
        ),
      );
      onRestored();
      if (request !== requestId.current) return;
      setCurrentVersion(restored.data.version);
      try {
        const result = await receive<RevisionMetadata[]>(
          await fetch(endpoint(kind, resourceId), {
            credentials: "include",
            headers: { Accept: "application/json" },
          }),
        );
        if (request !== requestId.current) return;
        setRevisions(result.data);
        setNextCursor(result.page?.nextCursor ?? null);
        setLeftId(result.data[0]?.id ?? "");
        setRightId(result.data.at(-1)?.id ?? "");
        setSelectedRevision(undefined);
        setComparison(undefined);
      } catch {
        if (request !== requestId.current) return;
        setRevisions([]);
        setSelectedRevision(undefined);
        setNextCursor(null);
        setComparison(undefined);
        setError(
          "Text restored, but history could not be refreshed. Reopen History to try again.",
        );
      }
    } catch (caught) {
      if (request !== requestId.current) return;
      if (caught instanceof ApiError && caught.status === 412) {
        setConflict(true);
        setError(
          "This content changed since you opened history. Refresh the current version before retrying.",
        );
      } else
        setError(caught instanceof Error ? caught.message : "Restore failed.");
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  return (
    <section className="revision-history" aria-label={`${kind} history`}>
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => void show()}
      >
        History
      </button>
      {open && (
        <div className="revision-history-panel">
          {busy && <p role="status">Loading history…</p>}
          {error && (
            <p role="alert" className="form-message error">
              {error}
            </p>
          )}
          {conflict && (
            <button
              type="button"
              className="button secondary compact"
              onClick={() => {
                void onRefresh()
                  .then((next) => {
                    setCurrentVersion(next);
                    setConflict(false);
                    setError("");
                  })
                  .catch((caught) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "Refresh failed.",
                    ),
                  );
              }}
            >
              Refresh current version
            </button>
          )}
          {revisions.length > 0 && (
            <>
              <h3>Text history</h3>
              <ol>
                {revisions.map((item) => (
                  <li key={item.id}>
                    <strong>Version {item.ordinal}</strong>
                    {item.baseline ? " · Baseline of saved text" : ""}
                    {item.editor && <> · Editor: {item.editor.displayName}</>}
                    <time dateTime={item.createdAt}>
                      {" "}
                      · {new Date(item.createdAt).toLocaleString()}
                    </time>
                    <details
                      onToggle={(event) => {
                        if (event.currentTarget.open) void reveal(item.id);
                      }}
                    >
                      <summary>View version {item.ordinal} text</summary>
                      {selectedRevision?.id === item.id && (
                        <>
                          {selectedRevision.title !== null && (
                            <p>Title: {selectedRevision.title}</p>
                          )}
                          <pre>{selectedRevision.bodyMarkdown}</pre>
                        </>
                      )}
                    </details>
                    {canRestore && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy || conflict}
                        onClick={() => void restore(item)}
                      >
                        Restore version {item.ordinal}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {nextCursor && (
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() => void loadMore()}
                >
                  Load more history
                </button>
              )}
              {revisions.length > 1 && (
                <div className="revision-compare-controls">
                  <label>
                    Version A{" "}
                    <select
                      value={leftId}
                      onChange={(event) => setLeftId(event.target.value)}
                    >
                      {revisions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.ordinal}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Version B{" "}
                    <select
                      value={rightId}
                      onChange={(event) => setRightId(event.target.value)}
                    >
                      {revisions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.ordinal}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button secondary compact"
                    disabled={busy}
                    onClick={() => void compare()}
                  >
                    Compare versions
                  </button>
                </div>
              )}
              {comparison && (
                <div className="revision-compare" aria-label="Text comparison">
                  <section>
                    <h4>Earlier text</h4>
                    {comparison.left.title !== null && (
                      <p>Title: {comparison.left.title}</p>
                    )}
                    <pre>{comparison.left.bodyMarkdown}</pre>
                  </section>
                  <section>
                    <h4>Later text</h4>
                    {comparison.right.title !== null && (
                      <p>Title: {comparison.right.title}</p>
                    )}
                    <pre>{comparison.right.bodyMarkdown}</pre>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
