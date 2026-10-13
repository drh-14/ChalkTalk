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

  it("requires matching new passwords and clears the fields on success", async () => {
    const refreshed = { ...profile, displayName: "Ada Byron", version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: profile }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ data: refreshed }, 200, '"v2"'));
    const { user } = setup(fetchMock);
    await screen.findByText(profile.email);
    await user.type(
      screen.getByLabelText("Current password"),
      "old passphrase",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "different passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("New passwords do not match")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed")).toBeTruthy();
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
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
      screen.getByLabelText("Current password"),
      "old passphrase",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "new secure passphrase",
    );
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new secure passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Password changed")).toBeTruthy();
    expect(
      await screen.findByText(/account information could not be refreshed/i),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Confirm new password") as HTMLInputElement).value,
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
