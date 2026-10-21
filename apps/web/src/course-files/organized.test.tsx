import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseResources } from "./views.js";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      String(input).includes("resource-sections")
        ? Response.json({
            data: [
              {
                id: "section",
                courseId: "course",
                title: "Reading material",
                visibility: "class",
                position: 0,
                version: 1,
              },
            ],
            version: 1,
          })
        : Response.json({
            data: [
              {
                id: "file",
                courseId: "course",
                kind: "upload",
                title: "Week one",
                fileId: "actual-file",
                fileName: "reading.pdf",
                sectionId: "section",
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
}
describe("organized course resources", () => {
  it("uses a fresh key after each successful identical link create", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          keys.push(new Headers(init.headers).get("Idempotency-Key")!);
          return Response.json(
            { data: { id: String(keys.length) } },
            { status: 201 },
          );
        }
        return Response.json({
          data: [],
          page: { hasMore: false, nextCursor: null },
          version: 1,
        });
      }),
    );
    const user = userEvent.setup();
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByText("No course resources yet.");
    for (let i = 1; i <= 2; i++) {
      await user.type(
        screen.getByRole("textbox", { name: "Link title" }),
        "Same link",
      );
      await user.type(
        screen.getByRole("textbox", { name: "Link URL" }),
        "https://example.edu",
      );
      await user.click(screen.getByRole("button", { name: "Add link" }));
      await waitFor(() => expect(keys).toHaveLength(i));
      await waitFor(() =>
        expect(
          (
            screen.getByRole("textbox", {
              name: "Link title",
            }) as HTMLInputElement
          ).value,
        ).toBe(""),
      );
    }
    expect(keys[0]).not.toBe(keys[1]);
  });
  it("retains a failed upload key and renews it after success", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          keys.push(new Headers(init.headers).get("Idempotency-Key")!);
          return keys.length === 1
            ? Response.json(
                {
                  error: { code: "service_unavailable", message: "Try again" },
                },
                { status: 503 },
              )
            : Response.json(
                { data: { id: String(keys.length) } },
                { status: 201 },
              );
        }
        return Response.json({
          data: [],
          page: { hasMore: false, nextCursor: null },
          version: 1,
        });
      }),
    );
    const user = userEvent.setup();
    const file = new File(["same"], "same.txt", {
      type: "text/plain",
      lastModified: 1,
    });
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByText("No course resources yet.");
    await user.upload(screen.getByLabelText("Choose a course file"), file);
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    expect(
      (await screen.findByRole("alert")).querySelector("p")?.textContent,
    ).toBe("Try again");
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Choose a course file") as HTMLInputElement)
          .value,
      ).toBe(""),
    );
    await user.upload(screen.getByLabelText("Choose a course file"), file);
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[1]);
  });
  it("uses a new upload key for a different File with identical metadata", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          keys.push(new Headers(init.headers).get("Idempotency-Key")!);
          return Response.json(
            { error: { message: "Try again" } },
            { status: 503 },
          );
        }
        return Response.json({
          data: [],
          page: { hasMore: false, nextCursor: null },
          version: 1,
        });
      }),
    );
    const user = userEvent.setup();
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByText("No course resources yet.");
    const picker = screen.getByLabelText("Choose a course file");
    await user.upload(
      picker,
      new File(["a"], "same.txt", { type: "text/plain", lastModified: 1 }),
    );
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() => expect(keys).toHaveLength(1));
    await user.upload(
      picker,
      new File(["b"], "same.txt", { type: "text/plain", lastModified: 1 }),
    );
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).not.toBe(keys[0]);
  });
  it("keeps a failed replacement key only for its unchanged request", async () => {
    fixture();
    const user = userEvent.setup();
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByRole("link", { name: "Week one" });
    await user.click(screen.getByRole("button", { name: "Edit Week one" }));
    const editor = screen.getByRole("form", { name: "Edit resource" });
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "PUT")
          keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        return Response.json(
          { error: { message: "Try again" } },
          { status: 503 },
        );
      }),
    );
    await user.upload(
      within(editor).getByLabelText("Replacement file"),
      new File(["one"], "same.txt", { type: "text/plain", lastModified: 1 }),
    );
    const save = within(editor).getByRole("button", { name: "Save resource" });
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(1));
    await within(editor).findByRole("alert");
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await user.clear(
      within(editor).getByRole("textbox", { name: "Resource title" }),
    );
    await user.type(
      within(editor).getByRole("textbox", { name: "Resource title" }),
      "New title",
    );
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[1]);
    await user.selectOptions(
      within(editor).getByLabelText("Resource section"),
      "",
    );
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(4));
    expect(keys[3]).not.toBe(keys[2]);
    await user.click(within(editor).getByLabelText("Staff only resource"));
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(5));
    expect(keys[4]).not.toBe(keys[3]);
    await user.upload(
      within(editor).getByLabelText("Replacement file"),
      new File(["two"], "same.txt", { type: "text/plain", lastModified: 1 }),
    );
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(6));
    expect(keys[5]).not.toBe(keys[4]);
  });
  it("does not call an off-page section empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("resource-sections")
          ? Response.json({
              data: [
                {
                  id: "later",
                  courseId: "course",
                  title: "Later",
                  visibility: "class",
                  position: 1,
                  version: 1,
                },
              ],
              version: 1,
            })
          : Response.json({
              data: [],
              page: { hasMore: true, nextCursor: "more" },
              version: 1,
            }),
      ),
    );
    render(
      <CourseResources courseId="course" canUpload={false} csrfToken="csrf" />,
    );
    const section = await screen.findByRole("region", { name: "Later" });
    expect(
      within(section).queryByText("No resources in this section."),
    ).toBeNull();
    expect(
      within(section).getByText("More resources may be on later pages."),
    ).toBeTruthy();
    expect(screen.queryByText("No course resources yet.")).toBeNull();
  });
  it("groups resource title links under actual instructor-created sections", async () => {
    fixture();
    render(
      <CourseResources courseId="course" canUpload={false} csrfToken="csrf" />,
    );
    await screen.findByRole("heading", { name: "Reading material" });
    expect(
      screen.getByRole("link", { name: "Week one" }).getAttribute("href"),
    ).toBe("/api/v1/courses/course/files/actual-file/download");
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
  });
  it("creates custom sections without displaying preset section names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [],
          page: { hasMore: false, nextCursor: null },
          version: 1,
        }),
      ),
    );
    const user = userEvent.setup();
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByText("No course resources yet.");
    expect(screen.queryByText("Homework Solutions")).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Section title" }),
      "Exam preparation",
    );
    expect(screen.getByRole("button", { name: "Add section" })).toBeTruthy();
  });
  it("keeps metadata draft visible when a conditional save fails", async () => {
    fixture();
    const user = userEvent.setup();
    render(<CourseResources courseId="course" canUpload csrfToken="csrf" />);
    await screen.findByRole("link", { name: "Week one" });
    await user.click(screen.getByRole("button", { name: "Edit Week one" }));
    const editor = screen.getByRole("form", { name: "Edit resource" });
    await user.clear(
      within(editor).getByRole("textbox", { name: "Resource title" }),
    );
    await user.type(
      within(editor).getByRole("textbox", { name: "Resource title" }),
      "My draft",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "version_conflict", message: "Resource changed" },
            }),
            { status: 412 },
          ),
      ),
    );
    await user.click(
      within(editor).getByRole("button", { name: "Save resource" }),
    );
    await within(editor).findByRole("alert");
    expect(
      (
        within(editor).getByRole("textbox", {
          name: "Resource title",
        }) as HTMLInputElement
      ).value,
    ).toBe("My draft");
  });
});
