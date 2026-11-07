import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressWatcher } from "./progress-watcher.js";
import { resourceMetadata, type Resource } from "./client.js";
import { ApiError } from "../auth/client.js";
vi.mock("./client.js", () => ({ resourceMetadata: vi.fn() }));
const request = vi.mocked(resourceMetadata);
const resource = (id = "notes"): Resource => ({
  id,
  courseId: "course",
  kind: "upload",
  fileId: `${id}-file`,
  version: 1,
  title: id,
  sectionId: null,
  visibility: "class",
  position: 0,
  createdAt: "",
  textStatus: "pending",
});
let watcher: ProgressWatcher;
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  request.mockImplementation(async (_c, id) => ({ data: resource(id) }));
  watcher = new ProgressWatcher();
});
afterEach(() => {
  watcher.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("shared extraction metadata watcher", () => {
  it("coalesces subscriptions and slows after thirty seconds", async () => {
    const first = vi.fn(),
      second = vi.fn();
    watcher.subscribe(resource(), first);
    watcher.subscribe(resource(), second);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(15);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(request).toHaveBeenCalledTimes(15);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(16);
    expect(first.mock.calls.at(-1)).toEqual(second.mock.calls.at(-1));
  });
  it("limits concurrent requests to four and cancels obsolete identities", async () => {
    const signals: AbortSignal[] = [];
    request.mockImplementation((_c, _id, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const stops = Array.from({ length: 8 }, (_, n) =>
      watcher.subscribe(resource(String(n)), vi.fn()),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals).toHaveLength(4);
    stops.forEach((stop) => stop());
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  it("stops after sixteen minutes and restarts on Check again", async () => {
    const listener = vi.fn();
    watcher.subscribe(resource(), listener);
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(listener.mock.calls.at(-1)?.[0].stopped).toBe(true);
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(calls);
    watcher.retry(resource());
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(calls + 1);
  });
  it("pauses while hidden and begins a fresh visible cycle", async () => {
    const hidden = vi.spyOn(document, "hidden", "get");
    hidden.mockReturnValue(true);
    watcher.subscribe(resource(), vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounds transient retries and clears inaccessible data", async () => {
    request.mockRejectedValue(Error("offline"));
    const listener = vi.fn();
    watcher.subscribe(resource(), listener);
    await vi.advanceTimersByTimeAsync(42_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({
      stopped: true,
      error: expect.any(String),
    });
    request.mockRejectedValue(new ApiError(404, "not_found", "missing"));
    watcher.retry(resource());
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({ inaccessible: true });
  });
  it("ignores late results after unsubscribe and never adopts a replacement", async () => {
    let resolve!: (value: { data: Resource }) => void;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const listener = vi.fn(),
      update = vi.fn();
    watcher.onUpdate = update;
    const stop = watcher.subscribe(resource(), listener);
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    resolve({ data: { ...resource(), textStatus: "ready" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();
    watcher.subscribe(resource(), listener);
    await vi.advanceTimersByTimeAsync(2000);
    resolve({ data: { ...resource(), version: 2, fileId: "replacement" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({
      resource: undefined,
      superseded: true,
    });
    const calls = request.mock.calls.length;
    watcher.retry(resource());
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it("keeps checking through a same-file version bump until text is ready", async () => {
    let data: Resource = resource();
    request.mockImplementation(async () => ({ data }));
    const listener = vi.fn(),
      update = vi.fn(),
      invalidate = vi.fn();
    watcher.onUpdate = update;
    watcher.onInvalidate = invalidate;
    watcher.subscribe(resource(), listener);
    data = { ...resource(), version: 2, title: "Renamed" };
    await vi.advanceTimersByTimeAsync(2000);
    data = { ...data, textStatus: "ready" };
    await vi.advanceTimersByTimeAsync(2000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(data);
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({ resource: data });
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it("supersedes a replaced file without adopting its progress", async () => {
    request.mockImplementation(async () => ({
      data: { ...resource(), fileId: "replacement", version: 2 },
    }));
    const listener = vi.fn(),
      update = vi.fn(),
      invalidate = vi.fn();
    watcher.onUpdate = update;
    watcher.onInvalidate = invalidate;
    watcher.subscribe(resource(), listener);
    await vi.advanceTimersByTimeAsync(2000);
    expect(update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({
      resource: undefined,
      superseded: true,
    });
  });
});

it("aborts a stalled request at the visible-cycle deadline", async () => {
  let signal: AbortSignal | undefined;
  request.mockImplementation((_course, _id, requestSignal) => {
    signal = requestSignal;
    return new Promise(() => {});
  });
  const listener = vi.fn();
  watcher.subscribe(resource(), listener);
  await vi.advanceTimersByTimeAsync(16 * 60_000);
  expect(signal?.aborted).toBe(true);
  expect(listener.mock.calls.at(-1)?.[0].stopped).toBe(true);
});
