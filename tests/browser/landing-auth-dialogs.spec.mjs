import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/landing-auth-dialogs");
mkdirSync(screenshots, { recursive: true });
let vite;
let origin;

test.beforeAll(async () => {
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => vite?.close());

async function mockUnauthenticated(page) {
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/sessions/current"))
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "authentication_required", message: "Sign in" },
        },
      });
    if (
      route.request().url().endsWith("/account-verification-requests") ||
      route.request().url().endsWith("/password-reset-requests")
    )
      return route.fulfill({ status: 202, body: "" });
    return route.fulfill({ status: 404, body: "" });
  });
}

test("landing introduces features and modal flows stay accessible", async ({
  page,
}) => {
  await mockUnauthenticated(page);
  await page.goto(origin);
  await expect(
    page.getByRole("heading", {
      name: "Your all in one course Q & A platform",
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Your email domain determines your organization."),
  ).toHaveCount(0);
  for (const name of [
    "Course Q&A",
    "Announcements & course info",
    "Organized resources",
    "Notifications",
    "Live collaboration",
  ])
    await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "landing-desktop.png"),
    fullPage: true,
  });

  const loginButton = page.getByRole("button", { name: "Log in" });
  await loginButton.click();
  const dialog = page.getByRole("dialog", { name: "Sign in to ChalkTalk" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Email address" }),
  ).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "login-dialog.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(loginButton).toBeFocused();

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("dialog", { name: "Verify your email" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "signup-dialog.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("dialog", { name: "Reset your password" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "reset-request-dialog.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Create account" }),
  ).toBeFocused();
  await loginButton.click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("old@example.com");
  await page.mouse.click(4, 4);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await loginButton.click();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toHaveValue("");
});

test("pending sign-in cannot hide the dialog and failure restores dismissal", async ({
  page,
}) => {
  await mockUnauthenticated(page);
  let releaseLogin;
  const loginReceived = new Promise((resolve) => {
    page.route("**/api/v1/sessions", async (route) => {
      resolve();
      await new Promise((resume) => {
        releaseLogin = resume;
      });
      await route.fulfill({
        status: 401,
        json: {
          error: {
            code: "invalid_credentials",
            message: "Wrong email or password",
          },
        },
      });
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Log in" }).click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("ada@example.com");
  await page.getByLabel("Password").fill("incorrect password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await loginReceived;
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(
    page.getByRole("dialog", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create account" })
    .click({ force: true });
  await expect(
    page.getByRole("dialog", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "login-pending.png"),
    fullPage: true,
  });
  releaseLogin();
  await expect(page.getByRole("alert")).toHaveText("Wrong email or password");
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeEnabled();
  await page.screenshot({
    path: resolve(screenshots, "login-error.png"),
    fullPage: true,
  });
});

test("successful sign-in navigates home from the visible dialog", async ({
  page,
}) => {
  const user = {
    id: "user_1",
    email: "ada@example.com",
    displayName: "Ada",
    version: 1,
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
  };
  await page.route("**/api/v1/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/sessions/current"))
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "authentication_required", message: "Sign in" },
        },
      });
    if (url.endsWith("/sessions"))
      return route.fulfill({
        status: 201,
        json: {
          data: {
            id: "session_1",
            user,
            csrfToken: "csrf",
            expiresAt: "2026-11-16T00:00:00Z",
          },
        },
      });
    return route.fulfill({
      status: 200,
      json: { data: [], page: { nextCursor: null, hasMore: false } },
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Log in" }).click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${origin}/home`);
  await expect(
    page.getByRole("heading", { name: "Welcome back, Ada" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "login-success-home.png"),
    fullPage: true,
  });
});

test("restored session bypasses the public auth dialog", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/sessions/current"))
      return route.fulfill({
        status: 200,
        json: {
          data: {
            id: "session_restored",
            user: {
              id: "user_1",
              email: "ada@example.com",
              displayName: "Ada",
              version: 1,
            },
            csrfToken: "csrf",
            expiresAt: "2026-11-16T00:00:00Z",
          },
        },
      });
    return route.fulfill({
      status: 200,
      json: { data: [], page: { nextCursor: null, hasMore: false } },
    });
  });
  await page.goto(origin);
  await expect(page).toHaveURL(`${origin}/home`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Welcome back, Ada" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "restored-session-home.png"),
    fullPage: true,
  });
});

test("emailed token routes remain dedicated and reset success opens login", async ({
  page,
}) => {
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/sessions/current"))
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "authentication_required", message: "Sign in" },
        },
      });
    if (route.request().url().endsWith("/password-resets"))
      return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${origin}/verify-email?token=verification-token`);
  await expect(
    page.getByRole("heading", { name: "Create your ChalkTalk account" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${origin}/verify-email`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "verify-email-route.png"),
    fullPage: true,
  });

  await page.goto(`${origin}/reset-password?token=reset-token`);
  await expect(
    page.getByRole("heading", { name: "Set a new password" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${origin}/reset-password`);
  await page.screenshot({
    path: resolve(screenshots, "reset-password-route.png"),
    fullPage: true,
  });
  await page
    .getByLabel("New password", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByLabel("Confirm new password")
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(
    page.getByRole("dialog", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Password reset. You can now sign in.",
  );
  await page.screenshot({
    path: resolve(screenshots, "reset-success-login.png"),
    fullPage: true,
  });
});

test("mobile landing and dialog remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mockUnauthenticated(page);
  await page.goto(origin);
  await expect(
    page.getByRole("heading", {
      name: "Your all in one course Q & A platform",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "landing-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("dialog", { name: "Verify your email" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "signup-mobile.png"),
    fullPage: true,
  });
});

test("reset request keeps account existence private and incomplete links stay on dedicated routes", async ({
  page,
}) => {
  await mockUnauthenticated(page);
  await page.goto(origin);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("someone@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If an account matches that email, we’ll send a password reset link.",
  );
  await page.screenshot({
    path: resolve(screenshots, "reset-request-generic.png"),
    fullPage: true,
  });
  await page.goto(`${origin}/verify-email`);
  await expect(
    page.getByRole("heading", {
      name: "This verification link is incomplete.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`${origin}/reset-password`);
  await expect(
    page.getByRole("heading", {
      name: "This password reset link is incomplete.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "incomplete-reset-link.png"),
    fullPage: true,
  });
});
