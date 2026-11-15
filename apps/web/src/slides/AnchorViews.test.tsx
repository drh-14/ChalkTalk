import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PostAnchor } from "../posts/client.js";
import { CourseResources } from "../course-files/views.js";
import { AnchorBlock, AnchorChip } from "./AnchorViews.js";

const crop = vi.fn();
vi.mock("./AnchorCrop.js", () => ({
  default: (props: { label: string; fileId: string }) => {
    crop(props);
    return <figure role="img" aria-label={props.label} />;
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  crop.mockReset();
});

const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
const current: PostAnchor = {
  page: 14,
  box,
  status: "current",
  resourceId: "r1",
  fileId: "f1",
  resourceTitle: "Lecture 7",
};

it("labels feed cards by slides and page, without loading the PDF", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(<AnchorChip anchor={current} />);
  expect(screen.getByText("Lecture 7 · p. 14")).toBeTruthy();
  rerender(<AnchorChip anchor={{ ...current, status: "earlier_version" }} />);
  expect(screen.getByText("Lecture 7 · p. 14 · earlier version")).toBeTruthy();
  rerender(<AnchorChip anchor={{ page: 3, box, status: "unavailable" }} />);
  expect(screen.getByText("Slides unavailable")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(crop).not.toHaveBeenCalled();
});

it("shows the crop and a View on slides link for current slides", async () => {
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  render(
    <AnchorBlock
      courseId="c1"
      postId="p9"
      anchor={current}
      onNavigate={onNavigate}
    />,
  );
  expect(
    await screen.findByRole("img", {
      name: "The asked-about area of Lecture 7, page 14",
    }),
  ).toBeTruthy();
  expect(crop).toHaveBeenCalledWith(
    expect.objectContaining({ fileId: "f1", page: 14, box }),
  );
  await user.click(screen.getByRole("link", { name: "View on slides" }));
  expect(onNavigate).toHaveBeenCalledWith(
    "/courses/c1/resources/r1/view?page=14&post=p9",
  );
});

it("explains earlier and unavailable slides without a crop", () => {
  const { rerender } = render(
    <AnchorBlock
      courseId="c1"
      postId="p9"
      anchor={{ ...current, status: "earlier_version" }}
      onNavigate={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/Asked about page 14 of an earlier version of/),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Lecture 7" }).getAttribute("href"),
  ).toBe("/courses/c1/resources/r1/view");
  rerender(
    <AnchorBlock
      courseId="c1"
      postId="p9"
      anchor={{ page: 14, box, status: "unavailable" }}
      onNavigate={vi.fn()}
    />,
  );
  expect(
    screen.getByText("The slides for this question are no longer available."),
  ).toBeTruthy();
  expect(crop).not.toHaveBeenCalled();
});

it("opens PDFs in the viewer from the catalog and downloads other files", async () => {
  const upload = (id: string, title: string, mediaType: string) => ({
    id,
    courseId: "course",
    kind: "upload",
    title,
    fileId: `${id}-file`,
    fileName: title,
    mediaType,
    sectionId: null,
    visibility: "class",
    version: 1,
    position: 0,
    createdAt: "2026-10-21T12:00:00Z",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      String(input).includes("resource-sections")
        ? Response.json({ data: [], version: 1 })
        : Response.json({
            data: [
              upload("slides", "Lecture 7", "application/pdf"),
              upload(
                "notes",
                "Notes",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ),
              {
                id: "site",
                courseId: "course",
                kind: "link",
                title: "Visualizer",
                url: "https://example.edu/viz",
                sectionId: null,
                visibility: "class",
                version: 1,
                position: 0,
                createdAt: "2026-10-21T12:00:00Z",
              },
            ],
            page: { hasMore: false, nextCursor: null },
            version: 1,
          }),
    ),
  );
  render(
    <CourseResources
      courseId="course"
      csrfToken="csrf"
      canUpload={false}
      staff={false}
    />,
  );
  const slides = await screen.findByRole("link", { name: "Lecture 7" });
  expect(slides.getAttribute("href")).toBe(
    "/courses/course/resources/slides/view",
  );
  expect(
    screen
      .getByRole("link", { name: "Download Lecture 7" })
      .getAttribute("href"),
  ).toBe("/api/v1/courses/course/files/slides-file/download");
  expect(screen.getByRole("link", { name: "Notes" }).getAttribute("href")).toBe(
    "/api/v1/courses/course/files/notes-file/download",
  );
  expect(screen.queryByRole("link", { name: "Download Notes" })).toBeNull();
  const link = screen.getByRole("link", { name: "Visualizer" });
  expect(link.getAttribute("target")).toBe("_blank");
});
