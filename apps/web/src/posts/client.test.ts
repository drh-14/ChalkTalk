import { afterEach, expect, it, vi } from "vitest";
import {
  createPost,
  getPost,
  listPosts,
  retractVote,
  votePoll,
} from "./client.js";

const post = {
  id: "post-1",
  courseId: "course-1",
  type: "question",
  title: "Cutoffs",
  bodyMarkdown: "Friday",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => vi.unstubAllGlobals());

it("sends course-scoped relevance search and opaque cursor with credentials", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      json({ data: [post], page: { nextCursor: "next", hasMore: true } }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    listPosts("course-1", {
      q: "A cutoff",
      sort: "relevance",
      cursor: "opaque+/",
    }),
  ).resolves.toMatchObject({ data: [post] });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/courses/course-1/posts?q=A+cutoff&sort=relevance&cursor=opaque%2B%2F",
    expect.objectContaining({ credentials: "include" }),
  );
});

it("gets a post and creates JSON with CSRF and idempotency", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ data: post }))
    .mockResolvedValueOnce(json({ data: post }, 201));
  vi.stubGlobal("fetch", fetchMock);
  await expect(getPost("post-1")).resolves.toEqual(post);
  await expect(
    createPost(
      "course-1",
      {
        type: "question",
        title: "Cutoffs",
        bodyMarkdown: "Friday",
        anonymous: false,
        tags: [],
      },
      "csrf",
      "key-1",
    ),
  ).resolves.toEqual(post);
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/v1/courses/course-1/posts",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf",
        "Idempotency-Key": "key-1",
      },
    }),
  );
});

it("recognizes a merged-post HTTP redirect without displaying the source", async () => {
  const response = json({ data: { ...post, id: "canonical-1" } });
  Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: "https://app.example.edu/api/v1/posts/canonical-1" },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(getPost("merged-1")).resolves.toEqual({
    redirectToPostId: "canonical-1",
  });
});

it("sends type, answered, and sort filters for the course feed", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    json({ data: [], page: { nextCursor: null, hasMore: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await listPosts("course-1", { type: "note", sort: "newest" });
  await listPosts("course-1", { answered: false, cursor: "next" });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/courses/course-1/posts?sort=newest&type=note",
    "/api/v1/courses/course-1/posts?cursor=next&answered=false",
  ]);
});

it("sends repeated tags and matches all of them by default", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    json({ data: [], page: { nextCursor: null, hasMore: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await listPosts("course-1", { tags: ["recursion", "exam 2"] });
  await listPosts("course-1", { tags: ["recursion", "exam"], tagMatch: "any" });
  await listPosts("course-1", { tags: ["recursion"], tagMatch: "any" });
  await listPosts("course-1", { tags: [] });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/courses/course-1/posts?tag=recursion&tag=exam+2&tagMatch=all",
    "/api/v1/courses/course-1/posts?tag=recursion&tag=exam&tagMatch=any",
    "/api/v1/courses/course-1/posts?tag=recursion",
    "/api/v1/courses/course-1/posts",
  ]);
});

it("sends the author filter for the course feed", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    json({ data: [], page: { nextCursor: null, hasMore: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await listPosts("course-1", { authorId: "user-1" });
  expect(fetchMock.mock.calls[0]![0]).toBe(
    "/api/v1/courses/course-1/posts?authorId=user-1",
  );
});

it("sends pinned, author role, and oldest sort for the course feed", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    json({ data: [], page: { nextCursor: null, hasMore: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await listPosts("course-1", { type: "note", pinned: true, sort: "oldest" });
  await listPosts("course-1", { authorRole: "ta" });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/courses/course-1/posts?sort=oldest&type=note&pinned=true",
    "/api/v1/courses/course-1/posts?authorRole=ta",
  ]);
});

it("filters announcements and polls", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation(async () =>
      json({ data: [], page: { nextCursor: null, hasMore: false } }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await listPosts("course-1", { announcement: true });
  await listPosts("course-1", { type: "poll" });
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/api/v1/courses/course-1/posts?announcement=true",
    "/api/v1/courses/course-1/posts?type=poll",
  ]);
});

it("votes and retracts with CSRF", async () => {
  const state = {
    postId: "post-1",
    options: [{ id: "o-1", label: "Mon", voteCount: 1, selected: true }],
    totalVotes: 1,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ data: state }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      json(
        { error: { code: "not_a_poll", message: "The post is not a poll" } },
        422,
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  await expect(votePoll("post-1", "o-1", "csrf")).resolves.toEqual(state);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/v1/posts/post-1/vote");
  expect(init).toMatchObject({
    method: "PUT",
    body: JSON.stringify({ optionId: "o-1" }),
    headers: { "X-CSRF-Token": "csrf" },
  });
  await expect(retractVote("post-1", "csrf")).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "DELETE" });
  await expect(retractVote("post-1", "csrf")).rejects.toThrow(
    "The post is not a poll",
  );
});
