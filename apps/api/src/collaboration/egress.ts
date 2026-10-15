import { IncomingMessage, MessageType } from "@hocuspocus/server";
import WebSocket from "ws";
import type { CollaborationStore, LiveTicketContext } from "./store.js";

const MAX_QUEUED_BYTES = 128 * 1024 * 1024;
const MAX_QUEUED_FRAMES = 64;
const MAX_SOCKET_BUFFER_BYTES = 128 * 1024 * 1024;
const allowedTypes = new Set([
  MessageType.Sync,
  MessageType.Awareness,
  MessageType.Auth,
  MessageType.QueryAwareness,
  MessageType.SyncReply,
  MessageType.CLOSE,
  MessageType.SyncStatus,
  MessageType.Ping,
  MessageType.Pong,
]);

function decode(data: Uint8Array) {
  const message = new IncomingMessage(data);
  const address = message.readVarString();
  const type = message.readVarUint();
  if (!address || !allowedTypes.has(type))
    throw new Error("Invalid collaboration frame");
  return { address, type };
}

export class AuthorizedEgress {
  private identity?: LiveTicketContext;
  private address?: string;
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private draining = false;
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly store: CollaborationStore,
    private readonly available: () => boolean,
  ) {}

  get transport() {
    const thisSocket = this.socket;
    return {
      get readyState() {
        return thisSocket.readyState;
      },
      send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) =>
        this.send(data),
      close: (code?: number, reason?: string) =>
        this.socket.close(code, reason),
    };
  }

  bind(documentName: string, identity: LiveTicketContext) {
    if (this.closed) throw new Error("Collaboration socket closed");
    if (this.identity) throw new Error("Ticket already bound");
    if (!this.address) throw new Error("Collaboration address missing");
    if (
      this.address !== documentName ||
      documentName !== `${identity.kind}:${identity.documentId}`
    )
      throw new Error("Ticket target changed");
    this.identity = identity;
  }

  acceptInbound(data: Uint8Array) {
    try {
      const frame = decode(data);
      if (!this.address) this.address = frame.address;
      if (frame.address !== this.address)
        throw new Error("Multiplexed document");
      if (
        !this.identity &&
        frame.type !== MessageType.Auth &&
        frame.type !== MessageType.Sync &&
        frame.type !== MessageType.Awareness &&
        frame.type !== MessageType.QueryAwareness
      )
        throw new Error("Unauthenticated document frame");
      if (this.identity && frame.type === MessageType.Auth)
        throw new Error("Repeated authentication");
      return data;
    } catch (error) {
      this.fail();
      throw error;
    }
  }

  private send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    try {
      if (this.closed || typeof data === "string" || data instanceof Blob)
        throw new Error("Invalid collaboration frame");
      const bytes =
        data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from(new Uint8Array(data));
      const frame = decode(bytes);
      if (!this.address || frame.address !== this.address)
        throw new Error("Multiplexed document");
      if (!this.identity) {
        if (frame.type !== MessageType.Auth && frame.type !== MessageType.CLOSE)
          throw new Error("Unauthenticated document frame");
        if (this.socket.bufferedAmount + bytes.length > MAX_SOCKET_BUFFER_BYTES)
          throw new Error("Collaboration socket buffer exceeded");
        this.socket.send(bytes);
        return;
      }
      if (
        this.queue.length >= MAX_QUEUED_FRAMES ||
        this.queuedBytes + bytes.length > MAX_QUEUED_BYTES
      )
        throw new Error("Collaboration egress queue exceeded");
      this.queue.push(bytes);
      this.queuedBytes += bytes.length;
      if (!this.draining) void this.drain();
    } catch {
      this.fail();
    }
  }

  private async drain() {
    this.draining = true;
    try {
      while (!this.closed && this.queue.length) {
        const bytes = this.queue.shift()!;
        this.queuedBytes -= bytes.length;
        const identity = this.identity!;
        await this.store.sendAuthorized(
          identity.kind,
          identity.documentId,
          identity.userId,
          identity.sessionId,
          () => {
            if (
              this.closed ||
              !this.available() ||
              this.socket.readyState !== WebSocket.OPEN ||
              this.socket.bufferedAmount + bytes.length >
                MAX_SOCKET_BUFFER_BYTES
            )
              throw new Error("Collaboration socket unavailable");
            this.socket.send(bytes);
          },
        );
      }
    } catch {
      this.fail();
    } finally {
      this.draining = false;
    }
  }

  close() {
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
  }

  private fail() {
    this.close();
    this.socket.terminate();
  }
}
