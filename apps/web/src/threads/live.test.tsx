import { useState } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadEvents } from "./live.js";

class Socket {
  static OPEN = 1;
  static autoSubscribe = true;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  sent: Array<{
    type: string;
    courseId?: string;
    conversationId?: string;
    active?: boolean;
  }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    Socket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(raw: string) {
    const message = JSON.parse(raw) as { type: string; courseId?: string };
    this.sent.push(message);
    if (message.type === "subscribe" && Socket.autoSubscribe)
      queueMicrotask(() =>
        this.emit({ type: "subscribed", courseId: message.courseId }),
      );
  }

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  close() {
    this.readyState = 3;
  }
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  Socket.instances = [];
  Socket.autoSubscribe = true;
});

it("waits for subscription and view acknowledgements before typing", async () => {
  Socket.autoSubscribe = false;
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [],
            page: { hasMore: false, nextCursor: null },
          }),
        ),
    ),
  );
  let typing!: (active: boolean) => void;
  function Viewer() {
    const [, setNames] = useState<string[]>([]);
    typing = useThreadEvents(
      "course-a",
      "conversation-a",
      "user-1",
      async () => {},
      setNames,
    ).typing;
    return null;
  }
  render(<Viewer />);
  await waitFor(() =>
    expect(Socket.instances[0]?.sent).toEqual([
      { type: "subscribe", courseId: "course-a" },
    ]),
  );
  const socket = Socket.instances[0]!;
  act(() => typing(true));
  expect(socket.sent).toHaveLength(1);
  act(() => socket.emit({ type: "subscribed", courseId: "course-a" }));
  expect(socket.sent[1]).toEqual({
    type: "view",
    courseId: "course-a",
    conversationId: "conversation-a",
  });
  expect(socket.sent).toHaveLength(2);
  act(() => socket.emit({ type: "viewing", conversationId: "conversation-a" }));
  expect(socket.sent[2]).toEqual({
    type: "typing",
    conversationId: "conversation-a",
    active: true,
  });
});

it("starts the new course catch-up while the previous course is pending", async () => {
  let releaseFirst!: (response: Response) => void;
  const first = new Promise<Response>((resolve) => {
    releaseFirst = resolve;
  });
  const fetchMock = vi.fn((input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/course-a/")) return first;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{ sequence: 1 }],
          page: { hasMore: false, nextCursor: "course-b-cursor" },
        }),
        { status: 200 },
      ),
    );
  });
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn(async () => {});

  function Viewer({ courseId }: { courseId: string }) {
    const [, setNames] = useState<string[]>([]);
    useThreadEvents(courseId, undefined, "user-1", onChange, setNames);
    return null;
  }

  const view = render(<Viewer courseId="course-a" />);
  await waitFor(() => expect(fetchMock.mock.calls.length).toBe(1));
  view.rerender(<Viewer courseId="course-b" />);
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/course-b/")),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(sessionStorage.getItem("chalktalk-thread-cursor:course-b")).toBe(
      "course-b-cursor",
    ),
  );
  releaseFirst(
    new Response(
      JSON.stringify({ data: [], page: { hasMore: false, nextCursor: null } }),
    ),
  );
  expect(sessionStorage.getItem("chalktalk-thread-cursor:course-a")).toBeNull();
});
