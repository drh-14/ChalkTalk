import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AttachmentManager } from "./views.js";

const png = {
  id: "image-1",
  fileName: "plot.png",
  mediaType: "image/png",
  sizeBytes: 10,
  createdAt: "2026-10-18T00:00:00Z",
  downloadUrl: "/api/v1/attachments/image-1/download",
};
const document = {
  ...png,
  id: "document-1",
  fileName: "lecture.pptx",
  mediaType:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  downloadUrl: "/api/v1/attachments/document-1/download",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders course-authenticated images as centered blocks and documents as download links beneath text", () => {
  render(
    <AttachmentManager
      kind="post"
      parentId="post-1"
      attachments={[png, document]}
      canEdit={false}
      csrfToken="csrf"
      onChanged={vi.fn()}
    />,
  );
  const list = screen.getByRole("region", { name: "Attachments" });
  const image = within(list).getByRole("img", { name: "plot.png" });
  expect(image.getAttribute("src")).toBe(png.downloadUrl);
  expect(image.closest("figure")?.classList.contains("attachment-image")).toBe(
    true,
  );
  const link = within(list).getByRole("link", { name: "lecture.pptx" });
  expect(link.getAttribute("href")).toBe(document.downloadUrl);
  expect(
    within(list).queryByRole("button", { name: /remove|add files/i }),
  ).toBeNull();
});

it("lets an authorized editor remove a file without hiding the other files", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const changed = vi.fn();
  render(
    <AttachmentManager
      kind="answer"
      parentId="answer-1"
      attachments={[png, document]}
      canEdit
      csrfToken="csrf"
      onChanged={changed}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Remove plot.png" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/attachments/image-1",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(changed).toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "lecture.pptx" })).toBeTruthy();
});
