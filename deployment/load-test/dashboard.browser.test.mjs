/* global process, URL, window */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "@playwright/test";

const browserTest =
  process.env.GRAFANA_TEST_URL && process.env.K6_TESTID ? test : test.skip;

browserTest(
  "Grafana shows correlated client, API/DB, and VM panels",
  async () => {
    const screenshots = process.env.GRAFANA_SCREENSHOT_DIR ?? "/tmp";
    await mkdir(screenshots, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const url = new URL(process.env.GRAFANA_TEST_URL);
      url.searchParams.set("var-testid", process.env.K6_TESTID);
      url.searchParams.set("from", "now-30m");
      url.searchParams.set("to", "now");
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      let visible = await page.locator("body").innerText();
      assert.match(visible, /Client P50 latency/);
      assert.match(visible, /Client list_courses/);
      await page.screenshot({ path: `${screenshots}/load-test-client.png` });

      await page.evaluate(() => window.scrollTo(0, 1100));
      await page.waitForTimeout(2500);
      visible = await page.locator("body").innerText();
      assert.match(visible, /DB query \(client-observed\)/);
      assert.match(visible, /DB pool wait/);
      assert.match(visible, /P95/);
      await page.screenshot({ path: `${screenshots}/load-test-api-db.png` });

      await page.evaluate(() => window.scrollTo(0, 2400));
      await page.waitForTimeout(2500);
      visible = await page.locator("body").innerText();
      assert.match(visible, /VM CPU used/);
      assert.match(visible, /VM filesystem available/);
      assert.match(visible, /Free \/|Available/);
      await page.screenshot({ path: `${screenshots}/load-test-vm.png` });
    } finally {
      await browser.close();
    }
  },
  60_000,
);
