import { randomUUID } from "node:crypto";
import {
  createConnection,
  createServer,
  type Server as TcpServer,
  type Socket,
} from "node:net";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, describe, expect, it } from "vitest";
import type { CollaborationStore, LiveDocument } from "./store.js";
import { createCollaborationServer } from "./server.js";

const redisUrl = process.env.TEST_REDIS_URL;
const integration = redisUrl ? describe : describe.skip;
const documentId = "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08";
const documentName = `answer:${documentId}`;
const userId = "01a0e5cc-58ae-7009-9f43-c8155fb23e05";
const sessionId = "01a0e5cc-58ae-7009-9f43-100000000001";
class OriginWebSocket extends WebSocket {
  constructor(address: string) {
    super(address, { origin: "http://localhost" });
  }
}

async function until(check: () => boolean, timeout = 5_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for collaboration");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

integration("Hocuspocus pre-apply persistence", () => {
  const servers: Array<ReturnType<typeof createCollaborationServer>> = [];
  const providers: HocuspocusProvider[] = [];
  const sockets: HocuspocusProviderWebsocket[] = [];
  afterAll(async () => {
    for (const provider of providers) provider.destroy();
    for (const socket of sockets) socket.destroy();
    for (const server of servers) await server.destroy();
  }, 30_000);

  it("keeps a real provider connected beyond its default idle check and saves its next edit", async () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "Idle");
    let state = Y.encodeStateAsUpdate(seed);
    seed.destroy();
    let saves = 0;
    const load = async (): Promise<LiveDocument> => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const text = doc.getText("content").toString();
      doc.destroy();
      return { state, text, version: saves + 1, persistenceRevision: saves + 1 };
    };
    const store = {
      consumeTicket: async () => ({ kind: "answer", documentId, userId, sessionId }),
      checkAccess: async () => {},
      sendAuthorized: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        send: () => void,
      ) => send(),
      listenForRevisions: async () => async () => {},
      load,
      loadAuthorized: load,
      applyUpdate: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        update: Uint8Array,
      ): Promise<LiveDocument> => {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        Y.applyUpdate(doc, update);
        state = Y.encodeStateAsUpdate(doc);
        doc.destroy();
        saves += 1;
        return load();
      },
    } as unknown as CollaborationStore;
    const server = createCollaborationServer({
      store,
      redisUrl: redisUrl!,
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: `chalktalk-heartbeat-test-${randomUUID()}`,
      port: 0,
      address: "127.0.0.1",
    });
    servers.push(server);
    await server.listen();
    const socket = new HocuspocusProviderWebsocket({
      url: server.webSocketURL,
      WebSocketPolyfill: OriginWebSocket,
    });
    sockets.push(socket);
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      document: doc,
      name: documentName,
      awareness: null,
      token: "test-ticket",
    });
    providers.push(provider);
    provider.attach();
    await until(() => provider.isSynced);
    const connectionId = socket.identifier;
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    expect(provider.isSynced).toBe(true);
    expect(socket.identifier).toBe(connectionId);
    const initialSaves = saves;
    doc.getText("content").insert(4, " edited");
    await until(() => saves > initialSaves);
    expect((await load()).text).toBe("Idle edited");
    expect(socket.identifier).toBe(connectionId);
  }, 45_000);

  it("rejects session-suffixed, malformed, and alternate document addresses without loading content", async () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "Private answer");
    const state = Y.encodeStateAsUpdate(seed);
    seed.destroy();
    let loads = 0;
    const fakeStore = {
      consumeTicket: async () => ({
        kind: "answer",
        documentId,
        userId,
        sessionId,
      }),
      checkAccess: async () => {},
      listenForRevisions: async () => async () => {},
      loadAuthorized: async () => {
        loads += 1;
        return {
          state,
          text: "Private answer",
          version: 1,
          persistenceRevision: 1,
        };
      },
      sendAuthorized: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        send: () => void,
      ) => send(),
    } as unknown as CollaborationStore;
    const server = createCollaborationServer({
      store: fakeStore,
      redisUrl: redisUrl!,
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: `chalktalk-address-test-${randomUUID()}`,
      port: 0,
      address: "127.0.0.1",
    });
    await server.listen();
    try {
      for (const [name, sessionAwareness] of [
        [documentName, true],
        ["not-a-document", false],
        ["answer:01a0e5cc-58ae-7009-9f43-ea8bbebc2e09", false],
      ] as const) {
        const socket = new HocuspocusProviderWebsocket({
          url: server.webSocketURL,
          WebSocketPolyfill: OriginWebSocket,
        });
        const document = new Y.Doc();
        const provider = new HocuspocusProvider({
          websocketProvider: socket,
          document,
          name,
          sessionAwareness,
          awareness: null,
          token: "test-ticket",
        });
        let closed = false;
        let denied = false;
        provider.on("close", () => {
          closed = true;
        });
        provider.on("authenticationFailed", () => {
          denied = true;
        });
        try {
          provider.attach();
          await until(() => closed || denied || provider.isSynced);
          expect(closed || denied).toBe(true);
          expect(provider.isSynced).toBe(false);
          expect(document.getText("content").toString()).toBe("");
          expect(loads).toBe(0);
        } finally {
          provider.destroy();
          socket.destroy();
          document.destroy();
        }
      }
    } finally {
      await server.destroy();
    }
  }, 20_000);

  it("does not broadcast either Update or initial SyncStep2 before the durable write resolves across two nodes", async () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "Base");
    let state = Y.encodeStateAsUpdate(seed);
    seed.destroy();
    let pending: (() => void) | undefined;
    let blocked = false;
    let rejectUpdates = false;
    let updateEntered = 0;
    const loadState = async (): Promise<LiveDocument> => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const text = doc.getText("content").toString();
      doc.destroy();
      return { state, text, version: 1, persistenceRevision: 1 };
    };
    const fakeStore = {
      consumeTicket: async () => ({
        kind: "answer",
        documentId,
        userId,
        sessionId,
      }),
      checkAccess: async () => {},
      sendAuthorized: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        send: () => void,
      ) => send(),
      listenForRevisions: async () => async () => {},
      load: loadState,
      loadAuthorized: loadState,
      applyUpdate: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        update: Uint8Array,
      ): Promise<LiveDocument> => {
        updateEntered += 1;
        if (rejectUpdates) throw new Error("rejected before commit");
        if (blocked)
          await new Promise<void>((resolve) => {
            pending = resolve;
          });
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        Y.applyUpdate(doc, update);
        state = Y.encodeStateAsUpdate(doc);
        const text = doc.getText("content").toString();
        doc.destroy();
        return { state, text, version: 2, persistenceRevision: 2 };
      },
    } as unknown as CollaborationStore;
    const prefix = `chalktalk-live-test-${randomUUID()}`;
    const left = createCollaborationServer({
      store: fakeStore,
      redisUrl: redisUrl!,
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: prefix,
      port: 0,
      address: "127.0.0.1",
    });
    const right = createCollaborationServer({
      store: fakeStore,
      redisUrl: redisUrl!,
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: prefix,
      port: 0,
      address: "127.0.0.1",
    });
    servers.push(left, right);
    await Promise.all([left.listen(), right.listen()]);
    function connect(
      server: typeof left,
      doc = new Y.Doc(),
      awareness = false,
    ) {
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: server.webSocketURL,
        WebSocketPolyfill: OriginWebSocket,
      });
      sockets.push(websocketProvider);
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: documentName,
        document: doc,
        token: "test-ticket",
        awareness: awareness ? undefined : null,
      });
      providers.push(provider);
      provider.attach();
      return { provider, doc };
    }
    const a = connect(left);
    const b = connect(right);
    await until(() => a.provider.isSynced && b.provider.isSynced);
    expect(b.doc.getText("content").toString()).toBe("Base");

    blocked = true;
    const firstCount = updateEntered;
    a.doc.getText("content").insert(4, " A");
    await until(() => updateEntered > firstCount);
    expect(b.doc.getText("content").toString()).toBe("Base");
    blocked = false;
    pending?.();
    await until(() => b.doc.getText("content").toString().includes(" A"));

    const offline = new Y.Doc();
    Y.applyUpdate(offline, state);
    offline.getText("content").insert(offline.getText("content").length, " C");
    blocked = true;
    pending = undefined;
    const secondCount = updateEntered;
    const c = connect(left, offline);
    await until(() => updateEntered > secondCount);
    expect(b.doc.getText("content").toString()).not.toContain(" C");
    blocked = false;
    pending?.();
    await until(() => b.doc.getText("content").toString().includes(" C"));
    expect(c.provider.isSynced).toBe(true);

    const rest = new Y.Doc();
    Y.applyUpdate(rest, state);
    rest.getText("content").insert(rest.getText("content").length, " REST");
    state = Y.encodeStateAsUpdate(rest);
    rest.destroy();
    await left.refreshDocument(documentName);
    await until(() => b.doc.getText("content").toString().includes(" REST"));

    blocked = false;
    const namedA = connect(left, new Y.Doc(), true);
    const namedB = connect(right, new Y.Doc(), true);
    await until(() => namedA.provider.isSynced && namedB.provider.isSynced);
    namedA.provider.awareness?.setLocalStateField("user", {
      name: "Private author",
    });
    await until(
      () =>
        namedB.provider.awareness?.getStates().has(namedA.doc.clientID) ??
        false,
    );
    expect(
      namedB.provider.awareness?.getStates().get(namedA.doc.clientID),
    ).toEqual({});

    rejectUpdates = true;
    const deniedCount = updateEntered;
    a.doc
      .getText("content")
      .insert(a.doc.getText("content").length, " rejected");
    await until(() => updateEntered > deniedCount);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(b.doc.getText("content").toString()).not.toContain(" rejected");
  }, 20_000);

  it("fails closed when Redis is unavailable before consuming a ticket", async () => {
    let consumed = false;
    const fakeStore = {
      consumeTicket: async () => {
        consumed = true;
        throw new Error("should not consume");
      },
      listenForRevisions: async () => async () => {},
    } as unknown as CollaborationStore;
    const server = createCollaborationServer({
      store: fakeStore,
      redisUrl: "redis://127.0.0.1:63989",
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: `chalktalk-live-test-${randomUUID()}`,
      port: 0,
      address: "127.0.0.1",
    });
    servers.push(server);
    await expect(server.listen()).rejects.toThrow(
      "Redis replication is unavailable",
    );
    expect(consumed).toBe(false);
    expect(server.redisHealthy).toBe(false);
  }, 10_000);

  it("drops active editors on Redis loss and reloads the PostgreSQL-backed state on recovery", async () => {
    const upstream = new URL(redisUrl!);
    const proxySockets = new Set<Socket>();
    let proxy: TcpServer;
    const bind = (port: number) =>
      new Promise<number>((resolve) => {
        proxy = createServer((client) => {
          const remote = createConnection({
            host: upstream.hostname,
            port: Number(upstream.port || 6379),
          });
          proxySockets.add(client);
          proxySockets.add(remote);
          client.on("error", () => {});
          remote.on("error", () => {});
          client.on("close", () => {
            proxySockets.delete(client);
            remote.destroy();
          });
          remote.on("close", () => {
            proxySockets.delete(remote);
            client.destroy();
          });
          client.pipe(remote).pipe(client);
        });
        proxy.listen(port, "127.0.0.1", () =>
          resolve((proxy.address() as { port: number }).port),
        );
      });
    const port = await bind(0);
    let state: Uint8Array;
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "Durable");
    state = Y.encodeStateAsUpdate(seed);
    seed.destroy();
    let writes = 0;
    const loadState = async () => ({
      state,
      text: "Durable",
      version: 1,
      persistenceRevision: 1,
    });
    const store = {
      consumeTicket: async () => ({
        kind: "answer",
        documentId,
        userId,
        sessionId,
      }),
      checkAccess: async () => {},
      sendAuthorized: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        send: () => void,
      ) => send(),
      listenForRevisions: async () => async () => {},
      load: loadState,
      loadAuthorized: loadState,
      applyUpdate: async (
        _kind: string,
        _id: string,
        _user: string,
        _session: string,
        update: Uint8Array,
      ) => {
        writes++;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        Y.applyUpdate(doc, update);
        state = Y.encodeStateAsUpdate(doc);
        const text = doc.getText("content").toString();
        doc.destroy();
        return { state, text, version: 2, persistenceRevision: 2 };
      },
    } as unknown as CollaborationStore;
    const node = createCollaborationServer({
      store,
      redisUrl: `redis://127.0.0.1:${port}`,
      allowedOrigins: new Set(["http://localhost"]),
      redisPrefix: `chalktalk-live-test-${randomUUID()}`,
      port: 0,
      address: "127.0.0.1",
    });
    servers.push(node);
    await node.listen();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: node.webSocketURL,
      WebSocketPolyfill: OriginWebSocket,
    });
    sockets.push(websocketProvider);
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: documentName,
      document: doc,
      awareness: null,
      token: () => randomUUID(),
    });
    providers.push(provider);
    provider.attach();
    await until(() => provider.isSynced);
    expect(doc.getText("content").toString()).toBe("Durable");
    for (const socket of proxySockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await until(() => !node.redisHealthy, 4_000);
    const before = writes;
    doc.getText("content").insert(7, " offline");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(writes).toBe(before);
    await bind(port);
    await until(() => node.redisHealthy, 10_000);
    // A forced close intentionally invalidates the original document session.
    // Reattach with a fresh ticket; the local Y.Doc retains the unsent draft.
    provider.destroy();
    websocketProvider.webSocket?.on("error", () => {});
    websocketProvider.destroy();
    const recoveredSocket = new HocuspocusProviderWebsocket({
      url: node.webSocketURL,
      WebSocketPolyfill: OriginWebSocket,
    });
    sockets.push(recoveredSocket);
    const recovered = new HocuspocusProvider({
      websocketProvider: recoveredSocket,
      name: documentName,
      document: doc,
      awareness: null,
      token: () => randomUUID(),
    });
    providers.push(recovered);
    recovered.attach();
    await until(() => recovered.isSynced, 10_000);
    await until(() => writes > before, 10_000);
    expect(doc.getText("content").toString()).toContain("offline");
    for (const socket of proxySockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }, 30_000);
});
