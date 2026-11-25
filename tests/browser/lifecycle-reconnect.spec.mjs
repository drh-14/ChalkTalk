import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { Server } from "@hocuspocus/server";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(
  root,
  "documentation/browser-screenshots/lifecycle",
);
let vite, origin, collab;
const connections = new Set();
const session = {
  id: "session-1",
  courseId: "course-1",
  title: "Drain reconnect check",
  language: "python",
  status: "active",
  createdBy: "user-1",
  finalSnapshotConfirmed: null,
  participants: [
    {
      userId: "user-1",
      displayName: "Maya Chen",
      role: "creator",
      permission: "edit",
    },
  ],
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  endedAt: null,
  version: 1,
};
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
  collab = new Server({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
    async onAuthenticate() {
      return { userId: "user-1" };
    },
    async connected({ connection }) {
      connections.add(connection);
    },
    async onDisconnect({ connection }) {
      connections.delete(connection);
    },
  });
  await collab.listen();
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => {
  await vite?.close();
  await collab?.destroy();
});
test("transient restart retains local text and fresh-ticket reconnect across recoverable 503", async ({
  page,
}) => {
  test.setTimeout(45000);
  let tickets = 0;
  let transient = false;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (path === "/api/v1/sessions/current")
      return reply({
        data: {
          id: "auth",
          user: {
            id: "user-1",
            displayName: "Maya Chen",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/courses/course-1")
      return reply({
        data: { id: "course-1", name: "Calculus I", status: "active" },
      });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return reply({ data: { role: "student" } });
    if (path === "/api/v1/collaboration-sessions/session-1")
      return reply({ data: session });
    if (path.endsWith("/connection-tickets")) {
      tickets++;
      if (transient) {
        transient = false;
        return reply(
          {
            error: {
              code: "service_unavailable",
              message: "Service is temporarily unavailable",
            },
          },
          503,
        );
      }
      return reply({
        data: {
          ticket: `fresh-ticket-${tickets}`,
          webSocketUrl: collab.webSocketURL,
          permission: "write",
        },
      });
    }
    return reply({ data: [], page: { nextCursor: null, hasMore: false } });
  });
  await page.routeWebSocket("**/api/v1/thread-events", (socket) => {
    socket.onMessage((raw) => {
      const event = JSON.parse(raw);
      if (event.type === "subscribe")
        socket.send(
          JSON.stringify({ type: "subscribed", courseId: event.courseId }),
        );
    });
  });
  await page.goto(`${origin}/courses/course-1/sessions/session-1`);
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.locator(".cm-content").fill("text retained across restart");
  await page.screenshot({
    path: resolve(screenshots, "connected.png"),
    fullPage: true,
  });
  transient = true;
  for (const connection of connections)
    connection.webSocket.close(1012, "service-restart");
  await expect(page.getByText(/Reconnecting/).first()).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "reconnecting.png"),
    fullPage: true,
  });
  await expect
    .poll(() => tickets, { timeout: 20000 })
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    "text retained across restart",
  );
  await expect(page.getByText(/access.*removed|session.*ended/i)).toHaveCount(
    0,
  );
  await page.screenshot({
    path: resolve(screenshots, "reconnected.png"),
    fullPage: true,
  });
});
