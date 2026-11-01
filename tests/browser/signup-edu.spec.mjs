import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(root, "docs/pr-screenshots/signup-edu");
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

test("signup rejects non-.edu locally and accepts a .edu subdomain", async ({
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
  await page.getByRole("link", { name: "Create an account" }).click();
  const email = page.getByRole("textbox", { name: "Email address" });
  await email.fill("student@example.com");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toContainText(".edu");
  expect(verificationRequests).toHaveLength(0);
  await page.screenshot({
    path: resolve(screenshots, "nonacademic-rejected.png"),
    fullPage: true,
  });

  await email.fill(`${"a".repeat(65)}@school.edu`);
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("alert")).toContainText("1–64 characters");
  expect(verificationRequests).toHaveLength(0);
  await page.screenshot({
    path: resolve(screenshots, "malformed-local-part-rejected.png"),
    fullPage: true,
  });

  await email.fill("Student@Dept.State.EDU");
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  expect(verificationRequests).toEqual([{ email: "Student@Dept.State.EDU" }]);
  await page.screenshot({
    path: resolve(screenshots, "academic-accepted.png"),
    fullPage: true,
  });
});
