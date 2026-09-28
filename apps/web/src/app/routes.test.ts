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
        "https://app.example.edu/courses/abc/posts/p1?q=cutoff&type=note&tag=midterm&sort=newest",
      ),
    );
    expect(route).toEqual({
      name: "post",
      courseId: "abc",
      postId: "p1",
      query: "cutoff",
      filters: { type: "note", tag: "midterm", sort: "newest" },
    });
    expect(feedSearch(route.query, route.filters)).toBe(
      "?q=cutoff&type=note&tag=midterm&sort=newest",
    );
    expect(feedSearch(undefined, { answered: false })).toBe("?answered=false");
    expect(feedSearch()).toBe("");
  });

  it("ignores unknown or invalid filter values", () => {
    expect(
      filtersFromSearch(
        new URLSearchParams(
          "type=poll&answered=true&sort=relevance&tag=%20%20&extra=1",
        ),
      ),
    ).toEqual({});
    expect(
      filtersFromSearch(new URLSearchParams("answered=false&type=note")),
    ).toEqual({ answered: false });
    expect(
      routeFromLocation(new URL("https://app.example.edu/courses/abc?sort=x")),
    ).toEqual({ name: "course", courseId: "abc" });
  });

  it("replaces filters in the current entry while keeping the search query", () => {
    window.history.replaceState(null, "", "/courses/abc?q=cutoff&type=note");
    const listener = vi.fn();
    window.addEventListener("popstate", listener);
    const length = window.history.length;

    replaceCurrentFilters({ answered: false, sort: "newest" });

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/courses/abc?q=cutoff&answered=false&sort=newest",
    );
    expect(window.history.length).toBe(length);
    expect(listener).toHaveBeenCalledOnce();
    replaceCurrentFilters({});
    expect(window.location.search).toBe("?q=cutoff");
    window.removeEventListener("popstate", listener);
    window.history.replaceState(null, "", "/");
  });
});
