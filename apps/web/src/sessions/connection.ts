import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "ended" | "removed";

export type ConnectOptions = {
  url: string;
  name: string;
  document: Y.Doc;
  token: () => Promise<string>;
  onStatus: (status: "connecting" | "connected" | "disconnected") => void;
  onSynced: () => void;
  onClose: (reason: string) => void;
  onAuthenticationFailed: () => void;
  onStateless: (payload: string) => void;
};
export type SessionConnection = {
  awareness: Awareness | null;
  destroy: () => void;
};
export type Connect = (options: ConnectOptions) => SessionConnection;

/** Connects with the Hocuspocus provider; each reconnect asks for a fresh ticket. */
export const connectWithHocuspocus: Connect = (options) => {
  const provider = new HocuspocusProvider({
    url: options.url,
    name: options.name,
    document: options.document,
    token: options.token,
    onStatus: ({ status }) => options.onStatus(status),
    onSynced: () => options.onSynced(),
    onClose: ({ event }) => options.onClose(event.reason ?? ""),
    onAuthenticationFailed: () => options.onAuthenticationFailed(),
    onStateless: ({ payload }) => options.onStateless(payload),
  });
  return { awareness: provider.awareness, destroy: () => provider.destroy() };
};
