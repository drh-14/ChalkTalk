import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import type { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { CourseService } from "../courses/service.js";
import { collaborationAccessChanged } from "./lifecycle.js";
import { createCollaborationServer, CLOSE_REASONS } from "./server.js";
import { CollaborationSessionService, documentName } from "./service.js";
import { createTestSchema, seedCourse } from "./test-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const ORIGIN = "https://app.example.edu";
const METRICS_TOKEN = "metrics-token-for-collaboration-tests";

function socketClass(origin: string) {
  return class extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { Origin: origin } });
    }
  };
}

async function until(check: () => boolean | Promise<boolean>, timeout = 5000) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return Date.now() - started;
}

integration("collaboration server", () => {
  let database: Awaited<ReturnType<typeof createTestSchema>>;
  let pool: Pool;
  let service: CollaborationSessionService;
  let fixture: Awaited<ReturnType<typeof seedCourse>>;
  let collaboration: ReturnType<typeof createCollaborationServer>;
  const authSessions: Record<string, string> = {};
  const opened: { destroy(): unknown }[] = [];

  function startServer(listenerRetryMs = 100, admissionTimeoutMs = 5000) {
    collaboration = createCollaborationServer({
      pool,
      databaseUrl: url!,
      frontendOrigins: new Set([ORIGIN]),
      port: 0,
      address: "127.0.0.1",
      debounce: 300,
      maxDebounce: 800,
      sweepIntervalMs: 60_000,
      listenerRetryMs,
      admissionTimeoutMs,
      metricsToken: METRICS_TOKEN,
    });
    return collaboration.start();
  }

  async function newSession(creator = "alice", invitees: string[] = ["bob"]) {
    const session = (
      await service.create(fixture.courseId, fixture.users[creator]!, {
        title: "Course collaboration",
        language: "python",
      })
    ).value;
    for (const name of invitees)
      await service.invite(
        session.id,
        fixture.users[creator]!,
        fixture.users[name]!,
      );
    return session.id;
  }

  function join(
    name: string,
    sessionId: string,
    options: {
      origin?: string;
      token?: () => Promise<string>;
      documentId?: string;
    } = {},
  ) {
    const userId = fixture.users[name]!;
    const state = {
      closeReason: undefined as string | undefined,
      authFailed: false,
      stateless: [] as string[],
    };
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: collaboration.server.webSocketURL,
      WebSocketPolyfill: socketClass(options.origin ?? ORIGIN),
      maxAttempts: 1,
    });
    const document = new Y.Doc();
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: options.documentId ?? documentName(sessionId),
      document,
      token:
        options.token ??
        (async () =>
          (await service.ticket(sessionId, userId, authSessions[userId]!))
            .ticket),
      onAuthenticationFailed: () => {
        state.authFailed = true;
      },
      onClose: ({ event }) => {
        state.closeReason ??= event.reason;
      },
      onStateless: ({ payload }) => {
        state.stateless.push(payload);
      },
    });
    provider.attach();
    opened.push(provider, websocketProvider);
    return {
      provider,
      websocketProvider,
      document,
      text: document.getText("content"),
      state,
    };
  }

  beforeAll(async () => {
    database = await createTestSchema(url!, "collab_server");
    pool = database.pool;
    service = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
      endTimeoutMs: 3000,
      endPollMs: 20,
      rateLimits: { createPerHour: 1000, ticketsPerTenMinutes: 1000 },
    });
    fixture = await seedCourse(pool, {
      alice: "student",
      bob: "student",
      carol: "student",
      tim: "ta",
      ina: "instructor",
    });
    for (const [name, userId] of Object.entries(fixture.users)) {
      authSessions[userId] = uuidv7();
      await pool.query(
        "INSERT INTO sessions (id,user_id,credential_hash,csrf_token_hash,expires_at) VALUES ($1,$2,$3,$3,now()+interval '1 day')",
        [
          authSessions[userId],
          userId,
          Buffer.from(`${name}-server-credential-hash`),
        ],
      );
    }
    await startServer();
  });
  afterEach(async () => {
    for (const item of opened.splice(0).reverse()) await item.destroy();
  });
  afterAll(async () => {
    await collaboration?.stop();
    await database?.drop();
  }, 30_000);

  describe("authentication", () => {
    it("closes a socket that requests a second document", async () => {
      const firstId = await newSession();
      const secondId = await newSession();
      const aliceId = fixture.users.alice!;
      const firstTicket = (
        await service.ticket(firstId, aliceId, authSessions[aliceId]!)
      ).ticket;
      const secondTicket = (
        await service.ticket(secondId, aliceId, authSessions[aliceId]!)
      ).ticket;
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      const encoding = await import("lib0/encoding");
      const auth = (name: string, token: string) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarString(encoder, documentName(name));
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarString(encoder, token);
        return encoding.toUint8Array(encoder);
      };
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        raw.send(auth(firstId, firstTicket));
        await until(
          () => collaboration.connectionsOf(firstId).length === 1,
          10_000,
        );
        raw.send(auth(secondId, secondTicket));
        await until(() => raw.readyState === WebSocket.CLOSED, 10_000);
        expect(collaboration.connectionsOf(secondId)).toHaveLength(0);
      } finally {
        raw.terminate();
      }
    }, 25_000);

    it("holds a pipelined update until admission commits, then persists it", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const originalCreate = collaboration.hocuspocus.createDocument.bind(
        collaboration.hocuspocus,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered = false;
      collaboration.hocuspocus.createDocument = (async (...args) => {
        entered = true;
        await gate;
        return originalCreate(...args);
      }) as typeof collaboration.hocuspocus.createDocument;
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      const frames: Buffer[] = [];
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      const pipelined = new Y.Doc();
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        pipelined.getText("content").insert(0, "pipelined edit");
        const update = encoding.createEncoder();
        encoding.writeVarString(update, documentName(sessionId));
        encoding.writeVarUint(update, 0);
        encoding.writeVarUint(update, 2);
        encoding.writeVarUint8Array(update, Y.encodeStateAsUpdate(pipelined));
        raw.send(encoding.toUint8Array(auth));
        raw.send(encoding.toUint8Array(update));
        await until(() => entered);
        await expect(
          pool.query(
            "SELECT id FROM collaboration_sessions WHERE id=$1 FOR UPDATE NOWAIT",
            [sessionId],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
        expect(frames).toHaveLength(0);
        expect(alice.text.toString()).toBe("");
        expect(
          collaboration.hocuspocus.documents
            .get(documentName(sessionId))
            ?.getText("content")
            .toString(),
        ).toBe("");
        release();
        await until(() => alice.text.toString() === "pipelined edit");
        await until(async () => {
          const stored = await pool.query<{ text_projection: string }>(
            "SELECT text_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
            [sessionId],
          );
          return stored.rows[0]?.text_projection === "pipelined edit";
        });
        expect(raw.readyState).toBe(WebSocket.OPEN);
      } finally {
        release();
        collaboration.hocuspocus.createDocument = originalCreate;
        pipelined.destroy();
        raw.terminate();
      }
    });

    it("accepts a valid ticket once and rejects its reuse", async () => {
      const sessionId = await newSession("alice", ["bob", "tim"]);
      const ticket = (
        await service.ticket(
          sessionId,
          fixture.users.alice!,
          authSessions[fixture.users.alice!]!,
        )
      ).ticket;
      const first = join("alice", sessionId, { token: async () => ticket });
      await until(() => first.provider.isSynced);
      const second = join("alice", sessionId, { token: async () => ticket });
      await until(() => second.state.authFailed);
      expect(second.provider.isSynced).toBe(false);
    });

    it("rejects expired, revoked, and other-document tickets", async () => {
      const sessionId = await newSession();
      const otherId = await newSession();
      const alice = fixture.users.alice!;
      const issue = async (id: string) =>
        (await service.ticket(id, alice, authSessions[alice]!)).ticket;
      const expired = await issue(sessionId);
      await pool.query(
        "UPDATE collaboration_connection_tickets SET issued_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' WHERE collaboration_session_id=$1 AND consumed_at IS NULL",
        [sessionId],
      );
      const revoked = await issue(sessionId);
      await pool.query(
        "UPDATE collaboration_connection_tickets SET revoked_at=now() WHERE collaboration_session_id=$1 AND consumed_at IS NULL AND expires_at>now()",
        [sessionId],
      );
      const foreign = await issue(otherId);
      for (const ticket of [expired, revoked, foreign]) {
        const client = join("alice", sessionId, { token: async () => ticket });
        await until(() => client.state.authFailed);
      }
    });

    it("rejects a disallowed origin, a logged-out session, and an uninvited user", async () => {
      const sessionId = await newSession();
      const wrongOrigin = join("alice", sessionId, {
        origin: "https://evil.example.com",
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(wrongOrigin.provider.isSynced).toBe(false);

      const bob = fixture.users.bob!;
      const bobTicket = (
        await service.ticket(sessionId, bob, authSessions[bob]!)
      ).ticket;
      await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
        authSessions[bob],
      ]);
      const loggedOut = join("bob", sessionId, {
        token: async () => bobTicket,
      });
      await until(() => loggedOut.state.authFailed);
      await pool.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [
        authSessions[bob],
      ]);

      const carol = fixture.users.carol!;
      await service.invite(sessionId, fixture.users.alice!, carol);
      const carolTicket = (
        await service.ticket(sessionId, carol, authSessions[carol]!)
      ).ticket;
      await pool.query(
        "DELETE FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2",
        [sessionId, carol],
      );
      const uninvited = join("carol", sessionId, {
        token: async () => carolTicket,
      });
      await until(() => uninvited.state.authFailed);
    });
  });

  describe("editing and persistence", () => {
    it("converges concurrent edits at the same position", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      const bob = join("bob", sessionId);
      await until(() => alice.provider.isSynced && bob.provider.isSynced);
      alice.text.insert(0, "def f():\n");
      await until(() => bob.text.toString() === "def f():\n");
      alice.text.insert(9, "    return 1\n");
      bob.text.insert(9, "    # TA note\n");
      await until(
        () =>
          alice.text.toString() === bob.text.toString() &&
          alice.text.length > 20,
      );
      expect(alice.text.toString()).toContain("    return 1\n");
      expect(alice.text.toString()).toContain("    # TA note\n");
    });

    it("persists within the debounce window, on last disconnect, and across a restart", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      alice.text.insert(0, "print('hello')");
      const saved = async () =>
        (
          await pool.query(
            "SELECT text_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
            [sessionId],
          )
        ).rows[0]?.text_projection;
      const elapsed = await until(
        async () => (await saved()) === "print('hello')",
      );
      expect(elapsed).toBeLessThan(5000);
      alice.text.insert(alice.text.length, "\n# bye");
      alice.provider.destroy();
      await until(async () => (await saved()) === "print('hello')\n# bye");

      await collaboration.stop();
      await startServer();
      const again = join("bob", sessionId);
      await until(() => again.provider.isSynced);
      await until(() => again.text.toString() === "print('hello')\n# bye");
    });

    it("retries a failed document store after database recovery", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      await pool.query(`CREATE FUNCTION reject_collaboration_store() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated storage outage'; END $$`);
      await pool.query(`CREATE TRIGGER reject_collaboration_store
        BEFORE INSERT OR UPDATE ON collaboration_documents
        FOR EACH ROW EXECUTE FUNCTION reject_collaboration_store()`);
      try {
        alice.text.insert(0, "recovered text");
        await new Promise((resolve) => setTimeout(resolve, 450));
        const before = await pool.query(
          "SELECT text_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
          [sessionId],
        );
        expect(before.rowCount).toBe(0);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_collaboration_store ON collaboration_documents",
        );
        await pool.query("DROP FUNCTION reject_collaboration_store()");
      }
      await collaboration.sweep();
      const after = await pool.query<{ text_projection: string }>(
        "SELECT text_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
        [sessionId],
      );
      expect(after.rows[0]?.text_projection).toBe("recovered text");
    });

    it("rejects oversized, out-of-schema, and too-long updates without applying them", async () => {
      const sessionId = await newSession();
      const watcher = join("bob", sessionId);
      await until(() => watcher.provider.isSynced);
      const serverText = () =>
        collaboration.hocuspocus.documents
          .get(documentName(sessionId))
          ?.getText("content");

      const outOfSchema = join("alice", sessionId);
      await until(() => outOfSchema.provider.isSynced);
      outOfSchema.document.getMap("other").set("x", 1);
      await until(
        () => outOfSchema.state.closeReason === CLOSE_REASONS.invalid,
      );
      expect(
        collaboration.hocuspocus.documents
          .get(documentName(sessionId))
          ?.share.has("other"),
      ).toBe(false);

      const tooLong = join("alice", sessionId);
      await until(() => tooLong.provider.isSynced);
      tooLong.text.insert(0, "x".repeat(200_001));
      await until(() => tooLong.state.closeReason === CLOSE_REASONS.invalid);
      expect(serverText()?.length).toBe(0);

      const oversized = join("alice", sessionId);
      await until(() => oversized.provider.isSynced);
      oversized.text.insert(0, "y".repeat(300_000));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(serverText()?.length).toBe(0);
      expect(watcher.text.length).toBe(0);
    });

    it("labels presence with the server identity, not a client-supplied name", async () => {
      const sessionId = await newSession("alice", ["tim"]);
      const alice = join("alice", sessionId);
      const tim = join("tim", sessionId);
      await until(() => alice.provider.isSynced && tim.provider.isSynced);
      tim.provider.setAwarenessField("user", { name: "Impostor", userId: "x" });
      tim.provider.setAwarenessField("cursor", { anchor: 0, head: 0 });
      const names = () =>
        [...alice.provider.awareness!.getStates().values()].map(
          (state) => state.user?.name,
        );
      await until(() => names().includes("tim"));
      expect(names()).not.toContain("Impostor");
      const timState = [...alice.provider.awareness!.getStates().values()].find(
        (state) => state.user?.name === "tim",
      );
      expect(timState?.user.userId).toBe(fixture.users.tim);
      expect(timState?.cursor).toEqual({ anchor: 0, head: 0 });
    });
  });

  describe("viewers", () => {
    it("lets a viewer follow along without applying their edits", async () => {
      const sessionId = await newSession("alice", ["bob"]);
      await service.invite(
        sessionId,
        fixture.users.alice!,
        fixture.users.carol!,
        "view",
      );
      const alice = join("alice", sessionId);
      const carol = join("carol", sessionId);
      await until(() => alice.provider.isSynced && carol.provider.isSynced);
      alice.text.insert(0, "print('demo')");
      await until(() => carol.text.toString() === "print('demo')");

      carol.text.insert(0, "# viewer was here\n");
      carol.document.getMap("whiteboard").set("x", { id: "x", type: "iframe" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const server = collaboration.hocuspocus.documents.get(
        documentName(sessionId),
      );
      expect(server?.getText("content").toString()).toBe("print('demo')");
      expect(server?.getMap("whiteboard").size).toBe(0);
      expect(alice.text.toString()).toBe("print('demo')");
      expect(carol.state.closeReason).toBeUndefined();

      alice.text.insert(alice.text.length, "\nprint('more')");
      await until(() => carol.text.toString().includes("print('more')"));
    });
  });

  describe("metrics", () => {
    it("serves token-guarded metrics without identifiers", async () => {
      const url = `${collaboration.server.webSocketURL.replace(/^ws/, "http")}/metrics`;
      expect((await fetch(url)).status).toBe(401);
      expect(
        (await fetch(url, { headers: { Authorization: "Bearer wrong" } }))
          .status,
      ).toBe(401);

      const sessionId = await newSession();
      const watcher = join("bob", sessionId);
      const rejected = join("alice", sessionId);
      await until(
        () => watcher.provider.isSynced && rejected.provider.isSynced,
      );
      rejected.document.getMap("other").set("x", 1);
      await until(() => rejected.state.closeReason === CLOSE_REASONS.invalid);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const series of [
        "chalktalk_collaboration_connections",
        "chalktalk_collaboration_documents",
        "chalktalk_collaboration_store_duration_seconds",
        "chalktalk_collaboration_rejected_updates_total",
        "chalktalk_collaboration_closes_total",
        "chalktalk_collaboration_sessions_ended_total",
      ])
        expect(text).toContain(`# TYPE ${series}`);
      expect(text).toMatch(/^chalktalk_collaboration_connections [1-9]/m);
      expect(text).toMatch(
        /^chalktalk_collaboration_rejected_updates_total [1-9]/m,
      );
      expect(text).toContain(
        `chalktalk_collaboration_closes_total{reason="invalid-update"}`,
      );
      expect(text).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    });
  });

  describe("idle sessions", () => {
    const lifecycle = async (sessionId: string) =>
      (
        await pool.query<{ lifecycle_state: string; last_active_at: Date }>(
          "SELECT lifecycle_state,last_active_at FROM collaboration_sessions WHERE id=$1",
          [sessionId],
        )
      ).rows[0]!;
    const idleFor = (sessionId: string, minutes: number) =>
      pool.query(
        "UPDATE collaboration_sessions SET last_active_at=now()-make_interval(mins => $2) WHERE id=$1",
        [sessionId, minutes],
      );

    it("ends a session nobody has joined for the idle period", async () => {
      const sessionId = await newSession();
      await idleFor(sessionId, 119);
      expect(await collaboration.endIdle()).not.toContain(sessionId);
      await idleFor(sessionId, 121);
      expect(await collaboration.endIdle()).toContain(sessionId);
      expect((await lifecycle(sessionId)).lifecycle_state).toBe("ended");
      const active = await service.list(
        fixture.courseId,
        fixture.users.alice!,
        {
          status: "active",
          limit: 100,
        },
      );
      expect(active.data.map((session) => session.id)).not.toContain(sessionId);
    });

    it("never ends a session someone is connected to, however quiet", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      await idleFor(sessionId, 600);
      expect(await collaboration.endIdle()).not.toContain(sessionId);
      const row = await lifecycle(sessionId);
      expect(row.lifecycle_state).toBe("active");
      expect(Date.now() - row.last_active_at.getTime()).toBeLessThan(60_000);
    });

    it("counts the idle period from the last disconnect, across a restart", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      await idleFor(sessionId, 600);
      alice.provider.destroy();
      await until(
        async () =>
          Date.now() - (await lifecycle(sessionId)).last_active_at.getTime() <
          60_000,
      );
      await collaboration.stop();
      await startServer();
      expect(await collaboration.endIdle()).not.toContain(sessionId);
      await idleFor(sessionId, 121);
      expect(await collaboration.endIdle()).toContain(sessionId);
    });
  });

  describe("whiteboard", () => {
    const shape = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      version: 1,
      versionNonce: 7,
      index: "a0",
      isDeleted: false,
      ...overrides,
    });
    const board = (client: { document: Y.Doc }) =>
      client.document.getMap("whiteboard");

    it("merges drawings, rejects unsafe elements without broadcast, and persists a projection", async () => {
      const sessionId = await newSession("alice", ["bob", "tim"]);
      const alice = join("alice", sessionId);
      const bob = join("bob", sessionId);
      await until(() => alice.provider.isSynced && bob.provider.isSynced);
      board(alice).set("r1", shape("r1", { index: "a1" }));
      board(bob).set("a1", shape("a1", { type: "arrow", index: "a0" }));
      board(bob).set("x1", shape("x1", { isDeleted: true }));
      await until(() => board(alice).size === 3 && board(bob).size === 3);

      for (const unsafe of [
        shape("bad", { type: "iframe" }),
        shape("bad", { link: "javascript:alert(1)" }),
      ]) {
        const attacker = join("alice", sessionId);
        await until(() => attacker.provider.isSynced);
        board(attacker).set("bad", unsafe);
        await until(() => attacker.state.closeReason === CLOSE_REASONS.invalid);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(board(bob).has("bad")).toBe(false);
      expect(
        collaboration.hocuspocus.documents
          .get(documentName(sessionId))
          ?.getMap("whiteboard")
          .has("bad"),
      ).toBe(false);

      const projection = async () =>
        (
          await pool.query(
            "SELECT whiteboard_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
            [sessionId],
          )
        ).rows[0]?.whiteboard_projection as { id: string }[] | undefined;
      await until(async () => (await projection())?.length === 2);
      expect((await projection())!.map(({ id }) => id)).toEqual(["a1", "r1"]);

      alice.provider.destroy();
      bob.provider.destroy();
      await collaboration.stop();
      await startServer();
      const again = join("tim", sessionId);
      await until(() => again.provider.isSynced);
      await until(() => board(again).size === 3);
      expect(board(again).get("r1")).toMatchObject({ type: "rectangle" });
      const snapshot = await service.snapshot(sessionId, fixture.users.bob!);
      expect(snapshot.whiteboard.map((e) => (e as { id: string }).id)).toEqual([
        "a1",
        "r1",
      ]);
    });

    it("tells each client its own server-stamped identity once connected", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.state.stateless.length > 0);
      expect(JSON.parse(alice.state.stateless[0]!)).toEqual({
        type: "presence",
        user: {
          userId: fixture.users.alice,
          name: "alice",
          color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        },
      });
    });

    it("stamps whiteboard pointers with the server identity", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      const bob = join("bob", sessionId);
      await until(() => alice.provider.isSynced && bob.provider.isSynced);
      bob.provider.setAwarenessField("user", { name: "Impostor" });
      bob.provider.setAwarenessField("whiteboardPointer", {
        x: 5,
        y: 6,
        tool: "pointer",
        button: "up",
      });
      const bobState = () =>
        [...alice.provider.awareness!.getStates().values()].find(
          (state) => state.whiteboardPointer,
        );
      await until(() => bobState()?.user?.name === "bob");
      expect(bobState()?.user.userId).toBe(fixture.users.bob);
      expect(bobState()?.whiteboardPointer).toEqual({
        x: 5,
        y: 6,
        tool: "pointer",
        button: "up",
      });
    });
  });

  describe("revocation and ending", () => {
    it("replays ordinary provider handshake messages after admission", async () => {
      const sessionId = await newSession();
      const saved = new Y.Doc();
      saved.getText("content").insert(0, "persisted before join");
      await pool.query(
        "INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection) VALUES ($1,$2,$3)",
        [
          sessionId,
          Buffer.from(Y.encodeStateAsUpdate(saved)),
          "persisted before join",
        ],
      );
      saved.destroy();
      const originalCreate = collaboration.hocuspocus.createDocument.bind(
        collaboration.hocuspocus,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered = false;
      collaboration.hocuspocus.createDocument = (async (...args) => {
        entered = true;
        await gate;
        return originalCreate(...args);
      }) as typeof collaboration.hocuspocus.createDocument;
      try {
        const bob = join("bob", sessionId);
        await until(() => entered);
        expect(bob.provider.isSynced).toBe(false);
        expect(bob.state.closeReason).toBeUndefined();
        release();
        await until(() => bob.provider.isSynced);
        expect(bob.text.toString()).toBe("persisted before join");
        expect(bob.state.closeReason).toBeUndefined();
        bob.text.insert(bob.text.length, " and updated after join");
        await until(async () => {
          const stored = await pool.query<{ text_projection: string }>(
            "SELECT text_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
            [sessionId],
          );
          return (
            stored.rows[0]?.text_projection ===
            "persisted before join and updated after join"
          );
        });
      } finally {
        release();
        collaboration.hocuspocus.createDocument = originalCreate;
      }
    });

    it("holds removal until a paused admission either registers or aborts", async () => {
      await collaboration.stop();
      await startServer(60_000);
      await collaboration.dropListener();
      const sessionId = await newSession();
      const saved = new Y.Doc();
      saved.getText("content").insert(0, "private document state");
      await pool.query(
        "INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection) VALUES ($1,$2,$3)",
        [
          sessionId,
          Buffer.from(Y.encodeStateAsUpdate(saved)),
          "private document state",
        ],
      );
      saved.destroy();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const originalQuery = pool.query.bind(pool);
      let releaseLoad!: () => void;
      const gate = new Promise<void>((resolve) => (releaseLoad = resolve));
      let loadStarted = false;
      pool.query = ((
        sql: string | { text: string; values?: unknown[] },
        values: unknown[],
      ) => {
        const result =
          typeof sql === "string"
            ? originalQuery(sql, values)
            : originalQuery(sql);
        const text = typeof sql === "string" ? sql : sql.text;
        const parameters = typeof sql === "string" ? values : sql.values;
        if (
          text.includes("SELECT yjs_state FROM collaboration_documents") &&
          parameters?.[0] === sessionId
        )
          return Promise.resolve(result).then(async (value) => {
            loadStarted = true;
            await gate;
            return value;
          });
        return result;
      }) as typeof pool.query;
      try {
        const bob = join("bob", sessionId, { token: async () => ticket });
        await until(() => loadStarted);
        expect(collaboration.connectionsOf(sessionId)).toHaveLength(0);
        let removed = false;
        const removal = service
          .remove(sessionId, fixture.users.alice!, bobId)
          .then(() => {
            removed = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(removed).toBe(false);
        releaseLoad();
        await removal;
        await collaboration.sweep();
        const elapsed = await until(
          () => bob.state.closeReason === CLOSE_REASONS.removed,
        );
        expect(elapsed).toBeLessThan(5000);
        await expect(
          service.ticket(sessionId, bobId, authSessions[bobId]!),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        releaseLoad();
        pool.query = originalQuery;
        await collaboration.stop();
        await startServer();
      }
    });

    it("buffers every outbound frame while document registration is paused", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      alice.text.insert(0, "private content");
      alice.provider.setAwarenessField("whiteboardPointer", { x: 7, y: 9 });
      const originalCreate = collaboration.hocuspocus.createDocument.bind(
        collaboration.hocuspocus,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered = false;
      collaboration.hocuspocus.createDocument = (async (...args) => {
        entered = true;
        await gate;
        return originalCreate(...args);
      }) as typeof collaboration.hocuspocus.createDocument;
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const frames: Buffer[] = [];
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const encoder = encoding.createEncoder();
        encoding.writeVarString(encoder, documentName(sessionId));
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarString(encoder, ticket);
        raw.send(encoding.toUint8Array(encoder));
        const sync = encoding.createEncoder();
        encoding.writeVarString(sync, documentName(sessionId));
        encoding.writeVarUint(sync, 0);
        encoding.writeVarUint(sync, 0);
        encoding.writeVarUint8Array(sync, Y.encodeStateVector(new Y.Doc()));
        raw.send(encoding.toUint8Array(sync));
        const awarenessQuery = encoding.createEncoder();
        encoding.writeVarString(awarenessQuery, documentName(sessionId));
        encoding.writeVarUint(awarenessQuery, 3);
        raw.send(encoding.toUint8Array(awarenessQuery));
        await until(() => entered);
        alice.text.insert(alice.text.length, " broadcast");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(frames).toHaveLength(0);
        let removed = false;
        const removal = service
          .remove(sessionId, fixture.users.alice!, bobId)
          .then(() => {
            removed = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(removed).toBe(false);
        expect(frames).toHaveLength(0);
        release();
        await removal;
        await until(() => raw.readyState === WebSocket.CLOSED);
      } finally {
        release();
        collaboration.hocuspocus.createDocument = originalCreate;
        raw.terminate();
      }
    });

    it("drops a timed-out admission and permits a ticket retry without leaking locks", async () => {
      await collaboration.stop();
      await startServer(100, 3000);
      const sessionId = await newSession();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const originalCreate = collaboration.hocuspocus.createDocument.bind(
        collaboration.hocuspocus,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered = false;
      collaboration.hocuspocus.createDocument = (async (...args) => {
        entered = true;
        await gate;
        return originalCreate(...args);
      }) as typeof collaboration.hocuspocus.createDocument;
      const frames: Buffer[] = [];
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const encoder = encoding.createEncoder();
        encoding.writeVarString(encoder, documentName(sessionId));
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarString(encoder, ticket);
        raw.send(encoding.toUint8Array(encoder));
        const sync = encoding.createEncoder();
        encoding.writeVarString(sync, documentName(sessionId));
        encoding.writeVarUint(sync, 0);
        encoding.writeVarUint(sync, 0);
        encoding.writeVarUint8Array(sync, Y.encodeStateVector(new Y.Doc()));
        raw.send(encoding.toUint8Array(sync));
        const awarenessQuery = encoding.createEncoder();
        encoding.writeVarString(awarenessQuery, documentName(sessionId));
        encoding.writeVarUint(awarenessQuery, 3);
        raw.send(encoding.toUint8Array(awarenessQuery));
        await until(() => entered);
        await until(() => raw.readyState === WebSocket.CLOSED);
        expect(frames).toHaveLength(0);
        release();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(frames).toHaveLength(0);
        collaboration.hocuspocus.createDocument = originalCreate;
        const retry = join("bob", sessionId, { token: async () => ticket });
        await until(() => retry.provider.isSynced);
        await service.remove(sessionId, fixture.users.alice!, bobId);
        await until(() => retry.state.closeReason === CLOSE_REASONS.removed);
      } finally {
        release();
        collaboration.hocuspocus.createDocument = originalCreate;
        raw.terminate();
        await collaboration.stop();
        await startServer();
      }
    });

    it("drops queued inbound messages when document loading fails", async () => {
      const sessionId = await newSession();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const originalQuery = pool.query.bind(pool);
      pool.query = ((
        sql: string | { text: string; values?: unknown[] },
        values: unknown[],
      ) => {
        const text = typeof sql === "string" ? sql : sql.text;
        if (text.includes("SELECT yjs_state FROM collaboration_documents"))
          return Promise.reject(new Error("document load failed"));
        return typeof sql === "string"
          ? originalQuery(sql, values)
          : originalQuery(sql);
      }) as typeof pool.query;
      const frames: Buffer[] = [];
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      const pending = new Y.Doc();
      pending.getText("content").insert(0, "must be dropped");
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        raw.send(encoding.toUint8Array(auth));
        const query = encoding.createEncoder();
        encoding.writeVarString(query, documentName(sessionId));
        encoding.writeVarUint(query, 3);
        raw.send(encoding.toUint8Array(query));
        const update = encoding.createEncoder();
        encoding.writeVarString(update, documentName(sessionId));
        encoding.writeVarUint(update, 0);
        encoding.writeVarUint(update, 2);
        encoding.writeVarUint8Array(update, Y.encodeStateAsUpdate(pending));
        raw.send(encoding.toUint8Array(update));
        await until(() => raw.readyState === WebSocket.CLOSED);
        expect(frames).toHaveLength(0);
        expect(collaboration.connectionsOf(sessionId)).toHaveLength(0);
      } finally {
        pool.query = originalQuery;
        pending.destroy();
        raw.terminate();
      }
      const retry = join("bob", sessionId, { token: async () => ticket });
      await until(() => retry.provider.isSynced);
      expect(retry.text.toString()).toBe("");
    });

    it("lets concurrent removal commit after admission timeout without sending private frames", async () => {
      await collaboration.stop();
      await startServer(100, 3000);
      const sessionId = await newSession();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const originalCreate = collaboration.hocuspocus.createDocument.bind(
        collaboration.hocuspocus,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered = false;
      collaboration.hocuspocus.createDocument = (async (...args) => {
        entered = true;
        await gate;
        return originalCreate(...args);
      }) as typeof collaboration.hocuspocus.createDocument;
      const frames: Buffer[] = [];
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        raw.send(encoding.toUint8Array(auth));
        await until(() => entered);
        let removed = false;
        const removal = service
          .remove(sessionId, fixture.users.alice!, bobId)
          .then(() => {
            removed = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(removed).toBe(false);
        expect(frames).toHaveLength(0);
        await until(() => raw.readyState === WebSocket.CLOSED);
        await removal;
        expect(frames).toHaveLength(0);
        release();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(frames).toHaveLength(0);
      } finally {
        release();
        collaboration.hocuspocus.createDocument = originalCreate;
        raw.terminate();
        await collaboration.stop();
        await startServer();
      }
    });

    it("rejects awareness queries after removal when notifications are unavailable", async () => {
      await collaboration.stop();
      await startServer(60_000);
      await collaboration.dropListener();
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      alice.provider.setAwarenessField("whiteboardPointer", { x: 2, y: 3 });
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const frames: Buffer[] = [];
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      raw.on("message", (data) => frames.push(Buffer.from(data as Buffer)));
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        raw.send(encoding.toUint8Array(auth));
        await until(() => frames.length > 0);
        await until(() => collaboration.connectionsOf(sessionId).length === 2);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await service.remove(sessionId, fixture.users.alice!, bobId);
        expect(raw.readyState).toBe(WebSocket.OPEN);
        const before = frames.length;
        const query = encoding.createEncoder();
        encoding.writeVarString(query, documentName(sessionId));
        encoding.writeVarUint(query, 3);
        raw.send(encoding.toUint8Array(query));
        await until(() => raw.readyState === WebSocket.CLOSED);
        const decoding = await import("lib0/decoding");
        for (const frame of frames.slice(before)) {
          const decoder = decoding.createDecoder(frame);
          expect(decoding.readVarString(decoder)).toBe(documentName(sessionId));
          expect(decoding.readVarUint(decoder)).toBe(7);
          expect(decoding.readVarString(decoder)).toBe(CLOSE_REASONS.removed);
        }
      } finally {
        raw.terminate();
        await collaboration.stop();
        await startServer();
      }
    });

    it("fails closed on a database authorization error for non-sync messages", async () => {
      const sessionId = await newSession();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      const originalQuery = pool.query.bind(pool);
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        raw.send(encoding.toUint8Array(auth));
        await until(() => collaboration.connectionsOf(sessionId).length === 1);
        pool.query = ((
          sql: string | { text: string; values?: unknown[] },
          values: unknown[],
        ) => {
          const text = typeof sql === "string" ? sql : sql.text;
          if (text.includes("JOIN collaboration_participants cp"))
            return Promise.reject(new Error("database unavailable"));
          return typeof sql === "string"
            ? originalQuery(sql, values)
            : originalQuery(sql);
        }) as typeof pool.query;
        const query = encoding.createEncoder();
        encoding.writeVarString(query, documentName(sessionId));
        encoding.writeVarUint(query, 3);
        raw.send(encoding.toUint8Array(query));
        await until(() => raw.readyState === WebSocket.CLOSED);
      } finally {
        pool.query = originalQuery;
        raw.terminate();
      }
    });

    it("closes an established socket when authorization waits indefinitely for a database client", async () => {
      const sessionId = await newSession();
      const bobId = fixture.users.bob!;
      const ticket = (
        await service.ticket(sessionId, bobId, authSessions[bobId]!)
      ).ticket;
      const raw = new WebSocket(collaboration.server.webSocketURL, {
        headers: { Origin: ORIGIN },
      });
      const originalQuery = pool.query.bind(pool);
      try {
        await new Promise<void>((resolve) => raw.once("open", resolve));
        const encoding = await import("lib0/encoding");
        const auth = encoding.createEncoder();
        encoding.writeVarString(auth, documentName(sessionId));
        encoding.writeVarUint(auth, 2);
        encoding.writeVarUint(auth, 0);
        encoding.writeVarString(auth, ticket);
        raw.send(encoding.toUint8Array(auth));
        await until(() => collaboration.connectionsOf(sessionId).length === 1);
        pool.query = ((
          sql: string | { text: string; values?: unknown[] },
          values: unknown[],
        ) => {
          const text = typeof sql === "string" ? sql : sql.text;
          if (text.includes("JOIN collaboration_participants cp"))
            return new Promise(() => undefined);
          return typeof sql === "string"
            ? originalQuery(sql, values)
            : originalQuery(sql);
        }) as typeof pool.query;
        const query = encoding.createEncoder();
        encoding.writeVarString(query, documentName(sessionId));
        encoding.writeVarUint(query, 3);
        const started = Date.now();
        raw.send(encoding.toUint8Array(query));
        await until(() => raw.readyState === WebSocket.CLOSED);
        expect(Date.now() - started).toBeLessThan(4000);
      } finally {
        pool.query = originalQuery;
        raw.terminate();
      }
    });

    it("closes a removed invitee within 5 seconds", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      const bob = join("bob", sessionId);
      await until(() => alice.provider.isSynced && bob.provider.isSynced);
      await service.remove(sessionId, fixture.users.alice!, fixture.users.bob!);
      const elapsed = await until(() => bob.state.closeReason !== undefined);
      expect(bob.state.closeReason).toBe(CLOSE_REASONS.removed);
      expect(elapsed).toBeLessThan(5000);
      await expect(
        service.ticket(
          sessionId,
          fixture.users.bob!,
          authSessions[fixture.users.bob!]!,
        ),
      ).rejects.toMatchObject({ status: 404 });
      bob.text.insert(0, "after removal");
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(alice.text.toString()).not.toContain("after removal");
    });

    it("closes a member who leaves the course and a user who logs out", async () => {
      const sessionId = await newSession("alice", ["bob", "carol"]);
      const bob = join("bob", sessionId);
      const carol = join("carol", sessionId);
      await until(() => bob.provider.isSynced && carol.provider.isSynced);
      await new CourseService(pool).removeMember(
        fixture.courseId,
        fixture.users.carol!,
        fixture.users.carol!,
        undefined,
        true,
      );
      await until(() => carol.state.closeReason === CLOSE_REASONS.removed);
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
        [fixture.courseId, fixture.users.carol],
      );

      await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
        authSessions[fixture.users.bob!],
      ]);
      await collaborationAccessChanged(pool, [fixture.users.bob!]);
      await until(() => bob.state.closeReason === CLOSE_REASONS.removed);
      await pool.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [
        authSessions[fixture.users.bob!],
      ]);
    });

    it("does not grant staff override access and ignores the former post privacy", async () => {
      const sessionId = await newSession("alice", ["bob", "tim"]);
      const bob = join("bob", sessionId);
      const tim = join("tim", sessionId);
      await until(() => bob.provider.isSynced && tim.provider.isSynced);
      await pool.query("UPDATE posts SET private=true WHERE id=$1", [
        fixture.postId,
      ]);
      try {
        await collaborationAccessChanged(pool, [
          fixture.users.bob!,
          fixture.users.tim!,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(bob.state.closeReason).toBeUndefined();
        expect(tim.state.closeReason).toBeUndefined();
        await expect(
          service.ticket(
            sessionId,
            fixture.users.ina!,
            authSessions[fixture.users.ina!]!,
          ),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await pool.query("UPDATE posts SET private=false WHERE id=$1", [
          fixture.postId,
        ]);
      }
    });

    it("sweeps after the listener reconnects to catch a missed change", async () => {
      const sessionId = await newSession();
      const bob = join("bob", sessionId);
      await until(() => bob.provider.isSynced);
      await collaboration.dropListener();
      await pool.query(
        "DELETE FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2",
        [sessionId, fixture.users.bob],
      );
      await until(() => bob.state.closeReason === CLOSE_REASONS.removed);
    });

    it("stores the final text, marks the session ended, and closes editors on end", async () => {
      const sessionId = await newSession("alice", ["tim"]);
      const alice = join("alice", sessionId);
      const tim = join("tim", sessionId);
      await until(() => alice.provider.isSynced && tim.provider.isSynced);
      alice.text.insert(0, "while True:\n    break\n");
      await until(() => tim.text.toString() === "while True:\n    break\n");
      const current = await service.get(sessionId, fixture.users.tim!);
      const startedAt = Date.now();
      const ended = await service.update(
        sessionId,
        fixture.users.tim!,
        `"v${current.version}"`,
        {
          status: "ended",
        },
      );
      expect(Date.now() - startedAt).toBeLessThan(3000);
      expect(ended.status).toBe("ended");
      const snapshot = await service.snapshot(sessionId, fixture.users.alice!);
      expect(snapshot).toMatchObject({
        sessionStatus: "ended",
        content: "while True:\n    break\n",
        finalSnapshotConfirmed: true,
        lastSavedWarning: false,
      });
      const stale = new Y.Doc();
      stale.getText("content").insert(0, "older queued write");
      await collaboration.persist(sessionId, stale);
      await expect(
        service.snapshot(sessionId, fixture.users.alice!),
      ).resolves.toMatchObject({
        content: "while True:\n    break\n",
        finalSnapshotConfirmed: true,
      });
      await until(() => alice.state.closeReason === CLOSE_REASONS.ended);
      expect(
        alice.state.stateless.map((payload) => JSON.parse(payload).type),
      ).toContain("session-ended");
    });

    it("confirms only after an authorized in-flight edit drains and is durable", async () => {
      const sessionId = await newSession("alice", []);
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      await collaboration.connectionsOf(sessionId)[0]!.waitForPendingMessages();
      let releaseCheck!: () => void;
      const gate = new Promise<void>((resolve) => (releaseCheck = resolve));
      let updateReachedBeforeSync = false;
      const updateBarrier = {
        async beforeSync({
          type,
          context,
        }: {
          type: number;
          context: { userId: string; sessionId: string };
        }) {
          if (
            type === 2 &&
            context.userId === fixture.users.alice &&
            context.sessionId === sessionId
          ) {
            updateReachedBeforeSync = true;
            await gate;
          }
        },
      };
      collaboration.hocuspocus.configuration.extensions.push(updateBarrier);
      try {
        alice.text.insert(0, "drained before confirmation");
        await until(() => updateReachedBeforeSync);
        const current = await service.get(sessionId, fixture.users.alice!);
        const ending = service.update(
          sessionId,
          fixture.users.alice!,
          `"v${current.version}"`,
          { status: "ended" },
        );
        await until(async () => {
          const state = await pool.query<{ lifecycle_state: string }>(
            "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1",
            [sessionId],
          );
          return state.rows[0]?.lifecycle_state === "ending";
        });
        const before = await pool.query<{
          final_snapshot_confirmed: boolean;
        }>(
          "SELECT final_snapshot_confirmed FROM collaboration_sessions WHERE id=$1",
          [sessionId],
        );
        expect(before.rows[0]?.final_snapshot_confirmed).toBe(false);
        releaseCheck();
        const ended = await ending;
        expect(ended.finalSnapshotConfirmed).toBe(true);
        const snapshot = await service.snapshot(
          sessionId,
          fixture.users.alice!,
        );
        expect(snapshot).toMatchObject({
          content: "drained before confirmation",
          finalSnapshotConfirmed: true,
          lastSavedWarning: false,
        });
        const durable = await pool.query<{
          text_projection: string;
          final_snapshot_confirmed: boolean;
        }>(
          `SELECT d.text_projection,s.final_snapshot_confirmed
           FROM collaboration_sessions s JOIN collaboration_documents d ON d.collaboration_session_id=s.id
           WHERE s.id=$1`,
          [sessionId],
        );
        expect(durable.rows[0]).toEqual({
          text_projection: "drained before confirmation",
          final_snapshot_confirmed: true,
        });
      } finally {
        releaseCheck();
        const extensions = collaboration.hocuspocus.configuration.extensions;
        extensions.splice(extensions.indexOf(updateBarrier), 1);
      }
    });

    it("includes a disconnected participant's in-flight edit before confirmation", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      const bob = join("bob", sessionId);
      await until(() => alice.provider.isSynced && bob.provider.isSynced);
      await Promise.all(
        collaboration
          .connectionsOf(sessionId)
          .map((connection) => connection.waitForPendingMessages()),
      );
      const originalQuery = pool.query.bind(pool);
      let releaseCheck!: () => void;
      const gate = new Promise<void>((resolve) => (releaseCheck = resolve));
      let held = false;
      let authorized = false;
      pool.query = ((
        sql: string | { text: string; values?: unknown[] },
        values: unknown[],
      ) => {
        const result =
          typeof sql === "string"
            ? originalQuery(sql, values)
            : originalQuery(sql);
        const text = typeof sql === "string" ? sql : sql.text;
        const parameters = typeof sql === "string" ? values : sql.values;
        if (
          !held &&
          text.includes("JOIN collaboration_participants cp") &&
          parameters?.[0] === sessionId &&
          parameters?.[1] === fixture.users.bob
        ) {
          held = true;
          return Promise.resolve(result).then(async (value) => {
            authorized = true;
            await gate;
            return value;
          });
        }
        return result;
      }) as typeof pool.query;
      try {
        bob.text.insert(0, "disconnected edit");
        await until(() => authorized);
        bob.provider.destroy();
        bob.websocketProvider.destroy();
        await until(() => collaboration.connectionsOf(sessionId).length === 1);
        const current = await service.get(sessionId, fixture.users.alice!);
        const ending = service.update(
          sessionId,
          fixture.users.alice!,
          `"v${current.version}"`,
          { status: "ended" },
        );
        await until(async () => {
          const state = await pool.query<{ lifecycle_state: string }>(
            "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1",
            [sessionId],
          );
          return state.rows[0]?.lifecycle_state === "ending";
        });
        releaseCheck();
        const ended = await ending;
        expect(ended.finalSnapshotConfirmed).toBe(true);
        const snapshot = await service.snapshot(
          sessionId,
          fixture.users.alice!,
        );
        expect(snapshot.content).toContain("disconnected edit");
        expect(snapshot.lastSavedWarning).toBe(false);
      } finally {
        releaseCheck();
        pool.query = originalQuery;
      }
    });

    it("warns when an authorized update is still in flight during final capture", async () => {
      const sessionId = await newSession("alice", []);
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      await collaboration.connectionsOf(sessionId)[0]!.waitForPendingMessages();
      const originalQuery = pool.query.bind(pool);
      let releaseCheck!: () => void;
      const gate = new Promise<void>((resolve) => (releaseCheck = resolve));
      let held = false;
      let authorized = false;
      pool.query = ((
        sql: string | { text: string; values?: unknown[] },
        values: unknown[],
      ) => {
        const result =
          typeof sql === "string"
            ? originalQuery(sql, values)
            : originalQuery(sql);
        const text = typeof sql === "string" ? sql : sql.text;
        const parameters = typeof sql === "string" ? values : sql.values;
        if (
          !held &&
          text.includes("JOIN collaboration_participants cp") &&
          parameters?.[0] === sessionId
        ) {
          held = true;
          return Promise.resolve(result).then(async (value) => {
            authorized = true;
            await gate;
            return value;
          });
        }
        return result;
      }) as typeof pool.query;
      try {
        alice.text.insert(0, "in-flight edit");
        await until(() => authorized);
        const current = await service.get(sessionId, fixture.users.alice!);
        // The authorization check itself fails closed after two seconds; end
        // sooner to exercise the unconfirmed fallback while it is still pending.
        const shortEndService = new CollaborationSessionService(pool, {
          webSocketUrl: "wss://app.example.edu/collaboration",
          endTimeoutMs: 500,
          endPollMs: 20,
        });
        const ended = await shortEndService.update(
          sessionId,
          fixture.users.alice!,
          `"v${current.version}"`,
          { status: "ended" },
        );
        expect(ended.finalSnapshotConfirmed).toBe(false);
        const snapshot = await service.snapshot(
          sessionId,
          fixture.users.alice!,
        );
        expect(snapshot).toMatchObject({
          sessionStatus: "ended",
          finalSnapshotConfirmed: false,
          lastSavedWarning: true,
        });
        expect(snapshot.content).not.toContain("in-flight edit");
      } finally {
        releaseCheck();
        pool.query = originalQuery;
      }
    });

    it("does not claim a confirmed final snapshot when the final database flush fails", async () => {
      const sessionId = await newSession();
      const alice = join("alice", sessionId);
      await until(() => alice.provider.isSynced);
      alice.text.insert(0, "possibly unsaved");
      await until(
        () =>
          collaboration.hocuspocus.documents
            .get(documentName(sessionId))
            ?.getText("content")
            .toString() === "possibly unsaved",
      );
      const lockKey = 9_114_275;
      const blocker = await pool.connect();
      await blocker.query("SELECT pg_advisory_lock($1)", [lockKey]);
      await pool.query(`CREATE FUNCTION reject_collaboration_store() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          PERFORM pg_advisory_xact_lock(${lockKey});
          RAISE EXCEPTION 'simulated storage outage';
        END $$`);
      await pool.query(`CREATE TRIGGER reject_collaboration_store
        BEFORE INSERT OR UPDATE ON collaboration_documents
        FOR EACH ROW EXECUTE FUNCTION reject_collaboration_store()`);
      let blockerReleased = false;
      try {
        const current = await service.get(sessionId, fixture.users.alice!);
        const ending = service.update(
          sessionId,
          fixture.users.alice!,
          `"v${current.version}"`,
          { status: "ended" },
        );
        // Observe the final store actually entering the failing trigger, then
        // release it. This avoids a race between the API's timeout fallback
        // and an unconstrained database failure on a loaded CI runner.
        await until(async () => {
          const waiting = await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid::bigint=$1",
            [lockKey],
          );
          return Boolean(waiting.rowCount);
        });
        await blocker.query("SELECT pg_advisory_unlock($1)", [lockKey]);
        blockerReleased = true;
        const ended = await ending;
        expect(ended.finalSnapshotConfirmed).toBe(false);
        const stored = await pool.query<{
          lifecycle_state: string;
          final_snapshot_confirmed: boolean;
        }>(
          "SELECT lifecycle_state,final_snapshot_confirmed FROM collaboration_sessions WHERE id=$1",
          [sessionId],
        );
        expect(stored.rows[0]).toMatchObject({
          lifecycle_state: "ended",
          final_snapshot_confirmed: false,
        });
        await expect(
          service.snapshot(sessionId, fixture.users.alice!),
        ).resolves.toMatchObject({
          finalSnapshotConfirmed: false,
          lastSavedWarning: true,
        });
        await until(
          () => alice.state.closeReason === CLOSE_REASONS.ended,
          8000,
        );
        const shutdownStarted = Date.now();
        await collaboration.stop();
        expect(Date.now() - shutdownStarted).toBeLessThan(5000);
      } finally {
        if (!blockerReleased)
          await blocker.query("SELECT pg_advisory_unlock($1)", [lockKey]);
        blocker.release();
        await pool.query(
          "DROP TRIGGER reject_collaboration_store ON collaboration_documents",
        );
        await pool.query("DROP FUNCTION reject_collaboration_store()");
        await startServer();
      }
    }, 20_000);

    it("rejects a document name that is not a session", async () => {
      const sessionId = await newSession();
      const client = join("alice", sessionId, { documentId: "answer:123" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(client.provider.isSynced).toBe(false);
    });
  });
});
