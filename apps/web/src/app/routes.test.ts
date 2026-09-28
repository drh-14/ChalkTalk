import { describe, expect, it, vi } from "vitest";
import {
  initializeRoute,
  navigate,
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
});
