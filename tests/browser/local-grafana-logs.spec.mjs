import { expect, test } from "@playwright/test";
import process from "node:process";

const grafana = process.env.TEST_GRAFANA_URL ?? "http://127.0.0.1:3001";
const password = process.env.TEST_GRAFANA_PASSWORD;

test("local Grafana shows the Loki log panel", async ({ page }) => {
  test.skip(
    !password,
    "Set TEST_GRAFANA_PASSWORD for the local monitoring stack",
  );
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
  await expect(page.getByText("loki-test-123")).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: "test-results/grafana-loki-logs.png",
    fullPage: true,
  });
});
