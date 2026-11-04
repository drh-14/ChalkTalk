import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resource, SearchResult } from "./client.js";
import { CourseResources } from "./views.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: "lecture",
  courseId: "course",
  kind: "upload",
  title: "Lecture 7",
  fileId: "lecture-file",
  fileName: "lecture-7.pdf",
  mediaType: "application/pdf",
  sizeBytes: 2048,
  textStatus: "ready",
  sectionId: "section",
  visibility: "class",
  version: 1,
  position: 0,
  createdAt: "2026-10-31T12:00:00Z",
  ...overrides,
});
const hit = (
  overrides: Partial<Resource> = {},
  snippet: SearchResult["match"]["snippet"] = {
    text: "the eigenvalues of a symmetric matrix",
    highlights: [{ start: 4, length: 11 }],
  },
): SearchResult => ({
  resource: resource(overrides),
  match: { inTitle: false, snippet },
});

/** Mocks sections, the catalog and search; `searches` answers successive search calls. */
function api(options: {
  catalog?: Resource[];
  searches?: (Response | (() => Response | Promise<Response>))[];
}) {
  const searchUrls: string[] = [];
  let next = 0;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/resources/search")) {
      searchUrls.push(url);
      const answer = options.searches?.[next++];
      if (!answer) throw new Error(`Unexpected search ${url}`);
      return typeof answer === "function" ? answer() : answer;
    }
    if (url.includes("resource-sections"))
      return Response.json({
        data: [
          {
            id: "section",
            courseId: "course",
            title: "Linear algebra",
            visibility: "class",
            position: 0,
            version: 1,
          },
        ],
        version: 1,
      });
    return Response.json({
      data: options.catalog ?? [resource({ id: "catalog", title: "Week one" })],
      page: { hasMore: false, nextCursor: null },
      version: 1,
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, searchUrls };
}
const page = (data: SearchResult[], nextCursor: string | null = null) =>
  Response.json({ data, page: { hasMore: !!nextCursor, nextCursor } });

describe("resource search", () => {
  it("debounces typing into one search and shows ranked results with highlights", async () => {
    const { searchUrls } = api({ searches: [page([hit()])] });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await screen.findByRole("link", { name: "Week one" });
    await user.type(
      screen.getByRole("searchbox", { name: "Search resources" }),
      "eigenvalue",
    );
    const results = await screen.findByRole("region", {
      name: "Search results",
    });
    await within(results).findByRole("link", { name: "Lecture 7" });
    expect(searchUrls).toHaveLength(1);
    expect(new URL(searchUrls[0]!, "https://x").searchParams.get("q")).toBe(
      "eigenvalue",
    );
    expect(within(results).getByText("Linear algebra")).toBeTruthy();
    expect(
      within(results)
        .getAllByRole("mark")
        .map((mark) => mark.textContent),
    ).toEqual(["eigenvalues"]);
    expect(
      within(results)
        .getByRole("link", { name: "Lecture 7" })
        .getAttribute("href"),
    ).toBe("/api/v1/courses/course/files/lecture-file/download");
    expect(screen.queryByRole("link", { name: "Week one" })).toBeNull();
  });

  it("renders HTML-like snippet text as text, never markup", async () => {
    api({
      searches: [
        page([
          hit(
            {},
            {
              text: "Never trust <script>alert('x')</script> <b>input</b>",
              highlights: [{ start: 6, length: 5 }],
            },
          ),
        ]),
      ],
    });
    const user = userEvent.setup();
    const { container } = render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await user.type(
      await screen.findByRole("searchbox", { name: "Search resources" }),
      "trust",
    );
    await screen.findByRole("link", { name: "Lecture 7" });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".resource-snippet b")).toBeNull();
    expect(container.querySelector(".resource-snippet")!.textContent).toBe(
      "Never trust <script>alert('x')</script> <b>input</b>",
    );
  });

  it("links search hits for external links in a new tab and labels ungrouped results", async () => {
    api({
      searches: [
        page([
          {
            resource: resource({
              id: "link",
              kind: "link",
              title: "Applet",
              url: "https://example.edu/applet",
              sectionId: null,
              fileId: undefined,
              textStatus: undefined,
            }),
            match: { inTitle: true, snippet: null },
          },
        ]),
      ],
    });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await user.type(
      await screen.findByRole("searchbox", { name: "Search resources" }),
      "applet",
    );
    const link = await screen.findByRole("link", { name: "Applet" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Ungrouped")).toBeTruthy();
  });

  it("loads more results with the returned cursor", async () => {
    const { searchUrls } = api({
      searches: [
        page([hit()], "next-page"),
        page([hit({ id: "second", title: "Lecture 8" })]),
      ],
    });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await user.type(
      await screen.findByRole("searchbox", { name: "Search resources" }),
      "matrix",
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    await screen.findByRole("link", { name: "Lecture 8" });
    expect(screen.getByRole("link", { name: "Lecture 7" })).toBeTruthy();
    expect(
      new URL(searchUrls[1]!, "https://x").searchParams.get("cursor"),
    ).toBe("next-page");
    expect(
      screen.queryByRole("button", { name: "Load more results" }),
    ).toBeNull();
  });

  it("discards a load-more response that arrives after the query changed", async () => {
    let answerMore!: (response: Response) => void;
    const more = new Promise<Response>((resolve) => (answerMore = resolve));
    const { fetch, searchUrls } = api({
      searches: [
        page([hit({ id: "matrix-1", title: "Matrix one" })], "matrix-next"),
        () => more,
        page([hit({ id: "vector-1", title: "Vector one" })], "vector-next"),
        page([hit({ id: "vector-2", title: "Vector two" })]),
      ],
    });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    const box = await screen.findByRole("searchbox", {
      name: "Search resources",
    });
    await user.type(box, "matrix");
    await user.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    const moreRequest = fetch.mock.calls.find(([url]) =>
      String(url).includes("cursor=matrix-next"),
    ) as unknown as [string, RequestInit];
    expect(moreRequest[1].signal?.aborted).toBe(false);
    await user.clear(box);
    await user.type(box, "vector");
    await screen.findByRole("link", { name: "Vector one" });
    expect(moreRequest[1].signal?.aborted).toBe(true);

    await act(async () => {
      answerMore(
        page([hit({ id: "matrix-2", title: "Matrix two" })], "stale-cursor"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("link", { name: "Matrix two" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Matrix one" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Load more results" }));
    await screen.findByRole("link", { name: "Vector two" });
    const last = new URL(searchUrls.at(-1)!, "https://x").searchParams;
    expect(last.get("q")).toBe("vector");
    expect(last.get("cursor")).toBe("vector-next");
  });

  it("shows an empty state and a retryable error while keeping the query", async () => {
    api({
      searches: [
        Response.json(
          { error: { code: "service_unavailable", message: "Search is down" } },
          { status: 503 },
        ),
        page([]),
      ],
    });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    const box = await screen.findByRole("searchbox", {
      name: "Search resources",
    });
    await user.type(box, "nothing");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search is down",
    );
    expect((box as HTMLInputElement).value).toBe("nothing");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("No resources match “nothing”."),
    ).toBeTruthy();
    expect((box as HTMLInputElement).value).toBe("nothing");
  });

  it("restores the catalog and its sort when the query is cleared", async () => {
    const { fetch } = api({ searches: [page([hit()])] });
    const user = userEvent.setup();
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await screen.findByRole("link", { name: "Week one" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort resources" }),
      "title",
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => String(url).includes("sort=title")),
      ).toBe(true),
    );
    const catalogCalls = fetch.mock.calls.length;
    const box = screen.getByRole("searchbox", { name: "Search resources" });
    await user.type(box, "matrix");
    await screen.findByRole("link", { name: "Lecture 7" });
    await user.clear(box);
    expect(await screen.findByRole("link", { name: "Week one" })).toBeTruthy();
    expect(
      (
        screen.getByRole("combobox", {
          name: "Sort resources",
        }) as HTMLSelectElement
      ).value,
    ).toBe("title");
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
    expect(
      fetch.mock.calls
        .slice(catalogCalls)
        .filter(([url]) => !String(url).includes("/search")),
    ).toEqual([]);
  });

  it("keeps open edits across a search, unreachable while results show", async () => {
    api({ searches: [page([hit()])] });
    const user = userEvent.setup();
    render(
      <CourseResources courseId="course" canUpload staff csrfToken="csrf" />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Edit section Linear algebra",
      }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Section name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Section name" }),
      "Spectral theory",
    );
    await user.click(screen.getByRole("button", { name: "Edit Week one" }));
    await user.clear(screen.getByRole("textbox", { name: "Resource title" }));
    await user.type(
      screen.getByRole("textbox", { name: "Resource title" }),
      "Week one revised",
    );
    const replacement = new File(["%PDF-1.7"], "revised.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Replacement file"), replacement);

    const box = screen.getByRole("searchbox", { name: "Search resources" });
    await user.type(box, "matrix");
    await screen.findByRole("link", { name: "Lecture 7" });
    expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Resource title" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save section" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save resource" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Sort resources" }),
    ).toBeNull();

    await user.clear(box);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Section name",
        }) as HTMLInputElement
      ).value,
    ).toBe("Spectral theory");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Resource title",
        }) as HTMLInputElement
      ).value,
    ).toBe("Week one revised");
    expect(
      (screen.getByLabelText("Replacement file") as HTMLInputElement).files![0],
    ).toBe(replacement);
  });
});

describe("staff text status indicator", () => {
  const catalog = [
    resource({ id: "pending", title: "Pending file", textStatus: "pending" }),
    resource({ id: "failed", title: "Failed file", textStatus: "failed" }),
    resource({
      id: "unsupported",
      title: "Unsupported file",
      textStatus: "unsupported",
    }),
    resource({ id: "ready", title: "Ready file", textStatus: "ready" }),
  ];

  it("tells TAs and instructors which files' contents are not searchable", async () => {
    api({ catalog });
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff
        csrfToken="csrf"
      />,
    );
    await screen.findByRole("link", { name: "Ready file" });
    expect(screen.getByText("Contents not searchable yet")).toBeTruthy();
    expect(
      screen.getByText("Contents could not be read for search"),
    ).toBeTruthy();
    expect(screen.getByText("Contents are not searchable")).toBeTruthy();
    expect(document.querySelectorAll(".resource-text-status")).toHaveLength(3);
  });

  it("hides the indicator from students", async () => {
    api({ catalog });
    render(
      <CourseResources
        courseId="course"
        canUpload={false}
        staff={false}
        csrfToken="csrf"
      />,
    );
    await screen.findByRole("link", { name: "Failed file" });
    expect(document.querySelectorAll(".resource-text-status")).toHaveLength(0);
  });
});
