import { test, expect } from "@playwright/test";
import process from "node:process";

test("operator sees the database latency panels in private Grafana", async ({
  page,
}) => {
  const base = process.env.GRAFANA_URL;
  const password = process.env.GRAFANA_TEST_PASSWORD;
  test.skip(!base || !password, "Requires an isolated Grafana test instance");

  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(`${base}/login`);
  await page.getByPlaceholder("email or username").fill("admin");
  await page.getByPlaceholder("password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));

  await page.goto(`${base}/d/chalktalk-api/chalktalk-api-observability`);
  await expect(page.getByText("ChalkTalk API observability")).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 850);
    await page.waitForTimeout(100);
  }
  for (const title of [
    "p50 database query duration",
    "p95 database query duration",
    "p50 database pool wait",
    "p95 database pool wait",
    "Database attempts / second",
    "Failed database attempt fraction",
  ])
    await expect(page.getByText(title)).toBeVisible();
  await page
    .getByText("p50 database query duration")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: "test-results/database-latency-dashboard.png",
  });
});
