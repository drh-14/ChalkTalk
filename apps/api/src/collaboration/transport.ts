import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  Hocuspocus,
  IncomingMessage as HocuspocusIncomingMessage,
  OutgoingMessage,
  type WebSocketLike,
} from "@hocuspocus/server";
import WebSocket, { WebSocketServer } from "ws";

const MAX_OUTBOUND_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_INBOUND_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_INBOUND_MESSAGES = 1000;

class AdmissionSocket implements WebSocketLike {
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private pendingInbound: Uint8Array[] = [];
  private pendingInboundBytes = 0;
  private authenticationForwarded = false;
  private client?: ReturnType<Hocuspocus["handleConnection"]>;
  private admitted = false;
  private closed = false;
  private timeout: NodeJS.Timeout;
  documentKey?: string;

  constructor(
    readonly raw: WebSocket,
    private readonly onAbort: () => void,
    admissionTimeoutMs: number,
  ) {
    this.timeout = setTimeout(() => this.abort(), admissionTimeoutMs);
  }

  get readyState() {
    return this.closed ? WebSocket.CLOSED : this.raw.readyState;
  }

  attach(client: ReturnType<Hocuspocus["handleConnection"]>) {
    this.client = client;
  }

  receive(frame: Uint8Array) {
    if (this.closed) return;
    const message = new HocuspocusIncomingMessage(frame);
    const key = message.readVarString();
    if (this.documentKey && this.documentKey !== key) {
      this.abort();
      return;
    }
    this.documentKey = key;
    if (this.admitted) {
      this.client!.handleMessage(frame);
      return;
    }
    if (message.readVarUint() === 2) {
      if (this.authenticationForwarded) {
        this.abort();
        return;
      }
      this.authenticationForwarded = true;
      this.client!.handleMessage(frame);
      return;
    }
    if (
      this.pendingInboundBytes + frame.byteLength > MAX_PENDING_INBOUND_BYTES ||
      this.pendingInbound.length >= MAX_PENDING_INBOUND_MESSAGES
    ) {
      this.abort();
      return;
    }
    this.pendingInbound.push(frame);
    this.pendingInboundBytes += frame.byteLength;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.closed) return;
    if (data instanceof Blob) {
      this.abort();
      return;
    }
    const frame =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data as Uint8Array);
    if (this.admitted) {
      this.raw.send(frame);
      return;
    }
    if (this.bufferedBytes + frame.byteLength > MAX_OUTBOUND_BYTES) {
      this.abort();
      return;
    }
    this.buffered.push(frame);
    this.bufferedBytes += frame.byteLength;
  }

  confirm() {
    if (this.closed || this.raw.readyState !== WebSocket.OPEN) return false;
    try {
      for (const frame of this.buffered) this.raw.send(frame);
      this.admitted = true;
      this.buffered = [];
      this.bufferedBytes = 0;
      for (const frame of this.pendingInbound) {
        if (this.closed) return false;
        this.client!.handleMessage(frame);
      }
      this.pendingInbound = [];
      this.pendingInboundBytes = 0;
      return true;
    } catch {
      this.abort();
      return false;
    }
  }

  finish() {
    clearTimeout(this.timeout);
  }

  reject(reason: string) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    this.buffered = [];
    this.bufferedBytes = 0;
    this.pendingInbound = [];
    this.pendingInboundBytes = 0;
    if (this.raw.readyState === WebSocket.OPEN && this.documentKey) {
      this.raw.send(
        new OutgoingMessage(this.documentKey)
          .writePermissionDenied(reason)
          .toUint8Array(),
      );
      this.raw.close(1000, reason);
    } else {
      this.raw.terminate();
    }
    this.onAbort();
  }

  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    this.buffered = [];
    this.bufferedBytes = 0;
    this.pendingInbound = [];
    this.pendingInboundBytes = 0;
    if (this.raw.readyState === WebSocket.OPEN) this.raw.close(code, reason);
    this.onAbort();
  }

  abort() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    this.buffered = [];
    this.bufferedBytes = 0;
    this.pendingInbound = [];
    this.pendingInboundBytes = 0;
    this.raw.terminate();
    this.onAbort();
  }
}

export function createCollaborationTransport<Context>(options: {
  hocuspocus: Hocuspocus<Context>;
  address?: string;
  port: number;
  maxPayload: number;
  admissionTimeoutMs: number;
  onAbort: (request: Request) => void;
  onRequest: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>;
}) {
  const sockets = new Set<AdmissionSocket>();
  const byRequest = new WeakMap<Request, AdmissionSocket>();
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload,
  });
  const httpServer = createServer((request, response) => {
    void options.onRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  httpServer.on("upgrade", (incoming, socket, head) => {
    wsServer.handleUpgrade(incoming, socket, head, (raw) => {
      const url = new URL(
        incoming.url ?? "/",
        `http://${incoming.headers.host ?? "localhost"}`,
      );
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(url, { headers });
      // The close listener must exist before handleConnection can use the socket.
      // eslint-disable-next-line prefer-const
      let client: ReturnType<Hocuspocus<Context>["handleConnection"]>;
      const guarded = new AdmissionSocket(
        raw,
        () => options.onAbort(request),
        options.admissionTimeoutMs,
      );
      sockets.add(guarded);
      byRequest.set(request, guarded);
      raw.on("close", (code, reason) => {
        guarded.abort();
        client?.handleClose({ code, reason: reason.toString() });
        sockets.delete(guarded);
      });
      raw.on("error", () => guarded.abort());
      client = options.hocuspocus.handleConnection(guarded, request);
      guarded.attach(client);
      raw.on("message", (data) => {
        if (guarded.readyState !== WebSocket.OPEN) return;
        try {
          guarded.receive(new Uint8Array(data as Buffer));
        } catch {
          guarded.abort();
        }
      });
      raw.on("pong", () => client.touch());
    });
  });

  return {
    hocuspocus: options.hocuspocus,
    httpServer,
    socketFor(request: Request) {
      return byRequest.get(request);
    },
    get webSocketURL() {
      const address = httpServer.address() as AddressInfo;
      return `ws://${options.address ?? "0.0.0.0"}:${address?.port ?? options.port}`;
    },
    async listen() {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(options.port, options.address, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
      await options.hocuspocus.hooks("onListen", {
        instance: options.hocuspocus,
        configuration: options.hocuspocus.configuration,
        port: (httpServer.address() as AddressInfo).port,
      });
    },
    async destroy() {
      for (const socket of sockets) socket.abort();
      const unloaded = new Promise<void>((resolve) => {
        if (options.hocuspocus.documents.size === 0) {
          resolve();
          return;
        }
        options.hocuspocus.configuration.extensions.push({
          async afterUnloadDocument({ instance }) {
            if (instance.getDocumentsCount() === 0) resolve();
          },
        });
      });
      options.hocuspocus.closeConnections();
      options.hocuspocus.flushPendingStores();
      await unloaded;
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await options.hocuspocus.hooks("onDestroy", {
        instance: options.hocuspocus,
      });
    },
  };
}
