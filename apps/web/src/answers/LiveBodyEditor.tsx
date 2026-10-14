import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { MarkdownEditorField } from "../posts/MarkdownEditorField.js";
import { requestCollaborationTicket } from "./client.js";

type Props = {
  kind: "answer" | "followup";
  id: string;
  csrfToken: string;
  onDone: () => Promise<void>;
  onFallback: () => void;
};

export function LiveBodyEditor({
  kind,
  id,
  csrfToken,
  onDone,
  onFallback,
}: Props) {
  const [document] = useState(() => new Y.Doc());
  const [body, setBody] = useState("");
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const text = document.getText("content");
    let ready = false;
    const waitForConnection = window.setTimeout(() => {
      if (!ready)
        setError(
          "Live editing is unavailable. Use the standard editor instead.",
        );
    }, 5_000);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const provider = new HocuspocusProvider({
      url: `${protocol}//${window.location.host}/collaboration`,
      name: `${kind}:${id}`,
      document,
      awareness: null,
      token: async () => {
        const result = await requestCollaborationTicket(kind, id, csrfToken);
        if (result.documentName !== `${kind}:${id}`)
          throw new Error("The ticket was issued for another document.");
        return result.ticket;
      },
      onSynced: () => {
        ready = true;
        window.clearTimeout(waitForConnection);
        setSynced(true);
        setConnected(true);
        setError("");
      },
      onStatus: ({ status }) => {
        if (status !== "connected") setConnected(false);
      },
      onClose: () => setConnected(false),
      onUnsyncedChanges: ({ number }) => setPendingChanges(number),
      onAuthenticationFailed: () =>
        setError(
          "Editing permission was lost. Copy any unsaved text before leaving.",
        ),
    });
    const change = () => setBody(text.toString());
    text.observe(change);
    return () => {
      window.clearTimeout(waitForConnection);
      text.unobserve(change);
      provider.destroy();
    };
  }, [kind, id, csrfToken, document, attempt]);

  useEffect(() => () => document.destroy(), [document]);

  async function done() {
    if (connected && pendingChanges > 0) return;
    if (
      !connected &&
      synced &&
      !window.confirm(
        "You are disconnected. Copy any unsaved text before closing this editor. Close anyway?",
      )
    )
      return;
    setClosing(true);
    try {
      await onDone();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not refresh this content.",
      );
    } finally {
      setClosing(false);
    }
  }

  function fallback() {
    if (
      synced &&
      (!connected || pendingChanges > 0) &&
      !window.confirm(
        "Local changes may not be saved. Copy your text before switching to the standard editor. Continue?",
      )
    )
      return;
    onFallback();
  }

  return (
    <div className="response-composer" aria-label={`Live ${kind} editor`}>
      <p role="status" className="response-byline">
        {error ||
          (connected && synced
            ? pendingChanges > 0
              ? "Synchronizing changes…"
              : "Connected · changes synchronized"
            : synced
              ? "Disconnected · local text may be unsaved"
              : "Connecting to live editing…")}
      </p>
      {synced && (
        <MarkdownEditorField
          label={kind === "answer" ? "Answer" : "Followup"}
          value={body}
          onChange={setBody}
          liveText={document.getText("content")}
          disableImages
        />
      )}
      {error && (
        <p role="alert" className="form-message error">
          {error}
        </p>
      )}
      <div className="response-actions">
        <button
          className="button primary"
          type="button"
          disabled={closing || (connected && pendingChanges > 0)}
          onClick={() => void done()}
        >
          Done
        </button>
        {!connected && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setError("");
              setAttempt((current) => current + 1);
            }}
          >
            Retry connection
          </button>
        )}
        <button className="text-button" type="button" onClick={fallback}>
          Use standard editor
        </button>
      </div>
    </div>
  );
}
