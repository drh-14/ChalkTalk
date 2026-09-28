import { afterEach, expect, it, vi } from "vitest";
import { createPost, getPost, listPosts } from "./client.js";

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
