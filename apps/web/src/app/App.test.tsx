import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const session = {
  id: "session_123",
  user: {
    id: "user_123",
    email: "ada@example.edu",
    displayName: "Ada Lovelace",
    createdAt: "2026-09-20T14:30:00Z",
    updatedAt: "2026-09-20T14:30:00Z",
    version: 1,
  },
  expiresAt: "2026-10-20T14:30:00Z",
  csrfToken: "csrf_token",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthenticatedResponse() {
  return jsonResponse(
    {
      error: {
        code: "authentication_required",
        message: "Authentication is required",
      },
    },
    401,
  );
}

function setPath(path: string) {
  window.history.replaceState(null, "", path);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPath("/");
});

describe("ChalkTalk auth entry", () => {
  it("protects home while restoring the browser session", async () => {
    setPath("/home");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(unauthenticatedResponse()),
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    expect(window.location.pathname).toBe("/");
    expect(document.activeElement).toBe(screen.getByLabelText("Email address"));
  });

  it("signs in, redirects to static home, and signs out with the session CSRF token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.type(
      screen.getByLabelText("Password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("heading", { name: "Welcome back, Ada" });
    expect(screen.getByText("Linear Algebra II")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/current",
      expect.objectContaining({
        method: "DELETE",
        headers: { Accept: "application/json", "X-CSRF-Token": "csrf_token" },
      }),
    );
  });

  it("requests verification then creates and signs in an account from an emailed token", async () => {
    setPath("/verify-email?token=verification-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: session.user }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: session }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByRole("heading", {
      name: "Create your ChalkTalk account",
    });
    expect(window.location.search).toBe("");
    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.type(
      screen.getByLabelText("New password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByRole("heading", { name: "Welcome back, Ada" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/users",
      expect.objectContaining({
        body: JSON.stringify({
          verificationToken: "verification-token",
          displayName: "Ada",
          password: "correct horse battery staple",
        }),
      }),
    );
  });

  it("requests a school-email verification link from the landing page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("link", { name: "Create an account" });
    await user.click(screen.getByRole("link", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.click(
      screen.getByRole("button", { name: "Send verification link" }),
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Check your inbox",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/account-verification-requests",
      expect.objectContaining({
        body: JSON.stringify({ email: "ada@example.edu" }),
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
  });

  it("keeps reset requests generic and returns a completed reset to sign in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("link", { name: "Forgot password?" });
    await user.click(screen.getByRole("link", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "If an account matches that email",
    );

    cleanup();
    setPath("/reset-password?token=reset-token");
    fetchMock
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<App />);
    await screen.findByRole("heading", { name: "Set a new password" });
    await user.type(
      screen.getByLabelText("New password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Password reset",
    );
    await user.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(
      await screen.findByRole("heading", {
        name: "Discuss the work that matters.",
      }),
    ).toBeTruthy();
  });

  it("surfaces API errors and prevents duplicate pending submissions", async () => {
    let rejectLogin: ((reason: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedResponse())
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectLogin = reject;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", {
      name: "Discuss the work that matters.",
    });
    await user.type(screen.getByLabelText("Email address"), "ada@example.edu");
    await user.type(screen.getByLabelText("Password"), "incorrect password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      (screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Signing in…" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rejectLogin?.(new Error("Network unavailable"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Network unavailable",
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
