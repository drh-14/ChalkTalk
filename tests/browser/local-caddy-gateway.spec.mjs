import { expect, test } from "@playwright/test";
import process from "node:process";

const gateway = process.env.E2E_CADDY_URL;

test.use({ ignoreHTTPSErrors: true });

test("local HTTPS gateway serves the login page, API health, and Vite HMR WSS", async ({
  page,
}) => {
  test.skip(!gateway, "Set E2E_CADDY_URL to a running local Compose gateway");

  // The UI flow does not need a real account or seeded database.
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"error":"unauthorized"}',
    }),
  );
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(gateway);
  await expect(
    page.getByRole("heading", { name: "Sign in to ChalkTalk" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      sockets.some((url) => url.startsWith(gateway.replace(/^https:/, "wss:"))),
    )
    .toBe(true);
  const health = await page.request.get(`${gateway}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  await page.screenshot({
    path: process.env.E2E_SCREENSHOTS_DIR
      ? `${process.env.E2E_SCREENSHOTS_DIR}/local-caddy-login.png`
      : "test-results/local-caddy-login.png",
    fullPage: true,
  });
});
