import { describe, expect, it, vi } from "vitest";
import { initializeRoute, navigate, routeForPath } from "./routes.js";

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
});
