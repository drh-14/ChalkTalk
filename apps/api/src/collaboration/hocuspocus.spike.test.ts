// Proves the Hocuspocus 4 behaviour the collaboration design depends on
// before any session code is built on it (task 1.2).
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { Server, type Extension } from "@hocuspocus/server";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";

const open: { destroy(): unknown }[] = [];

async function startServer(extension: Partial<Extension>, debounce = 200) {
  const server = new Server({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
    debounce,
    maxDebounce: debounce * 2,
    ...extension,
  });
  await server.listen();
  open.push(server);
  return server;
}

function connect(
  server: Server,
  options: {
    name?: string;
    token?: string;
    onStateless?: (p: string) => void;
  } = {},
) {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: server.webSocketURL,
    WebSocketPolyfill: WebSocket,
    maxAttempts: 1,
  });
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: options.name ?? "spike",
    document,
    token: options.token ?? "good",
    onStateless: ({ payload }) => options.onStateless?.(payload),
  });
  // A provider given its own websocket does not manage it and must attach.
  provider.attach();
  open.push(provider, websocketProvider);
  return { provider, document, text: document.getText("content") };
}

async function until(check: () => boolean, timeout = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  for (const item of open.splice(0).reverse()) await item.destroy();
});

describe("Hocuspocus 4 behaviour relied on by live code sessions", () => {
  it("receives the provider token in onAuthenticate and can refuse it", async () => {
    const tokens: string[] = [];
    const server = await startServer({
      async onAuthenticate({ token }) {
        tokens.push(token);
        if (token !== "good") throw new Error("denied");
        return { userId: "u1" };
      },
    });
    const accepted = connect(server, { token: "good" });
    await until(() => accepted.provider.isSynced);
    let failed = false;
    const refused = connect(server, { token: "bad" });
    refused.provider.on("authenticationFailed", () => {
      failed = true;
    });
    await until(() => failed);
    expect(tokens).toEqual(expect.arrayContaining(["good", "bad"]));
    expect(refused.provider.isSynced).toBe(false);
  });

  it("rejects an update in beforeSync without applying or broadcasting it", async () => {
    const server = await startServer({
      async onAuthenticate() {
        return {};
      },
      async beforeSync({ type, payload, document }) {
        if (type !== 1 && type !== 2) return;
        const probe = new Y.Doc();
        Y.applyUpdate(probe, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(probe, payload);
        if (probe.getText("content").toString().includes("forbidden"))
          throw new Error("rejected update");
      },
    });
    const writer = connect(server);
    const reader = connect(server);
    await until(() => writer.provider.isSynced && reader.provider.isSynced);
    writer.text.insert(0, "allowed ");
    await until(() => reader.text.toString() === "allowed ");
    writer.text.insert(0, "forbidden ");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(reader.text.toString()).toBe("allowed ");
    const serverDocument = server.hocuspocus.documents.get("spike");
    expect(serverDocument?.getText("content").toString()).toBe("allowed ");
  });

  it("debounces onStoreDocument and stores again when the last client leaves", async () => {
    const stores: { at: number; text: string }[] = [];
    const server = await startServer(
      {
        async onAuthenticate() {
          return {};
        },
        async onStoreDocument({ document }) {
          stores.push({
            at: Date.now(),
            text: document.getText("content").toString(),
          });
        },
      },
      200,
    );
    const client = connect(server);
    await until(() => client.provider.isSynced);
    const started = Date.now();
    for (let index = 0; index < 5; index += 1) {
      client.text.insert(client.text.length, String(index));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await until(() => stores.length >= 1);
    expect(stores[0]!.at - started).toBeLessThan(800);
    expect(stores[0]!.text).toBe("01234");
    client.text.insert(client.text.length, "!");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = stores.length;
    client.provider.destroy();
    await until(() => stores.length > before);
    expect(stores.at(-1)!.text).toBe("01234!");
  });

  it("delivers stateless messages and lets the server rewrite awareness identity", async () => {
    const server = await startServer({
      async onAuthenticate({ token }) {
        return { displayName: token === "good" ? "Server Name" : "x" };
      },
      async beforeHandleAwareness({ states, context }) {
        for (const state of states.values())
          state.user = {
            name: (context as { displayName: string }).displayName,
          };
      },
    });
    const received: string[] = [];
    const watcher = connect(server, { onStateless: (p) => received.push(p) });
    const typist = connect(server);
    await until(() => watcher.provider.isSynced && typist.provider.isSynced);
    typist.provider.setAwarenessField("user", { name: "Impostor" });
    await until(() =>
      [...watcher.provider.awareness!.getStates().values()].some(
        (state) => state.user?.name === "Server Name",
      ),
    );
    expect(
      [...watcher.provider.awareness!.getStates().values()].some(
        (state) => state.user?.name === "Impostor",
      ),
    ).toBe(false);
    server.hocuspocus.documents
      .get("spike")!
      .broadcastStateless(JSON.stringify({ type: "session-updated" }));
    await until(() => received.length > 0);
    expect(JSON.parse(received[0]!)).toEqual({ type: "session-updated" });
  });

  it("closes one document connection with a reason the client sees", async () => {
    const server = await startServer({
      async onAuthenticate({ token }) {
        return { userId: token };
      },
    });
    const kept = connect(server, { token: "keep" });
    const removed = connect(server, { token: "remove" });
    // Document-level closes always arrive as code 1000; the reason carries meaning.
    let closeReason: string | undefined;
    removed.provider.on("close", ({ event }: { event: { reason: string } }) => {
      closeReason = event.reason;
    });
    await until(() => kept.provider.isSynced && removed.provider.isSynced);
    const document = server.hocuspocus.documents.get("spike")!;
    for (const connection of document.getConnections())
      if ((connection.context as { userId: string }).userId === "remove")
        connection.close({ code: 1000, reason: "access-removed" });
    await until(() => closeReason !== undefined);
    expect(closeReason).toBe("access-removed");
    kept.text.insert(0, "still here");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.getText("content").toString()).toBe("still here");
  });
});
