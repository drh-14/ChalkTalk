import { expect, test } from "@playwright/test";
import process from "node:process";

const grafana = process.env.TEST_GRAFANA_URL ?? "http://127.0.0.1:3001";
const app = process.env.E2E_BASE_URL ?? "https://localhost:5173";
const password = process.env.TEST_GRAFANA_PASSWORD;

test.use({ ignoreHTTPSErrors: true });

test("local Grafana shows the Loki log panel", async ({ page }) => {
  test.skip(
    !password,
    "Set TEST_GRAFANA_PASSWORD for the local monitoring stack",
  );
  const response = await page.request.get(`${app}/api/v1/never-a-real-route`);
  expect(response.status()).toBe(404);
  const requestId = response.headers()["x-request-id"];
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.goto(`${grafana}/login`);
  await page.locator('input[name="user"]').fill("admin");
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.goto(
    `${grafana}/d/chalktalk-api/chalktalk-api-observability?orgId=1&viewPanel=11`,
  );
  await expect(page.getByText("Sanitized API and worker logs")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(requestId)).toBeVisible();
  }).toPass({
    timeout: 90_000,
    intervals: [2_000],
  });
  await page.screenshot({
    path: "test-results/grafana-loki-logs.png",
    fullPage: true,
  });
});
