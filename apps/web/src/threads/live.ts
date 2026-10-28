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
  | { type: "viewing"; conversationId: string }
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
  onChange: () => Promise<void>,
  setNames: Dispatch<SetStateAction<string[]>>,
) {
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const viewer = useRef(conversationId);
  const subscribed = useRef(false);
  const viewed = useRef<string | null>(null);
  const change = useRef(onChange);
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
    if (viewer.current && viewed.current === viewer.current)
      send({ type: "typing", conversationId: viewer.current, active: false });
  }, [send]);
  const typing = useCallback(
    (active: boolean) => {
      if (!viewer.current || !active) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (viewed.current === viewer.current && now - lastPulse.current > 2500) {
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
    let cursor = sessionStorage.getItem(key);
    let catchingUp = false;
    let queuedCatchUp = false;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let expiry: ReturnType<typeof setInterval> | null = null;
    let retryMs = 1000;
    subscribed.current = false;
    viewed.current = null;
    async function catchUp() {
      if (disposed) return;
      if (catchingUp) {
        queuedCatchUp = true;
        return;
      }
      catchingUp = true;
      try {
        let changed = false;
        let nextCursor = cursor;
        while (!disposed) {
          const url = new URL(
            `/api/v1/courses/${encodeURIComponent(courseId)}/threads/changes`,
            window.location.origin,
          );
          if (nextCursor) url.searchParams.set("after", nextCursor);
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) throw new Error("Thread catch-up unavailable");
          const value = (await response.json()) as {
            data: unknown[];
            page: { hasMore: boolean; nextCursor: string | null };
          };
          changed ||= value.data.length > 0;
          const previousCursor = nextCursor;
          if (value.page.nextCursor) nextCursor = value.page.nextCursor;
          if (!value.page.hasMore) break;
          if (
            !value.data.length ||
            !value.page.nextCursor ||
            nextCursor === previousCursor
          )
            throw new Error("Thread catch-up did not advance");
        }
        if (changed && !disposed) await change.current();
        if (!disposed && nextCursor) {
          cursor = nextCursor;
          sessionStorage.setItem(key, nextCursor);
        }
      } catch {
        // The manual Refresh control remains available when catch-up fails.
      } finally {
        catchingUp = false;
        if (queuedCatchUp && !disposed) {
          queuedCatchUp = false;
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
      };
      ws.onmessage = (message) => {
        if (disposed || socket.current !== ws) return;
        let value: Event;
        try {
          value = JSON.parse(String(message.data)) as Event;
        } catch {
          return;
        }
        if (value.type === "subscribed" && value.courseId === courseId) {
          subscribed.current = true;
          if (viewer.current)
            send({ type: "view", courseId, conversationId: viewer.current });
          void catchUp();
        }
        if (
          value.type === "viewing" &&
          value.conversationId === viewer.current
        ) {
          viewed.current = value.conversationId;
          if (typingTimer.current) {
            send({
              type: "typing",
              conversationId: value.conversationId,
              active: true,
            });
            lastPulse.current = Date.now();
          }
        }
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
        subscribed.current = false;
        viewed.current = null;
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
      subscribed.current = false;
      viewed.current = null;
      if (reconnect) clearTimeout(reconnect);
      if (expiry) clearInterval(expiry);
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };
  }, [courseId, userId, setNames, send]);

  useEffect(() => {
    presence.current.clear();
    setNames([]);
    viewed.current = null;
    lastPulse.current = 0;
    if (conversationId && subscribed.current)
      send({ type: "view", courseId, conversationId });
    return () => {
      stopTyping();
      if (conversationId) send({ type: "unview", conversationId });
    };
  }, [courseId, conversationId, send, setNames, stopTyping]);
  return { connected, typing, stopTyping };
}
