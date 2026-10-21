import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseResourcesArea } from "./views.js";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const model = {
  courseId: "course",
  descriptionMarkdown: "## Course overview\nLearn **calculus**.",
  website: "https://example.edu/course",
  syllabus: null,
  version: 1,
};
function fixture() {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/information"))
        return new Response(JSON.stringify({ data: model }), {
          headers: { ETag: '"v1"' },
        });
      if (url.endsWith("/staff"))
        return Response.json({
          data: [
            {
              userId: "ada",
              displayName: "Ada Lovelace",
              role: "instructor",
              contact: "ada@example.edu",
              location: "Room 10",
              officeHours: "Tuesday 2–3",
              version: 1,
            },
          ],
        });
      return Response.json({
        data: [],
        page: { hasMore: false, nextCursor: null },
      });
    }),
  );
  return requests;
}
describe("course information and staff", () => {
  it("preserves initial Resources and renders course Markdown for students without editor controls", async () => {
    fixture();
    const user = userEvent.setup();
    render(
      <CourseResourcesArea
        courseId="course"
        canEdit={false}
        csrfToken="csrf"
      />,
    );
    expect(
      screen
        .getByRole("tab", { name: "Resources" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Course information" }));
    await screen.findByRole("heading", { name: "Course overview" });
    expect(screen.getByText("calculus").tagName).toBe("STRONG");
    expect(
      screen.queryByRole("button", { name: "Edit course information" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Course website" }).getAttribute("href"),
    ).toBe(model.website);
  });
  it("shows current staff contacts and office hours without account controls", async () => {
    fixture();
    const user = userEvent.setup();
    render(
      <CourseResourcesArea
        courseId="course"
        canEdit={false}
        csrfToken="csrf"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Staff" }));
    await screen.findByRole("heading", { name: "Ada Lovelace" });
    expect(screen.getByText("Tuesday 2–3")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit staff details" }),
    ).toBeNull();
  });
  it("retains an instructor draft after a stale save and requires explicit reload", async () => {
    fixture();
    const user = userEvent.setup();
    render(<CourseResourcesArea courseId="course" canEdit csrfToken="csrf" />);
    await user.click(screen.getByRole("tab", { name: "Course information" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit course information" }),
    );
    const website = screen.getByRole("textbox", { name: "Course website" });
    await user.clear(website);
    await user.type(website, "https://example.edu/draft");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "version_conflict",
                message: "Course information has changed",
              },
            }),
            { status: 412 },
          ),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save information" }));
    await screen.findByRole("alert");
    expect((website as HTMLInputElement).value).toBe(
      "https://example.edu/draft",
    );
    expect(
      screen.getByRole("button", { name: "Reload latest information" }),
    ).toBeTruthy();
  });
  it("sends conditional instructor saves with csrf and shows formatted saved text", async () => {
    const requests = fixture();
    const user = userEvent.setup();
    render(<CourseResourcesArea courseId="course" canEdit csrfToken="csrf" />);
    await user.click(screen.getByRole("tab", { name: "Course information" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit course information" }),
    );
    await user.click(screen.getByRole("button", { name: "Save information" }));
    await waitFor(() =>
      expect(requests.some((r) => r.init?.method === "PATCH")).toBe(true),
    );
    const saved = requests.find((r) => r.init?.method === "PATCH")!;
    expect(saved.init?.headers).toMatchObject({
      "If-Match": '"v1"',
      "X-CSRF-Token": "csrf",
    });
  });
  it("supports arrow and Home/End keyboard navigation between resource tabs", async () => {
    fixture();
    const user = userEvent.setup();
    render(
      <CourseResourcesArea
        courseId="course"
        canEdit={false}
        csrfToken="csrf"
      />,
    );
    screen.getByRole("tab", { name: "Resources" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Course information" }),
    );
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Resources" }),
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Course information" }),
    );
  });
});
