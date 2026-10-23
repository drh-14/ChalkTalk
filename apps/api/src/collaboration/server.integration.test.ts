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

  function startServer() {
    collaboration = createCollaborationServer({
      pool,
      databaseUrl: url!,
      frontendOrigins: new Set([ORIGIN]),
      port: 0,
      address: "127.0.0.1",
      debounce: 300,
      maxDebounce: 800,
      sweepIntervalMs: 60_000,
      listenerRetryMs: 100,
      metricsToken: METRICS_TOKEN,
    });
    return collaboration.start();
  }

  async function newSession(creator = "alice", invitees: string[] = ["bob"]) {
    const session = (
      await service.create(fixture.courseId, fixture.users[creator]!, {
        postId: fixture.postId,
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
    return { provider, document, text: document.getText("content"), state };
  }

  beforeAll(async () => {
    database = await createTestSchema(url!, "collab_server");
    pool = database.pool;
    service = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
      endTimeoutMs: 3000,
      endPollMs: 20,
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
  });

  describe("authentication", () => {
    it("accepts a valid ticket once and rejects its reuse", async () => {
      const sessionId = await newSession();
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
      const sessionId = await newSession();
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
    it("closes a removed invitee within 5 seconds", async () => {
      const sessionId = await newSession();
      const bob = join("bob", sessionId);
      await until(() => bob.provider.isSynced);
      await service.remove(sessionId, fixture.users.alice!, fixture.users.bob!);
      const elapsed = await until(() => bob.state.closeReason !== undefined);
      expect(bob.state.closeReason).toBe(CLOSE_REASONS.removed);
      expect(elapsed).toBeLessThan(5000);
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

    it("closes and refuses a classmate once the anchor post is private", async () => {
      const sessionId = await newSession("alice", ["bob", "tim"]);
      const bob = join("bob", sessionId);
      const tim = join("tim", sessionId);
      await until(() => bob.provider.isSynced && tim.provider.isSynced);
      // The API never makes a public post private; this checks the server's own rule.
      await pool.query("UPDATE posts SET private=true WHERE id=$1", [
        fixture.postId,
      ]);
      try {
        await collaborationAccessChanged(pool, [
          fixture.users.bob!,
          fixture.users.tim!,
        ]);
        await until(() => bob.state.closeReason === CLOSE_REASONS.removed);
        expect(tim.state.closeReason).toBeUndefined();
        const again = join("bob", sessionId);
        await until(
          () => again.state.authFailed || again.state.closeReason !== undefined,
        );
        expect(again.provider.isSynced).toBe(false);
      } finally {
        await pool.query("UPDATE posts SET private=false WHERE id=$1", [
          fixture.postId,
        ]);
      }
    });

    it("stops outbound updates when a connected group member is removed", async () => {
      const groupId = uuidv7();
      await pool.query(
        "INSERT INTO private_post_groups(id,course_id,name) VALUES ($1,$2,'Live group')",
        [groupId, fixture.courseId],
      );
      for (const userId of [fixture.users.alice!, fixture.users.bob!])
        await pool.query(
          "INSERT INTO private_post_group_members(group_id,course_id,user_id) VALUES ($1,$2,$3)",
          [groupId, fixture.courseId, userId],
        );
      await pool.query(
        "UPDATE posts SET audience='group',audience_group_id=$2,private=true WHERE id=$1",
        [fixture.postId, groupId],
      );
      try {
        const sessionId = await newSession("alice", ["bob"]);
        const alice = join("alice", sessionId);
        const bob = join("bob", sessionId);
        await until(() => alice.provider.isSynced && bob.provider.isSynced);
        alice.text.insert(0, "Before revocation");
        await until(() => bob.text.toString() === "Before revocation");
        await pool.query(
          "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
          [groupId, fixture.users.bob],
        );
        alice.text.insert(alice.text.length, " after revocation");
        await until(() => bob.state.closeReason === CLOSE_REASONS.removed);
        expect(bob.text.toString()).toBe("Before revocation");
      } finally {
        await pool.query(
          "UPDATE posts SET audience='class',audience_group_id=NULL,private=false WHERE id=$1",
          [fixture.postId],
        );
        await pool.query("DELETE FROM private_post_groups WHERE id=$1", [
          groupId,
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
      });
      await until(() => alice.state.closeReason === CLOSE_REASONS.ended);
      expect(
        alice.state.stateless.map((payload) => JSON.parse(payload).type),
      ).toContain("session-ended");
    });

    it("rejects a document name that is not a session", async () => {
      const sessionId = await newSession();
      const client = join("alice", sessionId, { documentId: "answer:123" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(client.provider.isSynced).toBe(false);
    });
  });
});
