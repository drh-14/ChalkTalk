import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(root, "docs/pr-screenshots/course-information");
let vite, origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
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
async function open(
  page,
  {
    role = "student",
    status = "active",
    empty = false,
    saveStatus = 200,
    uploadFailure = false,
    uploadStatus = 200,
    staffSaveStatus = 200,
  } = {},
) {
  let data = {
    courseId: "course-1",
    descriptionMarkdown: empty
      ? ""
      : "## Welcome to Calculus\n\nLearn **derivatives** and integrals. Office hours are listed in Staff.\n\nThe fundamental theorem relates $F\u0027(x) = f(x)$.",
    website: empty ? null : "https://example.edu/calculus",
    syllabus: empty
      ? null
      : {
          id: "syllabus-1",
          courseId: "course-1",
          fileName: "Course syllabus.pdf",
          mediaType: "application/pdf",
          sizeBytes: 1024,
          createdAt: "2026-10-21T12:00:00Z",
        },
    version: 1,
  };
  let staff = [
    {
      userId: "staff-1",
      displayName: "Maya Chen",
      role: "instructor",
      contact: empty ? "" : "maya.chen@example.edu",
      location: empty ? "" : "Mathematics Building, Room 210",
      officeHours: empty ? "" : "Tuesday and Thursday, 2–3 PM",
      version: 1,
    },
    {
      userId: "staff-2",
      displayName: "Jordan Rivera",
      role: "ta",
      contact: "jordan.rivera@example.edu",
      location: "Learning Center, Room 12",
      officeHours: "Wednesday, 10–11 AM",
      version: 1,
    },
  ];
  const requests = [];
  let nextStaffReadGate;
  let nextStaffSaveGate;
  let currentStaffSaveStatus = staffSaveStatus;
  requests.replaceStaff = (rows) => {
    staff = rows;
  };
  requests.setStaffSaveStatus = (status) => {
    currentStaffSaveStatus = status;
  };
  requests.holdNextStaffRead = () => {
    let release;
    nextStaffReadGate = new Promise((resolve) => {
      release = resolve;
    });
    return () => release();
  };
  requests.holdNextStaffSave = () => {
    let release;
    nextStaffSaveGate = new Promise((resolve) => {
      release = resolve;
    });
    return () => release();
  };
  requests.staffReads = 0;
  requests.resourceReads = 0;
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    const reply = (body, code = 200, headers = {}) =>
      route.fulfill({
        status: code,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });
    if (p === "/api/v1/sessions/current")
      return reply({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Alex Student",
            email: "alex@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (p === "/api/v1/courses/course-1/members/user-1")
      return reply({ data: { role } });
    if (p === "/api/v1/courses/course-1")
      return reply(
        { data: { id: "course-1", name: "Calculus I", status } },
        200,
        { ETag: '"v1"' },
      );
    if (p === "/api/v1/courses/course-1/information") {
      if (req.method() === "PATCH") {
        requests.push(req);
        if (saveStatus !== 200)
          return reply(
            {
              error: {
                code: "version_conflict",
                message:
                  "Course information has changed. Your draft is preserved.",
              },
            },
            saveStatus,
          );
        data = { ...data, ...req.postDataJSON(), version: data.version + 1 };
      }
      return reply({ data }, 200, { ETag: `"v${data.version}"` });
    }
    if (p === "/api/v1/courses/course-1/information/syllabus") {
      requests.push(req);
      if (uploadStatus === 412)
        return reply(
          { error: { code: "version_conflict", message: "Syllabus changed" } },
          412,
        );
      if (uploadFailure)
        return reply(
          {
            error: {
              code: "service_unavailable",
              message: "Storage unavailable. Try again.",
            },
          },
          503,
        );
      data = {
        ...data,
        version: data.version + 1,
        syllabus:
          req.method() === "DELETE"
            ? null
            : {
                id: "new-syllabus",
                courseId: "course-1",
                fileName: "New syllabus.txt",
                mediaType: "text/plain",
                sizeBytes: 9,
                createdAt: "2026-10-21T12:00:00Z",
              },
      };
      return reply({ data }, 200, { ETag: `"v${data.version}"` });
    }
    if (p === "/api/v1/courses/course-1/staff") {
      requests.staffReads += 1;
      const result = { data: staff.map((person) => ({ ...person })) };
      const gate = nextStaffReadGate;
      nextStaffReadGate = undefined;
      if (gate) await gate;
      return reply(result);
    }
    if (p === "/api/v1/courses/course-1/resources" && req.method() === "GET")
      requests.resourceReads += 1;
    if (
      p.startsWith("/api/v1/courses/course-1/staff/") &&
      req.method() === "PATCH"
    ) {
      requests.push(req);
      if (currentStaffSaveStatus === 412)
        return reply(
          { error: { code: "version_conflict", message: "Staff changed" } },
          412,
        );
      const gate = nextStaffSaveGate;
      nextStaffSaveGate = undefined;
      if (gate) await gate;
      const id = p.split("/").at(-1);
      staff = staff.map((person) =>
        person.userId === id
          ? { ...person, ...req.postDataJSON(), version: person.version + 1 }
          : person,
      );
      return reply({ data: staff.find((person) => person.userId === id) });
    }
    if (p.endsWith("/download"))
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        headers: {
          "Content-Disposition": 'attachment; filename="Course syllabus.pdf"',
        },
        body: "Syllabus contents",
      });
    return reply({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  await page.goto(`${origin}/courses/course-1/resources`);
  await expect(
    page.getByRole("tab", { name: "Resources", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return requests;
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
test("member reads formatted information and current staff, without management controls", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Calculus" }),
  ).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "derivatives" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit course information" }),
  ).toHaveCount(0);
  await shot(page, "member-information");
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  await expect(page.getByText("Tuesday and Thursday, 2–3 PM")).toBeVisible();
  await shot(page, "member-staff");
});
test("information and staff actions match established button styles", async ({
  page,
}) => {
  await open(page, { role: "instructor" });
  const background = (locator) =>
    locator.evaluate(
      (button) => globalThis.getComputedStyle(button).backgroundColor,
    );
  const primary = await background(
    page.getByRole("button", { name: "Upload file" }),
  );
  const secondary = "rgb(233, 238, 229)";
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  const edit = page.getByRole("button", { name: "Edit course information" });
  await expect.poll(() => background(edit)).toBe(primary);
  await edit.click();
  await expect
    .poll(() =>
      background(page.getByRole("button", { name: "Save information" })),
    )
    .toBe(primary);
  await expect
    .poll(() => background(page.getByRole("button", { name: "Cancel" })))
    .toBe(secondary);
  await expect
    .poll(() =>
      background(page.getByRole("button", { name: "Replace syllabus" })),
    )
    .toBe(primary);
  await expect
    .poll(() =>
      background(page.getByRole("button", { name: "Remove syllabus" })),
    )
    .toBe(secondary);
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  const editStaff = page
    .getByRole("button", { name: "Edit staff details" })
    .first();
  await expect.poll(() => background(editStaff)).toBe(secondary);
  await editStaff.click();
  await expect
    .poll(() =>
      background(page.getByRole("button", { name: "Save staff details" })),
    )
    .toBe(primary);
  await expect
    .poll(() => background(page.getByRole("button", { name: "Cancel" })))
    .toBe(secondary);
  await shot(page, "button-styles");
});
test("instructor fills empty information and current staff details", async ({
  page,
}) => {
  const requests = await open(page, { role: "instructor", empty: true });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await expect(
    page.getByText("Course information has not been added."),
  ).toBeVisible();
  await shot(page, "instructor-empty");
  await page.getByRole("button", { name: "Edit course information" }).click();
  await page
    .getByRole("textbox", { name: "Course description", exact: true })
    .fill("## Course expectations\n\nRead **before class**.");
  await page
    .getByRole("textbox", { name: "Course website" })
    .fill("https://example.edu/course");
  await page.getByRole("button", { name: "Save information" }).click();
  await expect(
    page.getByRole("heading", { name: "Course expectations" }),
  ).toBeVisible();
  expect(requests[0].headers()["if-match"]).toBe('"v1"');
  expect(requests[0].headers()["x-csrf-token"]).toBe("csrf");
  await shot(page, "instructor-information-saved");
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit staff details" })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Office hours" })
    .fill("Friday, 1–2 PM");
  await page.getByRole("button", { name: "Save staff details" }).click();
  await expect(page.getByText("Friday, 1–2 PM")).toBeVisible();
  await shot(page, "instructor-staff-saved");
});
test("syllabus replacement and removal update the visible authenticated link", async ({
  page,
}) => {
  await open(page, { role: "instructor" });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await page.getByLabel("Syllabus file").setInputFiles({
    name: "New syllabus.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Syllabus"),
  });
  await page.getByRole("button", { name: "Replace syllabus" }).click();
  await expect(
    page.getByRole("link", { name: "New syllabus.txt" }),
  ).toHaveAttribute(
    "href",
    "/api/v1/courses/course-1/files/new-syllabus/download",
  );
  await shot(page, "syllabus-replaced");
  await page.getByRole("button", { name: "Remove syllabus" }).click();
  await expect(page.getByText("No syllabus has been added.")).toBeVisible();
  await shot(page, "syllabus-removed");
});
test("failed syllabus upload preserves prior file and selection for retry", async ({
  page,
}) => {
  await open(page, { role: "instructor", uploadFailure: true });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await page.getByLabel("Syllabus file").setInputFiles({
    name: "New syllabus.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Syllabus"),
  });
  await page.getByRole("button", { name: "Replace syllabus" }).click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(
    page.getByRole("link", { name: "Course syllabus.pdf" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replace syllabus" }),
  ).toBeEnabled();
  await shot(page, "syllabus-retry-error");
});
test("stale information save retains draft until explicit reload", async ({
  page,
}) => {
  await open(page, { role: "instructor", saveStatus: 412 });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit course information" }).click();
  await page
    .getByRole("textbox", { name: "Course website" })
    .fill("https://example.edu/my-draft");
  await page.getByRole("button", { name: "Save information" }).click();
  await expect(page.getByRole("alert")).toContainText("draft is preserved");
  await expect(
    page.getByRole("textbox", { name: "Course website" }),
  ).toHaveValue("https://example.edu/my-draft");
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Course website" }),
  ).toHaveValue("https://example.edu/my-draft");
  await expect(
    page.getByRole("button", { name: "Reload latest information" }),
  ).toBeVisible();
  await shot(page, "stale-draft-preserved");
  await page.getByRole("button", { name: "Reload latest information" }).click();
  await expect(
    page.getByRole("textbox", { name: "Course website" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Course website" }),
  ).toHaveAttribute("href", "https://example.edu/calculus");
  await shot(page, "information-reloaded");
});
test("stale staff draft survives tab changes until explicit reload", async ({
  page,
}) => {
  await open(page, { role: "instructor", staffSaveStatus: 412 });
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit staff details" })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Office hours" })
    .fill("Draft office hours");
  await page.getByRole("button", { name: "Save staff details" }).click();
  await expect(page.getByRole("alert")).toContainText("Staff changed");
  await page.getByRole("tab", { name: "Resources", exact: true }).click();
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Office hours" })).toHaveValue(
    "Draft office hours",
  );
  await expect(
    page.getByRole("button", { name: "Reload latest staff details" }),
  ).toBeVisible();
  await shot(page, "stale-staff-draft-preserved");
  await page
    .getByRole("button", { name: "Reload latest staff details" })
    .click();
  await expect(page.getByRole("textbox", { name: "Office hours" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Tuesday and Thursday, 2–3 PM")).toBeVisible();
  await shot(page, "staff-reloaded");
});
test("returning to Staff refreshes membership without losing an active draft", async ({
  page,
}) => {
  const controls = await open(page, {
    role: "instructor",
    staffSaveStatus: 412,
  });
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Jordan Rivera" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit staff details" })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Office hours" })
    .fill("My current draft");
  await page.getByRole("tab", { name: "Resources", exact: true }).click();
  controls.replaceStaff([
    {
      userId: "staff-1",
      displayName: "Maya Chen",
      role: "instructor",
      contact: "new-contact@example.edu",
      location: "Room 300",
      officeHours: "Monday 1–2",
      version: 2,
    },
    {
      userId: "staff-3",
      displayName: "Sam Lee",
      role: "ta",
      contact: "sam@example.edu",
      location: "Room 12",
      officeHours: "Friday 3–4",
      version: 1,
    },
  ]);
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Jordan Rivera" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sam Lee" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Office hours" })).toHaveValue(
    "My current draft",
  );
  await page.getByRole("button", { name: "Save staff details" }).click();
  await expect(page.getByRole("alert")).toContainText("Staff changed");
  expect(controls.at(-1).headers()["if-match"]).toBe('"v1"');
  await shot(page, "staff-roster-refreshed-draft-preserved");
});
test("Resources remounts and reloads when selected again", async ({ page }) => {
  const controls = await open(page);
  await expect(
    page.getByRole("heading", { name: "Course resources", exact: true }),
  ).toBeVisible();
  const readsBeforeReturn = controls.resourceReads;
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await page.getByRole("tab", { name: "Resources", exact: true }).click();
  await expect
    .poll(() => controls.resourceReads)
    .toBeGreaterThan(readsBeforeReturn);
  await shot(page, "resources-returned");
});
test("delayed Staff refresh cannot replace a newer successful save", async ({
  page,
}) => {
  const controls = await open(page, { role: "instructor" });
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit staff details" })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Office hours" })
    .fill("Saved after refresh began");
  const releaseRead = controls.holdNextStaffRead();
  const readsBeforeReturn = controls.staffReads;
  await page.getByRole("tab", { name: "Resources", exact: true }).click();
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect
    .poll(() => controls.staffReads)
    .toBeGreaterThan(readsBeforeReturn);
  await page.getByRole("button", { name: "Save staff details" }).click();
  await expect(page.getByText("Saved after refresh began")).toBeVisible();
  const delayedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/courses/course-1/staff"),
  );
  releaseRead();
  await delayedResponse;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  await expect(page.getByText("Saved after refresh began")).toBeVisible();
  await shot(page, "staff-save-survives-delayed-refresh");
});
test("reloading one stale staff card does not interrupt another pending save", async ({
  page,
}) => {
  const controls = await open(page, {
    role: "instructor",
    staffSaveStatus: 412,
  });
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  const maya = page.locator(".course-staff-card", { hasText: "Maya Chen" });
  const jordan = page.locator(".course-staff-card", {
    hasText: "Jordan Rivera",
  });
  await jordan.getByRole("button", { name: "Edit staff details" }).click();
  await jordan
    .getByRole("textbox", { name: "Office hours" })
    .fill("Jordan draft");
  await jordan.getByRole("button", { name: "Save staff details" }).click();
  await expect(
    jordan.getByRole("button", { name: "Reload latest staff details" }),
  ).toBeVisible();
  controls.setStaffSaveStatus(200);
  await maya.getByRole("button", { name: "Edit staff details" }).click();
  await maya
    .getByRole("textbox", { name: "Office hours" })
    .fill("Maya pending save");
  const releaseSave = controls.holdNextStaffSave();
  await maya.getByRole("button", { name: "Save staff details" }).click();
  await expect(
    maya.getByRole("button", { name: "Save staff details" }),
  ).toBeDisabled();
  const releaseRead = controls.holdNextStaffRead();
  await jordan
    .getByRole("button", { name: "Reload latest staff details" })
    .click();
  await expect(maya.getByRole("textbox", { name: "Office hours" })).toHaveValue(
    "Maya pending save",
  );
  releaseSave();
  await expect(maya.getByText("Maya pending save")).toBeVisible();
  const delayedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/courses/course-1/staff"),
  );
  releaseRead();
  await delayedResponse;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  await expect(maya.getByText("Maya pending save")).toBeVisible();
  await shot(page, "staff-reload-preserves-other-save");
});
test("explicit reload clears a stale selected syllabus file", async ({
  page,
}) => {
  await open(page, { role: "instructor", uploadStatus: 412 });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await page.getByLabel("Syllabus file").setInputFiles({
    name: "New syllabus.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Syllabus"),
  });
  await page.getByRole("button", { name: "Replace syllabus" }).click();
  await expect(page.getByRole("alert")).toContainText("Syllabus changed");
  await page.getByRole("button", { name: "Reload latest information" }).click();
  await expect(page.getByLabel("Syllabus file")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Replace syllabus" }),
  ).toBeDisabled();
  await shot(page, "syllabus-selection-reloaded");
});
test("mobile archived member reads both tabs without write controls or overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { role: "instructor", status: "archived" });
  await page
    .getByRole("tab", { name: "Course information", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Calculus" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit course information" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await shot(page, "mobile-archived-information");
  await page.getByRole("tab", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  await shot(page, "mobile-staff");
});
