import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CourseLiveSessions, YourLiveSessions } from "./LiveSessionLists.js";

const session = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  courseId: "c-1",
  status: "active",
  anchor: { postId: "p-1" },
  title: `Session ${id}`,
  language: "python",
  createdBy: "sam",
  participants: [
    { userId: "sam", displayName: "Sam", role: "creator" },
    { userId: "tara", displayName: "Tara", role: "invitee" },
  ],
  endedAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  version: 1,
  ...overrides,
});

function api(data: unknown[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ data, page: { nextCursor: null, hasMore: false } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return urls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists the viewer's active sessions across courses and joins one", async () => {
  const urls = api([
    session("s-1", { courseName: "CS 101" }),
    session("s-2", {
      courseId: "c-2",
      courseName: "CS 201",
      createdBy: "tara",
      participants: [
        { userId: "tara", displayName: "Tara", role: "creator" },
        { userId: "sam", displayName: "Sam", role: "invitee" },
      ],
    }),
  ]);
  const onOpen = vi.fn();
  render(<YourLiveSessions viewerId="sam" onOpen={onOpen} />);
  expect(
    await screen.findByRole("heading", { name: "Your live sessions" }),
  ).toBeTruthy();
  expect(urls).toEqual([
    "/api/v1/users/me/collaboration-sessions?status=active",
  ]);
  const started = screen.getByText("Session s-1").closest("li")!;
  const invited = screen.getByText("Session s-2").closest("li")!;
  expect(started.textContent).toContain("CS 101 · You started this");
  expect(invited.textContent).toContain("CS 201 · You were invited");
  await userEvent.click(
    screen.getByRole("button", { name: "Join Session s-2" }),
  );
  expect(onOpen).toHaveBeenCalledWith("c-2", "s-2");
});

it("shows nothing on the home page without active sessions", async () => {
  const urls = api([]);
  const { container } = render(
    <YourLiveSessions viewerId="sam" onOpen={vi.fn()} />,
  );
  await waitFor(() => expect(urls).toHaveLength(1));
  expect(container.innerHTML).toBe("");
});

it("lists a course's active sessions with participants for staff", async () => {
  const urls = api([session("s-1"), session("s-2")]);
  const onOpen = vi.fn();
  render(<CourseLiveSessions courseId="c-1" staff onOpen={onOpen} />);
  expect(
    await screen.findByRole("heading", { name: "Live sessions" }),
  ).toBeTruthy();
  expect(urls).toEqual([
    "/api/v1/courses/c-1/collaboration-sessions?status=active",
  ]);
  expect(screen.getByText("2 running in this course")).toBeTruthy();
  expect(screen.getAllByText("Sam, Tara")).toHaveLength(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Join Session s-1" }),
  );
  expect(onOpen).toHaveBeenCalledWith("c-1", "s-1");
});

it("tells a student how many of their own sessions are active", async () => {
  api([session("s-1")]);
  render(<CourseLiveSessions courseId="c-1" staff={false} onOpen={vi.fn()} />);
  expect(await screen.findByText("1 active")).toBeTruthy();
  expect(screen.queryByText(/running in this course/)).toBeNull();
});
