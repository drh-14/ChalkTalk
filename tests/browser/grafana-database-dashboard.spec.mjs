import { test, expect } from "@playwright/test";
import process from "node:process";

async function openDashboard(page) {
  const base = process.env.GRAFANA_URL;
  const password = process.env.GRAFANA_TEST_PASSWORD;
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(`${base}/login`);
  await page.getByPlaceholder("email or username").fill("admin");
  await page.getByPlaceholder("password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));

  await page.goto(`${base}/d/chalktalk-api/chalktalk-api-observability`);
  await expect(page.getByText("ChalkTalk API observability")).toBeVisible();
}

test("operator sees the API and database latency overlays in private Grafana", async ({
  page,
}) => {
  test.skip(
    !process.env.GRAFANA_URL || !process.env.GRAFANA_TEST_PASSWORD,
    "Requires an isolated Grafana test instance",
  );
  await openDashboard(page);
  for (const percentile of ["P50", "P90", "P95", "P99"]) {
    const title = page.getByText(`${percentile} latency`, {
      exact: true,
    });
    await title.scrollIntoViewIfNeeded();
    await expect(title).toBeVisible();
  }
  await expect(page.getByText("Within 200 ms", { exact: true })).toHaveCount(0);
  const response = await page.request.get(
    `${process.env.GRAFANA_URL}/api/dashboards/uid/chalktalk-api`,
  );
  expect(response.ok()).toBeTruthy();
  const { dashboard } = await response.json();
  for (const panel of dashboard.panels.filter(
    (panel) => panel.type === "timeseries",
  )) {
    if (panel.id === 2) {
      expect(panel.options.legend.showLegend).toBe(false);
      continue;
    }
    for (const target of panel.targets)
      expect(target.legendFormat).toMatch(/[A-Za-z]{3,}/);
  }

  if (process.env.EXPECT_DB_DATA === "1") {
    for (const legend of ["Database query (api)", "Connection wait (api)"])
      await expect(page.getByText(legend, { exact: true })).toHaveCount(4);
  }

  await page.screenshot({
    path: "test-results/database-latency-dashboard.png",
  });

  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(0, 850);
    await page.waitForTimeout(100);
  }
  for (const title of [
    "Database attempts / second",
    "Failed database attempt fraction",
  ])
    await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("operator sees critical endpoint request and database total charts", async ({
  page,
}) => {
  test.skip(
    !process.env.GRAFANA_URL || !process.env.GRAFANA_TEST_PASSWORD,
    "Requires an isolated Grafana test instance",
  );
  await openDashboard(page);
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, 850);
    await page.waitForTimeout(100);
  }
  for (const [title, file] of [
    ["Login latency", "login-latency-dashboard.png"],
    ["Course creation latency", "course-creation-latency-dashboard.png"],
    [
      "Notification fetching latency",
      "notification-fetching-latency-dashboard.png",
    ],
  ]) {
    const heading = page.getByText(title, { exact: true });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();
    await page.screenshot({ path: `test-results/${file}` });
  }
});
