import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAttachmentQueue } from "./queue.js";

afterEach(() => vi.unstubAllGlobals());

it("counts successfully uploaded composer files against the five-file cap", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "first-file",
            fileName: "one.png",
            mediaType: "image/png",
            sizeBytes: 1,
            createdAt: "2026-10-18T00:00:00Z",
            downloadUrl: "/api/v1/attachments/first-file/download",
          },
        }),
        { status: 201 },
      ),
    ),
  );
  const { result } = renderHook(useAttachmentQueue);
  const first = new File(["x"], "one.png", { type: "image/png" });
  const event = (files: File[]) =>
    ({ target: { files, value: "selected" } }) as never;
  act(() => result.current.select(event([first])));
  await act(async () => {
    expect(await result.current.upload("post", "post-1", "csrf")).toBe(true);
  });
  expect(result.current.files).toHaveLength(0);
  expect(result.current.uploadedCount).toBe(1);

  act(() =>
    result.current.select(
      event(
        Array.from(
          { length: 5 },
          (_, index) =>
            new File(["x"], `extra-${index}.png`, { type: "image/png" }),
        ),
      ),
    ),
  );
  expect(result.current.files).toHaveLength(0);
  expect(result.current.selectionError).toMatch(/at most five files/i);
});

it("retries only failed files using their original idempotency keys", async () => {
  const calls: { key: string; name: string }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const form = init.body as FormData;
    const file = form.get("file") as File;
    calls.push({
      key: (init.headers as Record<string, string>)["Idempotency-Key"],
      name: file.name,
    });
    if (calls.length === 2)
      return new Response(
        JSON.stringify({
          error: { code: "service_unavailable", message: "Retry later" },
        }),
        { status: 503 },
      );
    return new Response(
      JSON.stringify({
        data: {
          id: file.name,
          fileName: file.name,
          mediaType: file.type,
          sizeBytes: file.size,
          createdAt: "2026-10-19T00:00:00Z",
          downloadUrl: `/api/v1/attachments/${file.name}/download`,
        },
      }),
      { status: 201 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useAttachmentQueue);
  act(() =>
    result.current.select({
      target: {
        files: [
          new File(["x"], "one.png", { type: "image/png" }),
          new File(["y"], "two.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
        value: "selected",
      },
    } as never),
  );
  await act(async () => {
    expect(await result.current.upload("answer", "answer-1", "csrf")).toBe(
      false,
    );
  });
  expect(result.current.files).toHaveLength(1);
  expect(result.current.files[0].file.name).toBe("two.docx");
  expect(result.current.files[0].error).toBe("Retry later");
  await act(async () => {
    expect(await result.current.upload("answer", "answer-1", "csrf")).toBe(
      true,
    );
  });
  expect(calls.map((call) => call.name)).toEqual([
    "one.png",
    "two.docx",
    "two.docx",
  ]);
  expect(calls[1].key).toBe(calls[2].key);
  expect(result.current.files).toHaveLength(0);
  expect(result.current.uploadedCount).toBe(2);
});
