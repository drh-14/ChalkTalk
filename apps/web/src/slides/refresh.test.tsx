import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useQuestions } from "./use-questions.js";
import { useSearchableCopy } from "./use-searchable-copy.js";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const questions = {
  resourceId: "r",
  fileId: "f",
  data: [],
  earlierVersionCount: 0,
};
const copy = (status: string, fileId = "f") => ({
  data: {
    fileId,
    status,
    pageCount: null,
    sizeBytes: null,
    viewUrl: null,
    downloadUrl: null,
  },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {});
}
it("distinguishes loading, failure, and a successful empty retry", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(response(questions));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useQuestions("c", "r", "f"));
  expect(result.current.loading).toBe(true);
  expect(result.current.questions).toBeUndefined();
  await flush();
  expect(result.current.error).not.toBe("");
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.error).toBe("");
  expect(result.current.questions?.data).toEqual([]);
});
it("refreshes every 15 seconds, preserves data on failure and resumes on visibility", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(questions))
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(() => Promise.resolve(response(questions)));
  vi.stubGlobal("fetch", fetch);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const { result } = renderHook(() => useQuestions("c", "r", "f"));
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.questions).toEqual(questions);
  expect(result.current.error).not.toBe("");
  visibility.mockReturnValue("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.current.error).toBe("");
});
it("retains original markers and stops refresh when the file was replaced", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(questions))
    .mockResolvedValue(response({ ...questions, fileId: "new" }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useQuestions("c", "r", "f"));
  await flush();
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.changed).toBe(true);
  expect(result.current.questions?.fileId).toBe("f");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("clears protected questions when access is revoked", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(questions))
    .mockResolvedValue(response({ error: { code: "not_found" } }, 404));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useQuestions("c", "r", "f"));
  await flush();
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.unavailable).toBe(true);
  expect(result.current.questions).toBeUndefined();
});
it("does not prepare a copy until explicitly requested, and does not repeat POST on mode return", async () => {
  const fetch = vi
    .fn()
    .mockImplementation((_url, options) =>
      Promise.resolve(
        response(copy(options.method === "POST" ? "pending" : "not_requested")),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(
    ({ enabled }) => useSearchableCopy("c", "r", "f", "csrf", enabled),
    { initialProps: { enabled: true } },
  );
  await flush();
  expect(
    fetch.mock.calls.every(([, options]) => options.method !== "POST"),
  ).toBe(true);
  act(() => result.current.retry(true));
  await flush();
  expect(
    fetch.mock.calls.filter(([, options]) => options.method === "POST"),
  ).toHaveLength(1);
  rerender({ enabled: false });
  await flush();
  rerender({ enabled: true });
  await flush();
  expect(
    fetch.mock.calls.filter(([, options]) => options.method === "POST"),
  ).toHaveLength(1);
});
it("polls pending copies within bounds, offers check again, and stops when disabled", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(response(copy("pending"))));
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(
    ({ enabled }) => useSearchableCopy("c", "r", "f", "csrf", enabled),
    { initialProps: { enabled: true } },
  );
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16 * 60_000);
  });
  expect(result.current.stalled).toBe(true);
  const count = fetch.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(count);
  act(() => result.current.retry());
  await flush();
  expect(result.current.stalled).toBe(false);
  rerender({ enabled: false });
  await flush();
  const paused = fetch.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(paused);
});
it("refuses to publish a searchable copy for a replacement file", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(copy("ready", "new"))),
      ),
  );
  const { result } = renderHook(() =>
    useSearchableCopy("c", "r", "f", "csrf", true),
  );
  await flush();
  expect(result.current.changed).toBe(true);
  expect(result.current.data).toBeUndefined();
});
