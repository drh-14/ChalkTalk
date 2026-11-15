import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {},
  getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "worker",
}));
import { loadPdf, loadPdfUrl } from "./pdf.js";

const controllers: AbortController[] = [];
function owner() {
  const controller = new AbortController();
  controllers.push(controller);
  return controller;
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const bytes = () => new Response(new Uint8Array([1, 2, 3]));
let destroy = vi.fn(async () => {});
beforeEach(() => {
  destroy = vi.fn(async () => {});
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 3 }),
    destroy,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => bytes()),
  );
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
  vi.unstubAllGlobals();
});

it("shares an original until the final consumer releases it, then reloads", async () => {
  const viewer = owner();
  const crop = owner();
  const first = await loadPdf("course", "file", viewer.signal);
  const second = await loadPdf("course", "file", crop.signal);
  expect(second).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  viewer.abort();
  expect(destroy).not.toHaveBeenCalled();
  crop.abort();
  expect(destroy).toHaveBeenCalledTimes(1);
  await loadPdf("course", "file", owner().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not share documents across course authorization boundaries", async () => {
  await loadPdf("one", "file", owner().signal);
  await loadPdf("two", "file", owner().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("releases every idle document while retaining active documents", async () => {
  const active = owner();
  await loadPdf("course", "active", active.signal);
  for (let index = 0; index < 8; index++) {
    const current = owner();
    await loadPdf("course", String(index), current.signal);
    current.abort();
  }
  expect(destroy).toHaveBeenCalledTimes(8);
  await loadPdf("course", "active", owner().signal);
  expect(fetch).toHaveBeenCalledTimes(9);
});

it("aborts a pending download only after its final consumer leaves", async () => {
  const response = pending<Response>();
  vi.mocked(fetch).mockReturnValueOnce(response.promise);
  const first = owner();
  const second = owner();
  const firstLoad = loadPdf("course", "pending", first.signal);
  const secondLoad = loadPdf("course", "pending", second.signal);
  const firstRejected = expect(firstLoad).rejects.toMatchObject({
    name: "AbortError",
  });
  const secondRejected = expect(secondLoad).rejects.toMatchObject({
    name: "AbortError",
  });
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  first.abort();
  expect(signal.aborted).toBe(false);
  second.abort();
  expect(signal.aborted).toBe(true);
  await Promise.all([firstRejected, secondRejected]);
  response.resolve(bytes());
  await loadPdf("course", "pending", owner().signal);
  expect(getDocument).toHaveBeenCalledTimes(1);
});

it.each(["original", "derived"])(
  "destroys aborted %s parsing and rejects promptly",
  async (kind) => {
    const parsed = pending<object>();
    getDocument.mockReturnValueOnce({ promise: parsed.promise, destroy });
    const current = owner();
    const load =
      kind === "original"
        ? loadPdf("course", "parse", current.signal)
        : loadPdfUrl("/copy", current.signal);
    const rejected = expect(load).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    current.abort();
    await rejected;
    expect(destroy).toHaveBeenCalledTimes(1);
    parsed.resolve({ numPages: 3 });
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledTimes(1);
  },
);

it.each(["original", "derived"])(
  "destroys failed %s parsing and permits retry",
  async (kind) => {
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("Bad PDF")),
      destroy,
    }));
    const load = () =>
      kind === "original"
        ? loadPdf("course", "bad", owner().signal)
        : loadPdfUrl("/bad-copy", owner().signal);
    await expect(load()).rejects.toThrow("Bad PDF");
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(load()).resolves.toMatchObject({ numPages: 3 });
    expect(getDocument).toHaveBeenCalledTimes(2);
  },
);

it("does not cache failed downloads or start already-aborted loads", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(loadPdf("course", "bad", owner().signal)).rejects.toThrow();
  await expect(loadPdf("course", "bad", owner().signal)).resolves.toMatchObject(
    { numPages: 3 },
  );
  const aborted = owner();
  aborted.abort();
  await expect(loadPdf("course", "new", aborted.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps a loaded derivative alive only for its owner", async () => {
  const current = owner();
  await loadPdfUrl("/copy", current.signal);
  expect(destroy).not.toHaveBeenCalled();
  current.abort();
  expect(destroy).toHaveBeenCalledTimes(1);
});
