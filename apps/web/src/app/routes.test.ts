import { describe, expect, it, vi } from "vitest";
import {
  feedSearch,
  filtersFromSearch,
  initializeRoute,
  navigate,
  replaceCurrentFilters,
  replaceCurrentQuery,
  routeForPath,
  routeFromLocation,
} from "./routes.js";

describe("routes", () => {
  it("recognizes public and protected paths and sends unknown paths to landing", () => {
    expect(routeForPath("/")).toBe("landing");
    expect(routeForPath("/verify-email")).toBe("verify-email");
    expect(routeForPath("/reset-password")).toBe("reset-password");
    expect(routeForPath("/home")).toBe("home");
    expect(routeForPath("/missing")).toBe("landing");
  });

  it("retains emailed tokens only in active state and removes them from history", () => {
    const replace = vi.fn();
    const route = initializeRoute(
      new URL("https://app.example.edu/verify-email?token=opaque-token"),
      { replaceState: replace } as unknown as History,
    );

    expect(route).toEqual({ name: "verify-email", token: "opaque-token" });
    expect(replace).toHaveBeenCalledWith(null, "", "/verify-email");
  });

  it("updates browser history and notifies the app when navigating", () => {
    const listener = vi.fn();
    window.addEventListener("popstate", listener);

    navigate("/home");

    expect(window.location.pathname).toBe("/home");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", listener);
  });

  it("replaces only q on the current URL and notifies the app", () => {
    window.history.replaceState(
      null,
      "",
      "/courses/abc/posts/p1?view=compact&q=old#reply",
    );
    const listener = vi.fn();
    window.addEventListener("popstate", listener);

    replaceCurrentQuery("new term");

    expect(window.location.pathname).toBe("/courses/abc/posts/p1");
    expect(window.location.search).toBe("?view=compact&q=new+term");
    expect(window.location.hash).toBe("#reply");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", listener);
  });

  it("keeps live edits out of Back history while retaining shareable q", async () => {
    window.history.replaceState(null, "", "/home");
    navigate("/courses/abc");
    replaceCurrentQuery("first");
    replaceCurrentQuery("final");
    expect(window.location.search).toBe("?q=final");
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await popped;
    expect(window.location.pathname).toBe("/home");
  });

  it("recognizes discussion, selected post, and settings while retaining q", () => {
    expect(
      routeFromLocation(
        new URL("https://app.example.edu/courses/abc?q=A%20cutoff"),
      ),
    ).toEqual({ name: "course", courseId: "abc", query: "A cutoff" });
    expect(
      routeFromLocation(
        new URL("https://app.example.edu/courses/abc/posts/post-1?q=limits"),
      ),
    ).toEqual({
      name: "post",
      courseId: "abc",
      postId: "post-1",
      query: "limits",
    });
    expect(
      routeFromLocation(
        new URL("https://app.example.edu/courses/abc/settings"),
      ),
    ).toEqual({ name: "course-settings", courseId: "abc" });
    expect(
      routeFromLocation(
        new URL("https://app.example.edu/courses/abc/resources"),
      ),
    ).toEqual({ name: "course-resources", courseId: "abc" });
  });

  it("restores submitted q and selection from browser history", async () => {
    window.history.replaceState(null, "", "/courses/abc?q=cutoff");
    navigate("/courses/abc/posts/post-1?q=cutoff");
    expect(routeFromLocation(new URL(window.location.href))).toMatchObject({
      name: "post",
      postId: "post-1",
      query: "cutoff",
    });
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await popped;
    expect(routeFromLocation(new URL(window.location.href))).toMatchObject({
      name: "course",
      courseId: "abc",
      query: "cutoff",
    });
  });

  it("round-trips feed filters and preserves them on post paths", () => {
    const route = routeFromLocation(
      new URL(
        "https://app.example.edu/courses/abc/posts/p1?q=cutoff&filter=question&tag=midterm&sort=oldest",
      ),
    );
    expect(route).toEqual({
      name: "post",
      courseId: "abc",
      postId: "p1",
      query: "cutoff",
      filters: { filter: "question", tags: ["midterm"], sort: "oldest" },
    });
    expect(feedSearch(route.query, route.filters)).toBe(
      "?q=cutoff&filter=question&tag=midterm&sort=oldest",
    );
    expect(feedSearch(undefined, { filter: "mine" })).toBe("?filter=mine");
    expect(feedSearch()).toBe("");
  });

  it("ignores unknown or invalid filter values", () => {
    expect(
      filtersFromSearch(
        new URLSearchParams(
          "filter=Bad%20Key&sort=sideways&tag=%20%20&extra=1",
        ),
      ),
    ).toEqual({});
    expect(
      routeFromLocation(new URL("https://app.example.edu/courses/abc?sort=x")),
    ).toEqual({ name: "course", courseId: "abc" });
    for (const filter of [
      "question:pinned",
      "question:unanswered",
      "other",
      "all",
    ])
      expect(
        routeFromLocation(
          new URL(`https://app.example.edu/courses/abc?filter=${filter}`),
        ),
      ).toEqual({ name: "course", courseId: "abc" });
    for (const filter of ["mine", "instructors", "tas", "question", "note"])
      expect(filtersFromSearch(new URLSearchParams({ filter }))).toEqual({
        filter,
      });
  });

  it("reads repeated tags in order, normalized and capped at ten", () => {
    const tags = Array.from({ length: 12 }, (_, index) => `tag=t${index}`);
    expect(
      filtersFromSearch(
        new URLSearchParams(
          `tag=%20Recursion%20&tag=exam-2&tag=recursion&tag=${"x".repeat(45)}&tag=`,
        ),
      ),
    ).toEqual({ tags: ["Recursion", "exam-2", "x".repeat(40)] });
    expect(filtersFromSearch(new URLSearchParams(tags.join("&"))).tags).toEqual(
      Array.from({ length: 10 }, (_, index) => `t${index}`),
    );
  });

  it("keeps tagMatch=any only with two or more tags and round-trips it", () => {
    expect(
      filtersFromSearch(new URLSearchParams("tag=a&tag=b&tagMatch=any")),
    ).toEqual({ tags: ["a", "b"], tagMatch: "any" });
    for (const search of [
      "tag=a&tagMatch=any",
      "tag=a&tag=b&tagMatch=all",
      "tag=a&tag=b&tagMatch=both",
      "tagMatch=any",
    ])
      expect(
        filtersFromSearch(new URLSearchParams(search)).tagMatch,
      ).toBeUndefined();
    expect(
      feedSearch("q", { tags: ["a", "b"], tagMatch: "any", sort: "newest" }),
    ).toBe("?q=q&tag=a&tag=b&tagMatch=any&sort=newest");
    expect(feedSearch(undefined, { tags: ["a"], tagMatch: "any" })).toBe(
      "?tag=a",
    );
    expect(feedSearch(undefined, { tags: [] })).toBe("");
  });

  it("replaces filters in the current entry while keeping the search query", () => {
    window.history.replaceState(null, "", "/courses/abc?q=cutoff&filter=note");
    const listener = vi.fn();
    window.addEventListener("popstate", listener);
    const length = window.history.length;
    replaceCurrentFilters({ filter: "question", sort: "newest" });
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/courses/abc?q=cutoff&filter=question&sort=newest",
    );
    expect(window.history.length).toBe(length);
    expect(listener).toHaveBeenCalledOnce();
    replaceCurrentFilters({ tags: ["a", "b"], tagMatch: "any" });
    expect(window.location.search).toBe("?q=cutoff&tag=a&tag=b&tagMatch=any");
    replaceCurrentFilters({});
    expect(window.location.search).toBe("?q=cutoff");
    window.removeEventListener("popstate", listener);
    window.history.replaceState(null, "", "/");
  });

  it("drops a chosen sort when the search changes, keeping the other filters", () => {
    window.history.replaceState(
      null,
      "",
      "/courses/abc?q=cutoff&filter=note&sort=newest",
    );
    replaceCurrentQuery("deadline");
    expect(window.location.search).toBe("?q=deadline&filter=note");
    window.history.replaceState(null, "", "/courses/abc?q=cutoff&sort=newest");
    replaceCurrentQuery("cutoff");
    expect(window.location.search).toBe("?q=cutoff&sort=newest");
    window.history.replaceState(null, "", "/");
  });
});
