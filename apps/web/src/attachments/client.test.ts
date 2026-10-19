import { afterEach, expect, it, vi } from "vitest";
import { deleteAttachment, uploadAttachment } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

it("uploads a selected file to its parent with CSRF and a stable idempotency key", async () => {
  const attachment = {
    id: "file-1",
    fileName: "figure.png",
    mediaType: "image/png",
    sizeBytes: 3,
    createdAt: "2026-10-18T00:00:00Z",
    downloadUrl: "/api/v1/attachments/file-1/download",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: attachment }), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["png"], "figure.png", { type: "image/png" });
  await expect(
    uploadAttachment("followup", "reply-1", file, "csrf", "key-1"),
  ).resolves.toEqual(attachment);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/v1/followups/reply-1/attachments");
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("include");
  expect(init.headers).toEqual({
    Accept: "application/json",
    "X-CSRF-Token": "csrf",
    "Idempotency-Key": "key-1",
  });
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get("file")).toEqual(file);
});

it("deletes only the selected attachment", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await deleteAttachment("file-1", "csrf");
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/attachments/file-1", {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRF-Token": "csrf" },
  });
});
