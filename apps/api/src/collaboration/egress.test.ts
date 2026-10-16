import { MessageType, OutgoingMessage } from "@hocuspocus/server";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import type { CollaborationStore } from "./store.js";
import { AuthorizedEgress } from "./egress.js";

const name = "answer:01a0e5cc-58ae-7009-9f43-ea8bbebc2e08";
const identity = {
  kind: "answer" as const,
  documentId: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  userId: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  sessionId: "01a0e5cc-58ae-7009-9f43-100000000001",
};

function fixture(sendAuthorized: CollaborationStore["sendAuthorized"]) {
  const sent: Uint8Array[] = [];
  let terminated = false;
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (bytes: Uint8Array) => sent.push(Uint8Array.from(bytes)),
    close: () => {
      terminated = true;
    },
    terminate: () => {
      terminated = true;
    },
  } as unknown as WebSocket;
  const adapter = new AuthorizedEgress(
    socket,
    { sendAuthorized } as CollaborationStore,
    () => true,
  );
  adapter.acceptInbound(
    new OutgoingMessage(name).writeAuthenticated(false).toUint8Array(),
  );
  adapter.bind(name, identity);
  return {
    adapter,
    socket,
    sent,
    get terminated() {
      return terminated;
    },
  };
}

describe("authorized collaboration egress", () => {
  it("accepts only a bound, bare Pong and sends a content-free heartbeat", () => {
    let checks = 0;
    const context = fixture(async (_kind, _id, _user, _session, send) => {
      checks += 1;
      send();
    });
    context.adapter.heartbeat();
    expect(context.sent).toEqual([Uint8Array.of(MessageType.Ping)]);
    expect(checks).toBe(0);
    expect(
      context.adapter.acceptInbound(Uint8Array.of(MessageType.Pong)),
    ).toBeNull();
    expect(context.terminated).toBe(false);
    expect(() =>
      context.adapter.acceptInbound(Uint8Array.of(MessageType.Ping)),
    ).toThrow();
    expect(context.terminated).toBe(true);

    const malformed = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    expect(() =>
      malformed.adapter.acceptInbound(Uint8Array.of(MessageType.Pong, 1)),
    ).toThrow();
    expect(malformed.terminated).toBe(true);

    const unbound = new AuthorizedEgress(
      context.socket,
      { sendAuthorized: async () => {} } as unknown as CollaborationStore,
      () => true,
    );
    expect(() =>
      unbound.acceptInbound(Uint8Array.of(MessageType.Pong)),
    ).toThrow();
  });

  it("binds only the exact plain answer or followup address", () => {
    for (const kind of ["answer", "followup"] as const) {
      const documentName = `${kind}:${identity.documentId}`;
      for (const address of [
        `${documentName}\0session`,
        `${kind}:01a0e5cc-58ae-7009-9f43-ea8bbebc2e09`,
      ]) {
        let terminated = false;
        const socket = {
          readyState: WebSocket.OPEN,
          bufferedAmount: 0,
          send: () => {},
          close: () => {},
          terminate: () => {
            terminated = true;
          },
        } as unknown as WebSocket;
        const adapter = new AuthorizedEgress(
          socket,
          { sendAuthorized: async () => {} } as unknown as CollaborationStore,
          () => true,
        );
        adapter.acceptInbound(
          new OutgoingMessage(address).writeAuthenticated(false).toUint8Array(),
        );
        expect(() => adapter.bind(documentName, { ...identity, kind })).toThrow(
          "Ticket target changed",
        );
        expect(terminated).toBe(false);
      }
    }
  });

  it("serializes frames and drops queued content on authorization failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let authorized = true;
    const context = fixture(async (_kind, _id, _user, _session, send) => {
      await gate;
      if (!authorized) throw new Error("revoked");
      send();
    });
    const frame = new OutgoingMessage(name)
      .writeSyncStatus(true)
      .toUint8Array();
    context.adapter.transport.send(frame);
    context.adapter.transport.send(frame);
    authorized = false;
    release();
    await vi.waitFor(() => expect(context.terminated).toBe(true));
    expect(context.sent).toEqual([]);
  });

  it("rejects multiplexed, unsupported, and unbounded outbound frames", async () => {
    const allowed = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    allowed.adapter.transport.send(
      new OutgoingMessage(name).writeSyncStatus(true).toUint8Array(),
    );
    await vi.waitFor(() => expect(allowed.sent).toHaveLength(1));
    allowed.adapter.transport.send(
      new OutgoingMessage("answer:01a0e5cc-58ae-7009-9f43-ea8bbebc2e09")
        .writeSyncStatus(true)
        .toUint8Array(),
    );
    expect(allowed.terminated).toBe(true);

    const suffixed = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    suffixed.adapter.transport.send(
      new OutgoingMessage(`${name}\0session`)
        .writeSyncStatus(true)
        .toUint8Array(),
    );
    expect(suffixed.terminated).toBe(true);
    expect(suffixed.sent).toEqual([]);

    const unsupported = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    unsupported.adapter.transport.send(
      new OutgoingMessage(name).writeStateless("x").toUint8Array(),
    );
    expect(unsupported.terminated).toBe(true);

    const fullSocket = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    Object.defineProperty(fullSocket.socket, "bufferedAmount", {
      value: 128 * 1024 * 1024,
    });
    fullSocket.adapter.transport.send(
      new OutgoingMessage(name).writeSyncStatus(true).toUint8Array(),
    );
    await vi.waitFor(() => expect(fullSocket.terminated).toBe(true));
    expect(fullSocket.sent).toEqual([]);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bounded = fixture(async (_kind, _id, _user, _session, send) => {
      await gate;
      send();
    });
    const frame = new OutgoingMessage(name)
      .writeSyncStatus(true)
      .toUint8Array();
    for (let i = 0; i < 66; i++) bounded.adapter.transport.send(frame);
    expect(bounded.terminated).toBe(true);
    release();
  });

  it("rejects unknown and multiplexed inbound document frames", () => {
    const malformed = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    expect(() =>
      malformed.adapter.acceptInbound(
        new OutgoingMessage("").writeSyncStatus(true).toUint8Array(),
      ),
    ).toThrow("Invalid collaboration frame");
    expect(malformed.terminated).toBe(true);

    const sameDocument = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    expect(() =>
      sameDocument.adapter.acceptInbound(
        new OutgoingMessage(name).writeStateless("unsupported").toUint8Array(),
      ),
    ).toThrow("Invalid collaboration frame");
    expect(sameDocument.terminated).toBe(true);

    const otherDocument = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    expect(() =>
      otherDocument.adapter.acceptInbound(
        new OutgoingMessage("answer:01a0e5cc-58ae-7009-9f43-ea8bbebc2e09")
          .writeSyncStatus(true)
          .toUint8Array(),
      ),
    ).toThrow("Multiplexed document");
    expect(otherDocument.terminated).toBe(true);

    const suffixed = fixture(async (_kind, _id, _user, _session, send) =>
      send(),
    );
    expect(() =>
      suffixed.adapter.acceptInbound(
        new OutgoingMessage(`${name}\0session`)
          .writeSyncStatus(true)
          .toUint8Array(),
      ),
    ).toThrow("Multiplexed document");
    expect(suffixed.terminated).toBe(true);
  });
});
