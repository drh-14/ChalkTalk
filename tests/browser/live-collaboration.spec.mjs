import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Server } from "@hocuspocus/server";
import { createServer } from "vite";
import * as Y from "yjs";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const id = "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08";
const screenshotDirectory = resolve(root, "docs/pr-screenshots/live-collaboration");

test.describe("rendered live collaboration editors", () => {
  let vite;
  let collaboration;
  let collaborationPort;
  let origin;
  const states = new Map();
  const tickets = [];
  const consumed = new Set();
  let awarenessUpdates = 0;

  async function startCollaboration(port = 0) {
    collaboration = new Server({
      port,
      quiet: true,
      onAuthenticate: async ({ token }) => {
        if (!tickets.includes(token) || consumed.has(token)) throw new Error("Invalid one-use ticket");
        consumed.add(token);
      },
      onLoadDocument: async ({ documentName }) => {
        const doc = new Y.Doc();
        const state = states.get(documentName);
        if (state) Y.applyUpdate(doc, state);
        return doc;
      },
      onChange: async ({ documentName, document }) => {
        states.set(documentName, Y.encodeStateAsUpdate(document));
      },
      onAwarenessUpdate: async () => { awarenessUpdates++; },
    });
    await collaboration.listen();
    collaborationPort = collaboration.address.port;
  }

  test.beforeAll(async () => {
    for (const kind of ["answer", "followup"]) {
      const doc = new Y.Doc();
      doc.getText("content").insert(0, `Saved ${kind} **Markdown** and $x^2$`);
      states.set(`${kind}:${id}`, Y.encodeStateAsUpdate(doc));
      doc.destroy();
    }
    await startCollaboration();
    process.env.VITE_COLLABORATION_PROXY_TARGET = `http://127.0.0.1:${collaborationPort}`;
    vite = await createServer({ root: resolve(root, "apps/web"), server: { host: "127.0.0.1", port: 0 } });
    await vite.listen();
    origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
  });

  test.afterAll(async () => {
    await vite?.close();
    await collaboration?.destroy();
  });

  async function editor(browser, kind, identity) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/v1/**/collaboration-ticket", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-csrf-token"]).toBe("fixture-csrf");
      const ticket = `${identity}:${randomUUID()}`;
      tickets.push(ticket);
      await route.fulfill({ json: { data: { ticket, documentName: `${kind}:${id}`, expiresInSeconds: 30 } } });
    });
    await page.goto(`${origin}/live-editor-fixture.html?kind=${kind}`);
    await expect(page.getByRole("status")).toContainText("Connected · changes synchronized");
    return { page, context };
  }

  for (const kind of ["answer", "followup"]) {
    test(`${kind}: two editors, reload, disconnected draft, fresh-ticket recovery and private awareness`, async ({ browser }) => {
      awarenessUpdates = 0;
      const identity = `anonymous-private-${randomUUID()}`;
      const first = await editor(browser, kind, identity);
      const second = await editor(browser, kind, "named-peer");
      const textbox = first.page.getByRole("textbox", { name: kind === "answer" ? "Answer" : "Followup" });
      const peerText = second.page.getByRole("textbox", { name: kind === "answer" ? "Answer" : "Followup" });
      await expect(peerText).toContainText(`Saved ${kind} **Markdown**`);
      await textbox.click();
      await first.page.keyboard.press("End");
      await first.page.keyboard.type(`\nAnonymous ${kind} **correction** with $\\alpha + \\beta$`);
      await expect(peerText).toContainText(`Anonymous ${kind} **correction** with`);
      await expect(peerText).toContainText("α+β");
      await expect(second.page.locator("body")).not.toContainText(identity);
      expect(awarenessUpdates).toBe(0);
      await second.page.screenshot({ path: resolve(screenshotDirectory, `${kind}-two-editors.png`), fullPage: true });

      const oldTicketCount = tickets.length;
      await second.page.reload();
      await expect(second.page.getByRole("status")).toContainText("Connected · changes synchronized");
      await expect(second.page.getByRole("textbox", { name: kind === "answer" ? "Answer" : "Followup" })).toContainText(`Anonymous ${kind} **correction**`);
      expect(tickets.length).toBe(oldTicketCount + 1);
      expect(new Set(tickets).size).toBe(tickets.length);

      await collaboration.destroy();
      collaboration = undefined;
      await expect(first.page.getByRole("status")).toContainText("Disconnected");
      await textbox.click();
      await first.page.keyboard.press("End");
      await first.page.keyboard.type(`\nOffline ${kind} $z^2$`);
      await expect(textbox).toContainText(`Offline ${kind}`);
      await first.page.screenshot({ path: resolve(screenshotDirectory, `${kind}-offline-draft.png`), fullPage: true });
      await startCollaboration(collaborationPort);
      const beforeReconnect = tickets.length;
      await first.page.getByRole("button", { name: "Retry connection" }).click();
      await expect(first.page.getByRole("status")).toContainText("Connected · changes synchronized");
      expect(tickets.length).toBeGreaterThan(beforeReconnect);
      await second.page.reload();
      await expect(second.page.getByRole("status")).toContainText("Connected · changes synchronized");
      await expect(second.page.getByRole("textbox", { name: kind === "answer" ? "Answer" : "Followup" })).toContainText(`Offline ${kind}`);
      await first.page.screenshot({ path: resolve(screenshotDirectory, `${kind}-recovered-draft.png`), fullPage: true });
      await first.context.close();
      await second.context.close();
    });
  }
});
