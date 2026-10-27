import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type Event =
  | { type: "subscribed"; courseId: string }
  | { type: "changed"; courseId: string; boardId: string; sequence: number }
  | {
      type: "typing";
      conversationId: string;
      userId: string;
      displayName: string;
      active: boolean;
    };

/** Signals are hints only: the server's committed REST ledger is authoritative. */
export function useThreadEvents(
  courseId: string,
  conversationId: string | undefined,
  userId: string,
  onChange: () => void,
  setNames: Dispatch<SetStateAction<string[]>>,
) {
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const viewer = useRef(conversationId);
  const change = useRef(onChange);
  const cursor = useRef<string | null>(null);
  const catchingUp = useRef(false);
  const queuedCatchUp = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPulse = useRef(0);
  const presence = useRef(new Map<string, { name: string; until: number }>());
  viewer.current = conversationId;
  change.current = onChange;

  const send = useCallback((body: object) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(body));
  }, []);
  const stopTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (viewer.current)
      send({ type: "typing", conversationId: viewer.current, active: false });
  }, [send]);
  const typing = useCallback(
    (active: boolean) => {
      if (!viewer.current || !active) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (now - lastPulse.current > 2500) {
        send({ type: "typing", conversationId: viewer.current, active: true });
        lastPulse.current = now;
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(stopTyping, 6000);
    },
    [send, stopTyping],
  );

  useEffect(() => {
    const key = `chalktalk-thread-cursor:${courseId}`;
    cursor.current = sessionStorage.getItem(key);
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let expiry: ReturnType<typeof setInterval> | null = null;
    let retryMs = 1000;
    async function catchUp() {
      if (disposed) return;
      if (catchingUp.current) {
        queuedCatchUp.current = true;
        return;
      }
      catchingUp.current = true;
      try {
        let changed = false;
        for (let page = 0; page < 100 && !disposed; page += 1) {
          const url = new URL(
            `/api/v1/courses/${encodeURIComponent(courseId)}/threads/changes`,
            window.location.origin,
          );
          if (cursor.current) url.searchParams.set("after", cursor.current);
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) throw new Error("Thread catch-up unavailable");
          const value = (await response.json()) as {
            data: unknown[];
            page: { hasMore: boolean; nextCursor: string | null };
          };
          changed ||= value.data.length > 0;
          if (value.page.nextCursor) {
            cursor.current = value.page.nextCursor;
            sessionStorage.setItem(key, value.page.nextCursor);
          }
          if (!value.page.hasMore || value.data.length === 0) break;
        }
        if (changed && !disposed) change.current();
      } catch {
        // The manual Refresh control remains available when catch-up fails.
      } finally {
        catchingUp.current = false;
        if (queuedCatchUp.current && !disposed) {
          queuedCatchUp.current = false;
          void catchUp();
        }
      }
    }
    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/v1/thread-events`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        retryMs = 1000;
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe", courseId }));
        if (viewer.current)
          ws.send(
            JSON.stringify({
              type: "view",
              courseId,
              conversationId: viewer.current,
            }),
          );
      };
      ws.onmessage = (message) => {
        let value: Event;
        try {
          value = JSON.parse(String(message.data)) as Event;
        } catch {
          return;
        }
        if (value.type === "subscribed" && value.courseId === courseId)
          void catchUp();
        if (value.type === "changed" && value.courseId === courseId)
          void catchUp();
        if (
          value.type === "typing" &&
          value.conversationId === viewer.current &&
          value.userId !== userId
        ) {
          if (value.active)
            presence.current.set(value.userId, {
              name: value.displayName,
              until: Date.now() + 10000,
            });
          else presence.current.delete(value.userId);
          setNames([...presence.current.values()].map((entry) => entry.name));
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        presence.current.clear();
        setNames([]);
        reconnect = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    expiry = setInterval(() => {
      let removed = false;
      for (const [id, entry] of presence.current)
        if (entry.until < Date.now()) {
          presence.current.delete(id);
          removed = true;
        }
      if (removed)
        setNames([...presence.current.values()].map((entry) => entry.name));
    }, 1000);
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (expiry) clearInterval(expiry);
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };
  }, [courseId, userId, setNames]);

  useEffect(() => {
    presence.current.clear();
    setNames([]);
    if (conversationId) send({ type: "view", courseId, conversationId });
    return () => {
      stopTyping();
      if (conversationId) send({ type: "unview", conversationId });
    };
  }, [courseId, conversationId, send, setNames, stopTyping]);
  return { connected, typing, stopTyping };
}
