import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ?? resolve(root, "test-results/advanced-polls");
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
test.afterAll(async () => {
  await vite?.close();
});

const option = (id, label, selected = false, voteCount) => ({
  id,
  label,
  selected,
  ...(voteCount === undefined ? {} : { voteCount }),
});
const base = {
  id: "p1",
  courseId: "course-1",
  type: "poll",
  deleted: false,
  title: "Review session",
  bodyMarkdown: "Choose a time.",
  author: {
    userId: "u2",
    displayName: "Instructor",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  attachments: [],
  createdAt: "2026-10-19T00:00:00Z",
  lastActivityAt: "2026-10-19T00:00:00Z",
  version: 1,
  selectionMode: "multiple",
  maxSelections: 2,
  closesAt: null,
  closed: false,
  releaseMode: "manual",
  resultsReleased: false,
  options: [
    option("mon", "Monday"),
    option("tue", "Tuesday"),
    option("wed", "Wednesday"),
  ],
};
async function mockApi(
  page,
  {
    staff = false,
    poll = base,
    deadlineLagReads = 0,
    deadlineFailReads = 0,
  } = {},
) {
  let current = JSON.parse(JSON.stringify(poll));
  const calls = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (path.endsWith("/members/u1"))
      return json({ role: staff ? "ta" : "student" });
    if (path.endsWith("/posts") && method === "GET")
      return route.fulfill({
        json: { data: [current], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/posts") && method === "POST") {
      calls.push({ action: "create", input: request.postDataJSON() });
      current = { ...base, ...request.postDataJSON(), id: "p2", version: 1 };
      return json(current, 201);
    }
    if (path.endsWith("/vote") && method === "PUT") {
      const input = request.postDataJSON();
      calls.push({ action: "vote", input });
      const ids = input.optionIds ?? [input.optionId];
      current = {
        ...current,
        options: current.options.map((item) => ({
          ...item,
          selected: ids.includes(item.id),
        })),
      };
      return json({ postId: current.id, ...current });
    }
    if (path.endsWith("/vote") && method === "DELETE") {
      current.options = current.options.map((item) => ({
        ...item,
        selected: false,
      }));
      return route.fulfill({ status: 204, body: "" });
    }
    if (path.endsWith("/poll-results.csv"))
      return route.fulfill({
        body: "Option,Count\nMonday,2\n",
        contentType: "text/csv",
      });
    if (/\/(close|reopen|release)$/.test(path) && method === "POST") {
      const action = path.split("/").at(-1);
      calls.push({ action, etag: request.headers()["if-match"] });
      current = {
        ...current,
        version: current.version + 1,
        closed:
          action === "close"
            ? true
            : action === "reopen"
              ? false
              : current.closed,
        resultsReleased: action === "release" ? true : current.resultsReleased,
      };
      return json(current);
    }
    if (path.endsWith("/clone") && method === "POST") {
      calls.push({ action: "clone" });
      current = {
        ...current,
        id: "p2",
        version: 1,
        closed: false,
        resultsReleased: false,
        closesAt: null,
        totalVotes: 0,
        options: current.options.map((item) => ({
          ...item,
          selected: false,
          voteCount: 0,
        })),
      };
      return json(current, 201);
    }
    if (path === `/api/v1/posts/${current.id}`) {
      if (current.closesAt && Date.now() >= Date.parse(current.closesAt)) {
        if (deadlineFailReads > 0) {
          deadlineFailReads -= 1;
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "temporarily_unavailable",
                message: "Temporarily unavailable",
              },
            },
          });
        }
        if (deadlineLagReads > 0) {
          deadlineLagReads -= 1;
          return json(current);
        }
        const automatic = current.releaseMode === "automatic";
        current = {
          ...current,
          closed: true,
          resultsReleased: automatic || current.resultsReleased,
          ...(automatic
            ? {
                totalVotes: 1,
                explanation: "Monday wins.",
                options: current.options.map((item, index) => ({
                  ...item,
                  voteCount: index === 0 ? 1 : 0,
                })),
              }
            : {}),
        };
      }
      return json(current);
    }
    if (path.endsWith("/answers")) return json([]);
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  return calls;
}
const shot = (page, name) =>
  page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });

test("student multi-select and hidden results, with limit and a released view", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.goto(`${origin}/attachments-fixture.html`);
  await expect(page.locator(".post-card-extras")).toHaveCount(0);
  await expect(page.getByText("Results are not released yet.")).toBeVisible();
  await expect(page.getByText(/\d+ \(\d+%\)/)).toHaveCount(0);
  await shot(page, "student-hidden");
  await page.getByRole("checkbox", { name: "Monday" }).check();
  await page.getByRole("checkbox", { name: "Tuesday" }).check();
  await expect(
    page.getByRole("checkbox", { name: "Wednesday" }),
  ).toBeDisabled();
  await shot(page, "student-multiselect-limit");
  await page.getByRole("button", { name: "Vote", exact: true }).click();
  expect(calls.at(-1)).toMatchObject({
    action: "vote",
    input: { optionIds: ["mon", "tue"] },
  });
  await expect(page.getByText("Monday · your vote")).toBeVisible();
  await shot(page, "student-voted-hidden");
});

test("staff sees aggregates and can close, release, export and clone", async ({
  page,
}) => {
  const calls = await mockApi(page, {
    staff: true,
    poll: {
      ...base,
      closesAt: "2099-01-01T12:00:00Z",
      totalVotes: 3,
      options: [
        option("mon", "Monday", false, 2),
        option("tue", "Tuesday", false, 1),
        option("wed", "Wednesday", false, 0),
      ],
    },
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await expect(page.locator(".post-card-extras")).toHaveText("3 ballots");
  await expect(page.getByText("2 (67%)")).toBeVisible();
  await shot(page, "staff-live-aggregates");
  await page.getByRole("button", { name: "Close poll" }).click();
  await expect(page.getByRole("button", { name: "Reopen poll" })).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ action: "close", etag: '"v1"' });
  await shot(page, "staff-closed");
  await page.getByRole("button", { name: "Release results" }).click();
  await expect(page.getByText("Results released.")).toBeVisible();
  await shot(page, "staff-released");
  await page.getByRole("button", { name: "Reopen poll" }).click();
  await expect(page.getByRole("button", { name: "Close poll" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Release results" }),
  ).toHaveCount(0);
  await shot(page, "staff-reopened-released");
  await page.getByRole("button", { name: "Export results" }).click();
  const exportLink = page.getByRole("link", { name: "Download CSV" });
  await expect(exportLink).toBeVisible();
  await shot(page, "staff-export");
  const downloadPromise = page.waitForEvent("download");
  await exportLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("poll-p1-results.csv");
  expect(readFileSync(await download.path(), "utf8")).toBe(
    "Option,Count\nMonday,2\n",
  );
  await page.getByRole("button", { name: "Clone poll" }).click();
  expect(calls.at(-1)).toMatchObject({ action: "clone" });
  await expect(
    page.getByRole("heading", { name: "Poll · 0 ballots" }),
  ).toBeVisible();
  await expect(
    page.locator(".post-card-extras").filter({ hasText: /^0 ballots$/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Release results" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Close poll" })).toBeVisible();
  await expect(page.getByText(/^Closes /)).toHaveCount(0);
  await expect(page.getByText("Results released.")).toHaveCount(0);
  await shot(page, "staff-cloned");
});

test("staff composer exposes poll configuration", async ({ page }) => {
  const calls = await mockApi(page, { staff: true });
  await page.goto(`${origin}/attachments-fixture.html?post=`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("combobox", { name: "Post type" }).selectOption("poll");
  const release = page.getByRole("combobox", { name: "Results release" });
  await expect(release).toHaveValue("live");
  await page
    .getByRole("combobox", { name: "Selection mode" })
    .selectOption("multiple");
  await expect(release).toHaveValue("manual");
  await expect(release.locator('option[value="live"]')).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Maximum selections" }).fill("2");
  await release.selectOption("automatic");
  await release.scrollIntoViewIfNeeded();
  await shot(page, "staff-composer");
  await page.getByRole("textbox", { name: "Post title" }).fill("Exam review");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("Choose sessions");
  await page.getByRole("textbox", { name: "Option 1" }).fill("Monday");
  await page.getByRole("textbox", { name: "Option 2" }).fill("Tuesday");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect
    .poll(() => calls.some((call) => call.action === "create"))
    .toBe(true);
  expect(calls.find((call) => call.action === "create").input).toMatchObject({
    selectionMode: "multiple",
    maxSelections: 2,
    releaseMode: "automatic",
  });
  await shot(page, "staff-created");
});

test("a released legacy single-choice poll remains voteable with radio buttons", async ({
  page,
}) => {
  const calls = await mockApi(page, {
    poll: {
      ...base,
      selectionMode: "single",
      maxSelections: 1,
      releaseMode: "live",
      resultsReleased: true,
      totalVotes: 2,
      options: [
        option("mon", "Monday", false, 1),
        option("tue", "Tuesday", false, 1),
      ],
    },
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await expect(page.locator(".post-card-extras")).toHaveText("2 votes");
  await expect(page.getByRole("radio", { name: "Monday" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Poll · 2 votes" }),
  ).toBeVisible();
  await shot(page, "student-single-choice");
  await page.getByRole("radio", { name: "Monday" }).check();
  await page.getByRole("button", { name: "Vote", exact: true }).click();
  expect(calls.at(-1)).toMatchObject({
    action: "vote",
    input: { optionId: "mon" },
  });
  await shot(page, "student-released-results");
});

test("an expired deadline blocks voting and students cannot access staff controls", async ({
  page,
}) => {
  const calls = await mockApi(page, {
    poll: { ...base, closesAt: "2020-01-01T00:00:00Z" },
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await expect(page.getByRole("heading", { name: /closed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Release results" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export results" }),
  ).toHaveCount(0);
  await shot(page, "student-deadline-closed");
  expect(calls).toEqual([]);
});

test("an open student view refreshes automatic release at its deadline", async ({
  page,
}) => {
  const closesAt = new Date(Date.now() + 4000).toISOString();
  await mockApi(page, {
    poll: { ...base, closesAt, releaseMode: "automatic" },
    deadlineLagReads: 1,
    deadlineFailReads: 1,
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await expect(page.getByRole("button", { name: "Vote" })).toBeVisible();
  await expect(page.getByText(/Results are not released/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /closed/ })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("button", { name: "Vote" })).toHaveCount(0);
  await expect(page.getByText("Monday wins.")).toBeVisible();
  await shot(page, "student-automatic-deadline-release");
});
