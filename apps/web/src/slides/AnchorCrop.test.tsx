import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { loadPdf } = vi.hoisted(() => ({ loadPdf: vi.fn() }));
vi.mock("./pdf.js", () => ({ loadPdf }));
import AnchorCrop from "./AnchorCrop.js";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  loadPdf.mockReset();
});
const props = {
  courseId: "course",
  fileId: "file",
  page: 1,
  box: { x: 0, y: 0, width: 1, height: 1 },
  label: "Preview",
};
it("releases crop ownership and its buffer on unmount", async () => {
  const cancel = vi.fn();
  const draw = vi.fn(() => ({ promise: Promise.resolve(), cancel }));
  loadPdf.mockResolvedValue({
    getPage: async () => ({
      getViewport: () => ({ width: 800, height: 600 }),
      render: draw,
    }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  const view = render(<AnchorCrop {...props} />);
  await waitFor(() => expect(draw).toHaveBeenCalled());
  const canvas = view.container.querySelector("canvas")!;
  const signal = loadPdf.mock.calls[0]![2] as AbortSignal;
  expect(canvas.width).toBeGreaterThan(0);
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalled();
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});
it("releases a pending crop before it can request a page", async () => {
  let resolve!: (doc: unknown) => void;
  loadPdf.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const getPage = vi.fn();
  const view = render(<AnchorCrop {...props} />);
  const signal = loadPdf.mock.calls[0]![2] as AbortSignal;
  view.unmount();
  resolve({ getPage });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(getPage).not.toHaveBeenCalled();
});

it("releases crop ownership and pixels after a render failure", async () => {
  let fail!: (reason: unknown) => void;
  const rendering = new Promise<void>((_, reject) => {
    fail = reject;
  });
  const draw = vi.fn(() => ({ promise: rendering, cancel() {} }));
  loadPdf.mockResolvedValue({
    getPage: async () => ({
      getViewport: () => ({ width: 800, height: 600 }),
      render: draw,
    }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  const view = render(<AnchorCrop {...props} />);
  await waitFor(() => expect(draw).toHaveBeenCalled());
  const canvas = view.container.querySelector("canvas")!;
  fail(new Error("Render failed"));
  await waitFor(() =>
    expect(view.container.textContent).toContain("couldn't load"),
  );
  expect((loadPdf.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});
