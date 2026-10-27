import { useState } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadEvents } from "./live.js";

class Socket {
  static OPEN = 1;
  readyState = Socket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    queueMicrotask(() => this.onopen?.());
  }

  send(raw: string) {
    const message = JSON.parse(raw) as { type: string; courseId?: string };
    if (message.type === "subscribe")
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            type: "subscribed",
            courseId: message.courseId,
          }),
        } as MessageEvent),
      );
  }

  close() {
    this.readyState = 3;
  }
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
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
