import { afterEach, expect, it, vi } from "vitest";
import {
  createSession,
  createTicket,
  getSession,
  getSnapshot,
  languageFromTags,
  inviteParticipant,
  listSessions,
  removeParticipant,
  sessionRoute,
  updateSession,
} from "./client.js";
import { routeForPath, routeFromLocation } from "../app/routes.js";

const session = {
  id: "s-1",
  courseId: "c-1",
  status: "active",
  anchor: { postId: "p-1" },
  title: "Loops",
  language: "python",
  createdBy: "u-1",
  participants: [],
  endedAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  version: 3,
};
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
afterEach(() => vi.unstubAllGlobals());

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const call = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[0] as [string, RequestInit];

it("lists a post's sessions with the anchor filter and credentials", async () => {
  const fetchMock = mockFetch(
    json({ data: [session], page: { nextCursor: null, hasMore: false } }),
  );
  await expect(
    listSessions("c-1", { postId: "p-1", status: "active" }),
  ).resolves.toMatchObject({
    data: [session],
  });
  const [url, init] = call(fetchMock);
  expect(url).toBe(
    "/api/v1/courses/c-1/collaboration-sessions?anchorType=post&anchorId=p-1&status=active",
  );
  expect(init).toMatchObject({ credentials: "include" });
});

it("creates a session with CSRF, an idempotency key, and a trimmed title", async () => {
  const fetchMock = mockFetch(json({ data: session }, 201, { ETag: '"v1"' }));
  const result = await createSession(
    "c-1",
    { postId: "p-1", language: "python", title: "  Loops  " },
    "csrf",
  );
  expect(result.etag).toBe('"v1"');
  const [url, init] = call(fetchMock);
  expect(url).toBe("/api/v1/courses/c-1/collaboration-sessions");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    "X-CSRF-Token": "csrf",
    "Content-Type": "application/json",
    "Idempotency-Key": expect.any(String),
  });
  expect(JSON.parse(String(init.body))).toEqual({
    anchor: { postId: "p-1" },
    language: "python",
    title: "Loops",
  });
});

it("omits a blank title so the server uses the post title", async () => {
  const fetchMock = mockFetch(json({ data: session }, 201));
  await createSession(
    "c-1",
    { postId: "p-1", language: "java", title: "   " },
    "csrf",
  );
  expect(JSON.parse(String(call(fetchMock)[1].body))).toEqual({
    anchor: { postId: "p-1" },
    language: "java",
  });
});

it("reads a session with its ETag and updates it conditionally", async () => {
  const fetchMock = mockFetch(json({ data: session }, 200, { ETag: '"v3"' }));
  await expect(getSession("s-1")).resolves.toEqual({
    data: session,
    etag: '"v3"',
  });
  fetchMock.mockResolvedValue(
    json({ data: { ...session, status: "ended" } }, 200, { ETag: '"v5"' }),
  );
  await updateSession("s-1", { status: "ended" }, '"v3"', "csrf");
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toBe("/api/v1/collaboration-sessions/s-1");
  expect(init.method).toBe("PATCH");
  expect(init.headers).toMatchObject({
    "If-Match": '"v3"',
    "X-CSRF-Token": "csrf",
  });
  expect(JSON.parse(String(init.body))).toEqual({ status: "ended" });
});

it("invites and removes participants", async () => {
  const fetchMock = mockFetch(json({ data: session }));
  await inviteParticipant("s-1", "u-2", "csrf");
  expect(call(fetchMock)[0]).toBe(
    "/api/v1/collaboration-sessions/s-1/participants",
  );
  expect(JSON.parse(String(call(fetchMock)[1].body))).toEqual({
    userId: "u-2",
  });
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  await expect(
    removeParticipant("s-1", "u-2", "csrf"),
  ).resolves.toBeUndefined();
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toBe("/api/v1/collaboration-sessions/s-1/participants/u-2");
  expect(init).toMatchObject({ method: "DELETE" });
  expect(init.body).toBeUndefined();
});

it("requests a ticket with CSRF and reads the snapshot", async () => {
  const ticket = {
    ticket: "t",
    webSocketUrl: "wss://x/collaboration",
    documentId: "collaboration-session:s-1",
    expiresAt: "2026-10-19T00:05:00Z",
  };
  const fetchMock = mockFetch(json({ data: ticket }, 201));
  await expect(createTicket("s-1", "csrf")).resolves.toEqual(ticket);
  expect(call(fetchMock)).toEqual([
    "/api/v1/collaboration-sessions/s-1/connection-tickets",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf" }),
    }),
  ]);
  fetchMock.mockResolvedValue(json({ data: { content: "print(1)" } }));
  await expect(getSnapshot("s-1")).resolves.toMatchObject({
    content: "print(1)",
  });
});

it("surfaces API errors with their code", async () => {
  mockFetch(json({ error: { code: "session_ended", message: "Ended" } }, 409));
  await expect(createTicket("s-1", "csrf")).rejects.toMatchObject({
    status: 409,
    code: "session_ended",
  });
});

it("routes a direct session link", () => {
  expect(sessionRoute("c-1", "s-1")).toBe("/courses/c-1/sessions/s-1");
  expect(routeForPath("/courses/c-1/sessions/s-1")).toBe("course-session");
  expect(routeForPath("/courses/c-1/sessions")).toBe("landing");
  expect(
    routeFromLocation(
      new URL("https://app.example.edu/courses/c-1/sessions/s-1"),
    ),
  ).toEqual({
    name: "course-session",
    courseId: "c-1",
    sessionId: "s-1",
  });
});

it("picks the first tag that names a session language", () => {
  expect(languageFromTags(["hw2", "Python", "java"])).toBe("python");
  expect(languageFromTags(["C++"])).toBe("cpp");
  expect(languageFromTags([" js "])).toBe("javascript");
  expect(languageFromTags(["recursion"])).toBe("plaintext");
  expect(languageFromTags([])).toBe("plaintext");
});
