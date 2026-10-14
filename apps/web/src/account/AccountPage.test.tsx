import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPage } from "./AccountPage.js";
import type { Session, User } from "../auth/client.js";

const profile: User = {
  id: "user_123",
  email: "ada@example.edu",
  displayName: "Ada Lovelace",
  createdAt: "2026-09-20T14:30:00Z",
  updatedAt: "2026-09-20T14:30:00Z",
  version: 1,
};
const session: Session = {
  id: "session_123",
  user: profile,
  expiresAt: "2026-10-20T14:30:00Z",
  csrfToken: "csrf_token",
};

function json(data: unknown, status = 200, etag = '"v1"') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

function setup(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const onUserChange = vi.fn();
  const onDeleted = vi.fn();
  render(
    <AccountPage
      session={session}
      onUserChange={onUserChange}
      onDeleted={onDeleted}
    />,
  );
  return { onUserChange, onDeleted, user: userEvent.setup() };
}

describe("account page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the profile and updates a name with its current revision", async () => {
    const changed = { ...profile, displayName: "Ada Byron", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(json({ data: changed }, 200, '"v2"'));
    const { user, onUserChange } = setup(fetchMock);

    expect(await screen.findByText(profile.email)).toBeTruthy();
    const name = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Name updated")).toBeTruthy();
    expect(onUserChange).toHaveBeenCalledWith(changed);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/users/me",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"v1"' }),
      }),
    );
  });

  it("submits the trimmed name that passed validation", async () => {
    const trimmed = "A".repeat(100);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(
        json({ data: { ...profile, displayName: trimmed } }, 200, '"v2"'),
      );
    const { user } = setup(fetchMock);
    const name = await screen.findByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, `${trimmed} `);
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Name updated")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/users/me",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ displayName: trimmed }),
      }),
    );
  });

  it("places password under Profile and Delete account beneath it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    setup(fetchMock);
    await screen.findByText(profile.email);

    const profileSection = screen.getByRole("region", { name: "Profile" });
    const deleteSection = screen.getByRole("region", {
      name: "Delete account",
    });
    expect(
      within(profileSection).getByRole("heading", { name: "Password" }),
    ).toBeTruthy();
    expect(within(profileSection).getByLabelText("New password")).toBeTruthy();
    expect(
      within(profileSection).queryByLabelText("Current password"),
    ).toBeNull();
    expect(
      profileSection.compareDocumentPosition(deleteSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a red field error for an empty display name", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    const name = await screen.findByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.tab();

    const error = await screen.findByText("Enter a display name");
    expect(error.classList.contains("error")).toBe(true);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe(error.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a field error when the display name exceeds 100 characters", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    const name = await screen.findByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, "A".repeat(101));
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Use 1 to 100 characters")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a red field error for a short new password without opening confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    const newPassword = screen.getByLabelText("New password");
    await user.type(newPassword, "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    const error = await screen.findByText("Use 12 to 128 characters");
    expect(error.classList.contains("error")).toBe(true);
    expect(newPassword.getAttribute("aria-invalid")).toBe("true");
    expect(newPassword.getAttribute("aria-describedby")).toBe(error.id);
    expect(
      screen.queryByRole("dialog", { name: "Confirm password change" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a new password longer than 128 characters", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(screen.getByLabelText("New password"), "x".repeat(129));
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Use 12 to 128 characters")).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Confirm password change" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for the current password in a dialog and clears both fields on success", async () => {
    const refreshed = { ...profile, displayName: "Ada Byron", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ data: refreshed }, 200, '"v2"'));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm password change",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const current = within(dialog).getByLabelText("Current password");
    expect(document.activeElement).toBe(current);
    await user.type(current, "old passphrase");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm change" }),
    );
    expect(await screen.findByText("Password changed")).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Confirm password change" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Display name",
        }) as HTMLInputElement
      ).value,
    ).toBe("Ada Byron");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/users/me/password",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: "old passphrase",
          newPassword: "new secure passphrase",
        }),
      }),
    );
  });

  it("cancels password confirmation without submitting or losing the new password", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    const trigger = screen.getByRole("button", { name: "Change password" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "Confirm password change",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Confirm password change" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value,
    ).toBe("new secure passphrase");
    expect(document.activeElement).toBe(trigger);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and shows a red error under a wrong current password", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: "invalid_credentials",
              message: "Current password is invalid",
            },
          },
          401,
        ),
      );
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm password change",
    });
    const current = within(dialog).getByLabelText("Current password");
    await user.type(current, "wrong password");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm change" }),
    );

    const error = await within(dialog).findByText(
      "Current password is invalid",
    );
    expect(error.classList.contains("error")).toBe(true);
    expect(current.getAttribute("aria-invalid")).toBe("true");
    expect(current.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("shows a field error when password confirmation has no current password", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm password change",
    });
    const current = within(dialog).getByLabelText("Current password");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm change" }),
    );

    expect(
      await within(dialog).findByText("Enter your current password"),
    ).toBeTruthy();
    expect(current.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful password change after profile refresh fails", async () => {
    const latest = { ...profile, displayName: "Ada Byron", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(
        json({ error: { code: "version_conflict", message: "Stale" } }, 412),
      )
      .mockResolvedValueOnce(json({ data: latest }, 200, '"v2"'));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm password change",
    });
    await user.type(
      within(dialog).getByLabelText("Current password"),
      "old passphrase",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm change" }),
    );

    expect(await screen.findByText("Password changed")).toBeTruthy();
    expect(
      await screen.findByText(/account information could not be refreshed/i),
    ).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Confirm password change" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText(profile.email)).toBeTruthy();
    const name = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, "Ada B");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText(/changed elsewhere/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/users/me",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"v1"' }),
      }),
    );
  });

  it("requires a separate deletion confirmation and handles a final-instructor conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(
        json(
          { error: { code: "last_instructor", message: "Last instructor" } },
          409,
        ),
      );
    const { user, onDeleted } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete account" });
    expect(within(dialog).getByText(/pseudonymized/i)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const openDialog = screen.getByRole("dialog", { name: "Delete account" });
    await user.type(
      within(openDialog).getByLabelText("Current password"),
      "old passphrase",
    );
    await user.click(
      within(openDialog).getByRole("button", { name: "Confirm deletion" }),
    );
    expect(
      await within(openDialog).findByText(/final instructor/i),
    ).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("signs out after a successful confirmed deletion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { user, onDeleted } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete account" });
    await user.type(
      within(dialog).getByLabelText("Current password"),
      "old passphrase",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deletion" }),
    );
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it("refreshes a stale profile revision before allowing another name edit", async () => {
    const latest = { ...profile, displayName: "Ada B", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(
        json({ error: { code: "version_conflict", message: "Stale" } }, 412),
      )
      .mockResolvedValueOnce(json({ data: latest }, 200, '"v2"'));
    const { user } = setup(fetchMock);
    const name = await screen.findByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText(/changed elsewhere/i)).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe("Ada B");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the deletion dialog open after a wrong password", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: "invalid_credentials",
              message: "Current password is invalid",
            },
          },
          401,
        ),
      );
    const { user, onDeleted } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete account" });
    await user.type(
      within(dialog).getByLabelText("Current password"),
      "wrong password",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm deletion" }),
    );
    expect(
      await within(dialog).findByText("Current password is invalid"),
    ).toBeTruthy();
    const password = within(dialog).getByLabelText("Current password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe(
      "delete-password-error",
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside the deletion confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: profile }));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete account" });
    const password = within(dialog).getByLabelText("Current password");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm deletion",
    });
    expect(document.activeElement).toBe(password);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(password);
  });
});
