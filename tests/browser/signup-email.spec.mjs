import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/signup-email");
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

test("signup accepts valid domains and rejects malformed addresses", async ({
  page,
}) => {
  const verificationRequests = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/sessions/current"))
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "authentication_required", message: "Sign in" },
        },
      });
    if (request.url().endsWith("/account-verification-requests")) {
      verificationRequests.push(request.postDataJSON());
      return route.fulfill({ status: 202, body: "" });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Create account" }).click();
  const email = page.getByRole("textbox", { name: "Email address" });
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter an email address.");
  expect(verificationRequests).toHaveLength(0);
  await page.screenshot({
    path: resolve(screenshots, "empty-email-rejected.png"),
    fullPage: true,
  });

  await email.fill("student@example.com");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If this address is eligible for a new account, check your inbox for a verification link.",
  );
  expect(verificationRequests).toEqual([{ email: "student@example.com" }]);
  await page.screenshot({
    path: resolve(screenshots, "nonacademic-accepted.png"),
    fullPage: true,
  });

  await email.fill(`${"a".repeat(65)}@school.edu`);
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use a valid ASCII email local part (1–64 characters, with single dots).",
  );
  expect(verificationRequests).toHaveLength(1);
  await page.screenshot({
    path: resolve(screenshots, "malformed-local-part-rejected.png"),
    fullPage: true,
  });

  await email.fill("student,admin@school.edu");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use a valid ASCII email local part (1–64 characters, with single dots).",
  );
  expect(verificationRequests).toHaveLength(1);
  await page.screenshot({
    path: resolve(screenshots, "invalid-local-punctuation-rejected.png"),
    fullPage: true,
  });

  await email.fill("student@bad..edu");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use an email address with a valid domain.",
  );
  expect(verificationRequests).toHaveLength(1);
  await page.screenshot({
    path: resolve(screenshots, "invalid-domain-rejected.png"),
    fullPage: true,
  });

  await email.fill(
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.edu`,
  );
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email address must be 254 characters or fewer.",
  );
  expect(verificationRequests).toHaveLength(1);
  await page.screenshot({
    path: resolve(screenshots, "overlong-email-rejected.png"),
    fullPage: true,
  });

  await email.fill("Student@Dept.State.EDU");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If this address is eligible for a new account, check your inbox for a verification link.",
  );
  expect(verificationRequests).toEqual([
    { email: "student@example.com" },
    { email: "Student@Dept.State.EDU" },
  ]);
  await page.screenshot({
    path: resolve(screenshots, "academic-accepted.png"),
    fullPage: true,
  });
});

test("an already registered email receives the same generic signup guidance", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/sessions/current")) {
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "authentication_required", message: "Sign in" },
        },
      });
    }
    if (route.request().url().endsWith("/account-verification-requests")) {
      expect(route.request().postDataJSON()).toEqual({
        email: "registered@example.com",
      });
      return route.fulfill({ status: 202, body: "" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Create account" }).click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("registered@example.com");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If this address is eligible for a new account, check your inbox for a verification link.",
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reset password" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "existing-account-generic-confirmation.png"),
    fullPage: true,
  });
});
