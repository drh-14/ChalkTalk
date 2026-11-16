import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CourseHome } from "./views.js";

const source = {
  network: {
    id: "class-1",
    name: "Software Engineering",
    courseNumber: "CSE 416",
  },
  selfUid: null,
  users: [{ id: "student-1", name: "Sam", role: "student" }],
  posts: [
    {
      id: "post-1",
      type: "question",
      status: "active",
      created: "2026-01-01T00:00:00Z",
      history: [
        {
          uid: "student-1",
          subject: "Question",
          content: "Body",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      id: "post-2",
      type: "question",
      status: "private",
      created: "2026-01-01T00:00:00Z",
      history: [
        {
          uid: "student-1",
          subject: "Private",
          content: "Secret",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    },
  ],
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("previews CLI JSON, requires confirmation, and opens the imported course", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? response({
          data: {
            courseId: "imported-course",
            omittedPrivatePosts: 1,
            posts: { created: 1, updated: 0, skipped: 0 },
          },
        })
      : response({ data: [], page: { nextCursor: null, hasMore: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onOpenCourse = vi.fn();
  const user = userEvent.setup();
  render(<CourseHome csrfToken="csrf-token" onOpenCourse={onOpenCourse} />);
  await screen.findByText("You have not joined a course yet.");
  await user.click(
    screen.getByRole("button", { name: "Import Piazza course" }),
  );
  const file = new File([JSON.stringify(source)], "class.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify(source),
  });
  await user.upload(screen.getByLabelText("Piazza JSON file"), file);
  await screen.findByText(/CSE 416 Software Engineering/);
  expect(screen.getByText(/1 private post will be omitted/)).toBeTruthy();
  const submit = screen.getByRole("button", { name: "Import course" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await user.click(
    screen.getByRole("checkbox", { name: /authorized to migrate/ }),
  );
  await user.click(submit);
  await waitFor(() =>
    expect(onOpenCourse).toHaveBeenCalledWith("imported-course"),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/piazza-imports",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      body: expect.any(FormData),
    }),
  );
});

it("counts only public posts the importer can retain", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({ data: [], page: { nextCursor: null, hasMore: false } }),
    ),
  );
  const user = userEvent.setup();
  render(<CourseHome csrfToken="csrf-token" onOpenCourse={vi.fn()} />);
  await screen.findByText("You have not joined a course yet.");
  await user.click(screen.getByRole("button", { name: "Import Piazza course" }));
  const posts = [
    ...source.posts,
    { ...source.posts[0], id: "inactive", status: "deleted" },
    { ...source.posts[0], id: "empty", history: [] },
  ];
  const json = JSON.stringify({ ...source, posts });
  const file = new File([json], "class.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => json });
  await user.upload(screen.getByLabelText("Piazza JSON file"), file);
  expect(
    await screen.findByText(/1 public post and 1 person in source file/),
  ).toBeTruthy();
});
