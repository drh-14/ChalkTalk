import { Redis } from "@hocuspocus/extension-redis";
import { Server } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { AuthorizedEgress } from "./egress.js";
import type {
  CollaborationStore,
  LiveDocumentKind,
  LiveTicketContext,
} from "./store.js";

const DOCUMENT_NAME =
  /^(answer|followup):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
function target(name: string): { kind: LiveDocumentKind; id: string } {
  const parts = DOCUMENT_NAME.exec(name);
  if (!parts) throw new Error("Invalid document name");
  return { kind: parts[1] as LiveDocumentKind, id: parts[2] };
}

export interface CollaborationServerOptions {
  store: CollaborationStore;
  redisUrl: string;
  allowedOrigins: ReadonlySet<string>;
  redisPrefix?: string;
  port: number;
  address?: string;
}

/** Hocuspocus is a transport/cache. PostgreSQL remains the only durable writer. */
export function createCollaborationServer(options: CollaborationServerOptions) {
  const redisUrl = new URL(options.redisUrl);
  if (!["redis:", "rediss:"].includes(redisUrl.protocol))
    throw new Error("REDIS_URL must be redis: or rediss:");
  const redis = new Redis({
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    prefix: options.redisPrefix ?? "chalktalk-collaboration",
    options: {
      username: redisUrl.username
        ? decodeURIComponent(redisUrl.username)
        : undefined,
      password: redisUrl.password
        ? decodeURIComponent(redisUrl.password)
        : undefined,
      tls: redisUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: 1,
    },
  });
  // ioredis otherwise logs each expected reconnect attempt as an unhandled
  // error while the collaboration service is deliberately failing closed.
  redis.pub.on("error", () => {});
  redis.sub.on("error", () => {});
  let healthy = false;
  let recovering = false;
  let monitoring = false;
  let stopRevisions: (() => Promise<void>) | undefined;
  const adapters = new WeakMap<Request, AuthorizedEgress>();
  async function waitRedisReady(client: typeof redis.pub) {
    if (client.status === "ready") return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off("ready", ready);
        reject(new Error("Redis replication is unavailable"));
      }, 2_000);
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      client.once("ready", ready);
    });
  }
  async function probeRedis() {
    if (redis.pub.status !== "ready" || redis.sub.status !== "ready") {
      throw new Error("Redis replication is unavailable");
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        redis.pub.ping(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Redis ping timed out")),
            1_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  async function requireRedis() {
    if (recovering) throw new Error("Redis replication is recovering");
    try {
      await probeRedis();
      healthy = true;
    } catch (error) {
      healthy = false;
      recovering = true;
      server.hocuspocus.closeConnections();
      throw error;
    }
  }
  const server = new Server<LiveTicketContext>({
    port: options.port,
    address: options.address,
    stopOnSignals: false,
    quiet: true,
    extensions: [redis],
    async onConnect({ requestHeaders }) {
      const origin = requestHeaders.get("origin");
      if (!origin || !options.allowedOrigins.has(origin))
        throw new Error("Origin is not allowed");
      await requireRedis();
    },
    async onAuthenticate({ token, documentName, request }) {
      await requireRedis();
      const { kind, id } = target(documentName);
      const identity = await options.store.consumeTicket(token, kind, id);
      const adapter = adapters.get(request);
      if (!adapter) throw new Error("Collaboration socket is unavailable");
      adapter.bind(documentName, identity);
      return identity;
    },
    async onLoadDocument({ documentName, context }) {
      const { kind, id } = target(documentName);
      const loaded = await options.store.loadAuthorized(
        kind,
        id,
        context.userId,
        context.sessionId,
      );
      return loaded.state;
    },
    async beforeSync({ context, document, documentName, type, payload }) {
      await requireRedis();
      const { kind, id } = target(documentName);
      if (context.kind !== kind || context.documentId !== id)
        throw new Error("Ticket target changed");
      if (type === 0) {
        await options.store.checkAccess(
          kind,
          id,
          context.userId,
          context.sessionId,
        );
        return;
      }
      if (type !== 1 && type !== 2) throw new Error("Invalid sync type");
      const saved = await options.store.applyUpdate(
        kind,
        id,
        context.userId,
        context.sessionId,
        payload,
      );
      // Catch this node up with any accepted update committed on another node
      // before Hocuspocus handles the incoming frame. Applying a complete Yjs
      // state is idempotent; no onStoreDocument callback writes to PostgreSQL.
      Y.applyUpdate(document, saved.state, {
        source: "local",
        skipStoreHooks: true,
      });
    },
    async beforeHandleAwareness({ states }) {
      // Do not relay client-supplied names, colors, or arbitrary identity fields.
      for (const clientId of states.keys()) states.set(clientId, {});
    },
    async onStoreDocument() {
      // Every accepted update is already committed in beforeSync.
    },
  });

  server.httpServer.removeAllListeners("upgrade");
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024 + 1024,
  });
  server.httpServer.on("upgrade", (incoming, socket, head) => {
    if (incoming.url?.split("?", 1)[0] !== "/collaboration") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(incoming, socket, head, (webSocket) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          for (const item of value) headers.append(key, item);
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(`http://localhost${incoming.url}`, {
        headers,
      });
      const adapter = new AuthorizedEgress(
        webSocket,
        options.store,
        () => healthy && !recovering,
      );
      adapters.set(request, adapter);
      const connection = server.hocuspocus.handleConnection(
        adapter.transport,
        request,
      );
      webSocket.on("message", (data, isBinary) => {
        if (!isBinary || !(data instanceof Uint8Array)) {
          webSocket.terminate();
          return;
        }
        try {
          connection.handleMessage(adapter.acceptInbound(data));
        } catch {
          webSocket.terminate();
        }
      });
      webSocket.on("pong", () => connection.touch());
      webSocket.on("close", (code, reason) => {
        adapter.close();
        connection.handleClose({ code, reason: reason.toString() });
      });
      webSocket.on("error", () => webSocket.terminate());
    });
  });

  async function refreshDocument(name: string) {
    if (!healthy || recovering) return;
    const document = server.hocuspocus.documents.get(name);
    if (!document) return;
    const { kind, id } = target(name);
    try {
      for (const connection of document.connections.keys()) {
        try {
          const { userId, sessionId } = connection.context;
          await options.store.checkAccess(kind, id, userId, sessionId);
        } catch {
          connection.close();
        }
      }
      const loaded = await options.store.load(kind, id);
      Y.applyUpdate(document, loaded.state, {
        source: "local",
        skipStoreHooks: true,
      });
    } catch {
      server.hocuspocus.closeConnections(name);
    }
  }

  async function monitorOnce() {
    if (monitoring) return;
    monitoring = true;
    try {
      try {
        await probeRedis();
      } catch {
        healthy = false;
        recovering = true;
        server.hocuspocus.closeConnections();
        return;
      }
      if (recovering) {
        server.hocuspocus.closeConnections();
        await Promise.all(
          [...server.hocuspocus.documents.values()].map((document) =>
            server.hocuspocus.unloadDocument(document),
          ),
        );
        if (server.hocuspocus.documents.size === 0) recovering = false;
      }
      healthy = !recovering;
    } finally {
      monitoring = false;
    }
  }
  const monitor = setInterval(() => {
    void monitorOnce().catch((error: unknown) =>
      console.error("Collaboration health check failed", error),
    );
  }, 1_000);
  monitor.unref();
  const reconcile = setInterval(() => {
    for (const name of server.hocuspocus.documents.keys())
      void refreshDocument(name);
  }, 5_000);
  reconcile.unref();
  return {
    get webSocketURL() {
      return `${server.webSocketURL}/collaboration`;
    },
    get hocuspocus() {
      return server.hocuspocus;
    },
    get redisHealthy() {
      return healthy;
    },
    refreshDocument,
    async listen() {
      await Promise.all([waitRedisReady(redis.pub), waitRedisReady(redis.sub)]);
      await probeRedis();
      recovering = false;
      healthy = true;
      stopRevisions = await options.store.listenForRevisions((kind, id) => {
        void refreshDocument(`${kind}:${id}`);
      });
      return server.listen();
    },
    async destroy() {
      clearInterval(monitor);
      clearInterval(reconcile);
      await stopRevisions?.();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await server.destroy();
    },
  };
}
