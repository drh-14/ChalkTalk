import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../auth/client.js";
import {
  createAnswer,
  deleteAnswer,
  endorseAnswer,
  listAnswers,
  type Answer,
} from "./client.js";

const answer: Answer = {
  id: "answer-1",
  postId: "post-1",
  kind: "student",
  deleted: false,
  bodyMarkdown: "Rayleigh scattering.",
  contributors: [{ id: "user-1", displayName: "Ada" }],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-09-20T14:00:00Z",
  updatedAt: "2026-09-20T14:00:00Z",
  version: 3,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => vi.unstubAllGlobals());

it("lists a question's answers with credentials", async () => {
  const fetchMock = vi.fn().mockResolvedValue(json({ data: [answer] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(listAnswers("post/1")).resolves.toEqual([answer]);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/posts/post%2F1/answers",
    expect.objectContaining({
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
  );
});

it("creates an answer with CSRF and an idempotency key", async () => {
  const fetchMock = vi.fn().mockResolvedValue(json({ data: answer }, 201));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    createAnswer(
      "post-1",
      { bodyMarkdown: "Rayleigh scattering.", anonymous: true },
      "csrf",
      "key-1",
    ),
  ).resolves.toEqual(answer);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/posts/post-1/answers", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": "csrf",
      "Idempotency-Key": "key-1",
    },
    body: JSON.stringify({
      bodyMarkdown: "Rayleigh scattering.",
      anonymous: true,
    }),
  });
});

it("endorses and deletes with the answer's ETag", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ data: { ...answer, version: 4 } }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(endorseAnswer(answer, "csrf")).resolves.toMatchObject({
    version: 4,
  });
  await expect(deleteAnswer(answer, "csrf")).resolves.toBeUndefined();
  const headers = {
    Accept: "application/json",
    "X-CSRF-Token": "csrf",
    "If-Match": '"v3"',
  };
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/v1/answers/answer-1/endorsement",
    { method: "PUT", credentials: "include", headers },
  );
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/answers/answer-1", {
    method: "DELETE",
    credentials: "include",
    headers,
  });
});

it("maps API errors to ApiError with their code", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      json(
        {
          error: {
            code: "answer_kind_exists",
            message: "The question already has this answer kind",
          },
        },
        409,
      ),
    ),
  );
  const error = await createAnswer(
    "post-1",
    { bodyMarkdown: "x", anonymous: false },
    "csrf",
    "key-2",
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 409, code: "answer_kind_exists" });
});
