import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import WebSocket from "ws";
import { OutgoingMessage } from "@hocuspocus/server";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { CollaborationStore } from "./store.js";
import { createCollaborationServer } from "./server.js";
import { AuthorizedEgress } from "./egress.js";

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const integration = url ? describe : describe.skip;
const schema = `live_store_${process.pid}_${Date.now()}`;
const id = {
  org: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
  post: "01a0e5cc-58ae-7009-9f43-e69b17afee03",
  student: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  otherStudent: "01a0e5cc-58ae-7009-9f43-c8155fb23e06",
  ta: "01a0e5cc-58ae-7009-9f43-cd86eb2ae706",
  instructor: "01a0e5cc-58ae-7009-9f43-ddd412c38e07",
  studentSession: "01a0e5cc-58ae-7009-9f43-100000000001",
  otherSession: "01a0e5cc-58ae-7009-9f43-100000000002",
  taSession: "01a0e5cc-58ae-7009-9f43-100000000003",
  instructorSession: "01a0e5cc-58ae-7009-9f43-100000000004",
  answer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e08",
  staffAnswer: "01a0e5cc-58ae-7009-9f43-ea8bbebc2e09",
  followup: "01a0e5cc-58ae-7009-9f43-e237164911eb",
};
let admin: Pool;
let pool: Pool;
let store: CollaborationStore;

function state(text: string) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}
function changed(existing: Uint8Array, insert: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, existing);
  doc.getText("content").insert(doc.getText("content").length, insert);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}
class OriginWebSocket extends WebSocket {
  constructor(address: string) {
    super(address, { origin: "http://localhost" });
  }
}
async function until(
  check: () => boolean | Promise<boolean>,
  timeout = 10_000,
) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for real-node collaboration");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

integration("live collaboration persistence and authorization", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'example.edu','Example')",
      [id.org],
    );
    for (const [user, email] of [
      [id.student, "student@example.edu"],
      [id.otherStudent, "other@example.edu"],
      [id.ta, "ta@example.edu"],
      [id.instructor, "instructor@example.edu"],
    ])
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$3,'x')",
        [user, id.org, email],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Course','ABCDEFGH')",
      [id.course, id.org, id.instructor],
    );
    for (const [user, role] of [
      [id.student, "student"],
      [id.otherStudent, "student"],
      [id.ta, "ta"],
      [id.instructor, "instructor"],
    ])
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,$3)",
        [id.course, user, role],
      );
    for (const [index, session, user] of [
      [1, id.studentSession, id.student],
      [2, id.otherSession, id.otherStudent],
      [3, id.taSession, id.ta],
      [4, id.instructorSession, id.instructor],
    ] as const)
      await pool.query(
        "INSERT INTO sessions(id,user_id,credential_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
        [session, user, Buffer.alloc(32, index), Buffer.alloc(32, index + 10)],
      );
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Question','Body')",
      [id.post, id.course, id.student],
    );
    for (const [answer, kind, creator, floor, body] of [
      [id.answer, "student", id.student, "student", "Student text"],
      [id.staffAnswer, "staff", id.ta, "ta", "Staff text"],
    ]) {
      await pool.query(
        "INSERT INTO answers(id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [answer, id.course, id.post, kind, body, creator, floor],
      );
      await pool.query(
        "INSERT INTO answer_collaboration_documents(answer_id,yjs_state) VALUES($1,$2)",
        [answer, state(body)],
      );
      await pool.query(
        "INSERT INTO answer_contributors(answer_id,user_id) VALUES($1,$2)",
        [answer, creator],
      );
    }
    await pool.query(
      "INSERT INTO followups(id,course_id,post_id,author_user_id,body_markdown) VALUES($1,$2,$3,$4,'Followup text')",
      [id.followup, id.course, id.post, id.student],
    );
    await pool.query(
      "INSERT INTO followup_collaboration_documents(followup_id,yjs_state) VALUES($1,$2)",
      [id.followup, state("Followup text")],
    );
    store = new CollaborationStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  (redisUrl ? it : it.skip)(
    "keeps an idle real-store provider connected and persists its next edit",
    async () => {
      const idlePost = randomUUID();
      const idleAnswer = randomUUID();
      await pool.query(
        "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown) VALUES($1,$2,$3,'question','Idle question','Body')",
        [idlePost, id.course, id.student],
      );
      await pool.query(
        "INSERT INTO answers(id,course_id,post_id,kind,body_markdown,created_by_user_id,edit_role_floor) VALUES($1,$2,$3,'student','Idle store text',$4,'student')",
        [idleAnswer, id.course, idlePost, id.student],
      );
      await pool.query(
        "INSERT INTO answer_collaboration_documents(answer_id,yjs_state) VALUES($1,$2)",
        [idleAnswer, state("Idle store text")],
      );
      const node = createCollaborationServer({
        store,
        redisUrl: redisUrl!,
        redisPrefix: `chalktalk-idle-store-${randomUUID()}`,
        allowedOrigins: new Set(["http://localhost"]),
        port: 0,
        address: "127.0.0.1",
      });
      let provider: HocuspocusProvider | undefined;
      let socket: HocuspocusProviderWebsocket | undefined;
      try {
        await node.listen();
        const ticket = await store.issueTicket(
          "answer",
          idleAnswer,
          id.student,
          id.studentSession,
        );
        socket = new HocuspocusProviderWebsocket({
          url: node.webSocketURL,
          WebSocketPolyfill: OriginWebSocket,
        });
        const document = new Y.Doc();
        provider = new HocuspocusProvider({
          websocketProvider: socket,
          document,
          name: `answer:${idleAnswer}`,
          awareness: null,
          token: ticket,
        });
        provider.attach();
        await until(() => provider!.isSynced);
        const connectionId = socket.identifier;
        await new Promise((resolve) => setTimeout(resolve, 35_000));
        expect(provider.isSynced).toBe(true);
        expect(socket.identifier).toBe(connectionId);
        const suffix = ` idle-${randomUUID()}`;
        const text = document.getText("content");
        text.insert(text.length, suffix);
        await until(async () =>
          (await store.load("answer", idleAnswer)).text.endsWith(suffix),
        );
        expect(socket.identifier).toBe(connectionId);
      } finally {
        provider?.destroy();
        socket?.destroy();
        await node.destroy();
      }
    },
    50_000,
  );

  it("issues only role-authorized, document-bound one-use tickets", async () => {
    await expect(
      store.issueTicket(
        "answer",
        id.staffAnswer,
        id.student,
        id.studentSession,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.issueTicket(
        "followup",
        id.followup,
        id.otherStudent,
        id.otherSession,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const token = await store.issueTicket(
      "answer",
      id.staffAnswer,
      id.ta,
      id.taSession,
    );
    await expect(
      store.consumeTicket(token, "followup", id.followup),
    ).rejects.toMatchObject({ status: 403 });
    const context = await store.consumeTicket(token, "answer", id.staffAnswer);
    expect(context).toMatchObject({
      userId: id.ta,
      sessionId: id.taSession,
      kind: "answer",
      documentId: id.staffAnswer,
    });
    await expect(
      store.consumeTicket(token, "answer", id.staffAnswer),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("commits an answer update and attribution, then blocks a revoked session", async () => {
    const initial = await store.load("answer", id.answer);
    const update = changed(initial.state, " edited");
    const committed = await store.applyUpdate(
      "answer",
      id.answer,
      id.otherStudent,
      id.otherSession,
      update,
    );
    expect(committed.text).toBe("Student text edited");
    expect(committed.version).toBe(2);
    const row = await pool.query(
      "SELECT body_markdown,version FROM answers WHERE id=$1",
      [id.answer],
    );
    expect(row.rows[0]).toMatchObject({
      body_markdown: "Student text edited",
      version: "2",
    });
    const contributors = await pool.query(
      "SELECT user_id FROM answer_contributors WHERE answer_id=$1 AND user_id=$2",
      [id.answer, id.otherStudent],
    );
    expect(contributors.rowCount).toBe(1);
    const replay = await store.applyUpdate(
      "answer",
      id.answer,
      id.otherStudent,
      id.otherSession,
      update,
    );
    expect(replay.version).toBe(2);
    await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
      id.otherSession,
    ]);
    await expect(
      store.applyUpdate(
        "answer",
        id.answer,
        id.otherStudent,
        id.otherSession,
        changed(committed.state, " late"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await pool.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [
      id.otherSession,
    ]);
  });

  it("allows temporary empty followup text and rejects an unrelated student", async () => {
    const initial = await store.load("followup", id.followup);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, initial.state);
    doc.getText("content").delete(0, doc.getText("content").length);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    const saved = await store.applyUpdate(
      "followup",
      id.followup,
      id.student,
      id.studentSession,
      update,
    );
    expect(saved.text).toBe("");
    expect(
      (
        await pool.query("SELECT body_markdown FROM followups WHERE id=$1", [
          id.followup,
        ])
      ).rows[0].body_markdown,
    ).toBe("");
    await expect(
      store.applyUpdate(
        "followup",
        id.followup,
        id.otherStudent,
        id.otherSession,
        changed(saved.state, "spoof"),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("persists authorized live edits to an existing reply body", async () => {
    const reply = await new FollowupService(pool).create(
      id.post,
      id.student,
      { bodyMarkdown: "Reply text" },
      id.followup,
    );
    expect(reply.parentId).toBe(id.followup);
    expect(reply.version).toBe(1);
    await expect(
      store.issueTicket("followup", reply.id, id.otherStudent, id.otherSession),
    ).rejects.toMatchObject({ status: 403 });
    const token = await store.issueTicket(
      "followup",
      reply.id,
      id.student,
      id.studentSession,
    );
    expect(
      await store.consumeTicket(token, "followup", reply.id),
    ).toMatchObject({
      userId: id.student,
      documentId: reply.id,
    });
    const initial = await store.load("followup", reply.id);
    const saved = await store.applyUpdate(
      "followup",
      reply.id,
      id.student,
      id.studentSession,
      changed(initial.state, " edited"),
    );
    expect(saved.text).toBe("Reply text edited");
    expect(saved.version).toBe(2);
    await expect(
      store.applyUpdate(
        "followup",
        reply.id,
        id.otherStudent,
        id.otherSession,
        changed(saved.state, " unauthorized"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const row = await pool.query(
      `SELECT f.body_markdown,f.version,f.parent_followup_id,d.yjs_state
       FROM followups f JOIN followup_collaboration_documents d ON d.followup_id=f.id
       WHERE f.id=$1`,
      [reply.id],
    );
    expect(row.rows[0]).toMatchObject({
      body_markdown: "Reply text edited",
      version: "2",
      parent_followup_id: id.followup,
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.rows[0].yjs_state);
    expect(doc.getText("content").toString()).toBe("Reply text edited");
    doc.destroy();
    expect((await store.load("followup", reply.id)).text).toBe(
      "Reply text edited",
    );
    await expect(
      store.issueTicket("followup", reply.id, id.ta, id.taSession),
    ).resolves.toEqual(expect.any(String));
    const staffEdit = await store.applyUpdate(
      "followup",
      reply.id,
      id.ta,
      id.taSession,
      changed(saved.state, " by staff"),
    );
    expect(staffEdit.text).toBe("Reply text edited by staff");
    expect(staffEdit.version).toBe(3);
    expect((await store.load("followup", reply.id)).text).toBe(staffEdit.text);
  });

  it("revokes a live editor immediately when course membership is removed", async () => {
    const initial = await store.load("answer", id.staffAnswer);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [id.course, id.ta],
    );
    await expect(
      store.checkAccess("answer", id.staffAnswer, id.ta, id.taSession),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.applyUpdate(
        "answer",
        id.staffAnswer,
        id.ta,
        id.taSession,
        changed(initial.state, " unauthorized"),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'ta')",
      [id.course, id.ta],
    );
  });

  it("receives committed REST revision notices without treating Redis as durable storage", async () => {
    let received = "";
    const stop = await store.listenForRevisions((kind, documentId) => {
      received = `${kind}:${documentId}`;
    });
    try {
      await pool.query(
        "SELECT pg_notify('chalktalk_collaboration_revision',$1)",
        [JSON.stringify({ kind: "answer", id: id.answer })],
      );
      const start = Date.now();
      while (!received && Date.now() - start < 2000)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toBe(`answer:${id.answer}`);
    } finally {
      await stop();
    }
  });

  it("serializes a stale REST save behind a committed live answer edit", async () => {
    const service = new AnswerService(pool);
    const before = await service.get(id.staffAnswer, id.ta);
    const loaded = await store.load("answer", id.staffAnswer);
    const live = await store.applyUpdate(
      "answer",
      id.staffAnswer,
      id.ta,
      id.taSession,
      changed(loaded.state, " live"),
    );
    await expect(
      service.edit(
        id.staffAnswer,
        id.ta,
        `"v${before.version}"`,
        "stale replacement",
      ),
    ).rejects.toMatchObject({ status: 412, code: "version_conflict" });
    expect((await service.get(id.staffAnswer, id.ta)).bodyMarkdown).toBe(
      live.text,
    );
  });

  (redisUrl ? it : it.skip)(
    "persists across two real Redis nodes before propagation and revokes a removed editor",
    async () => {
      const prefix = `chalktalk-real-live-${randomUUID()}`;
      const first = createCollaborationServer({
        store,
        redisUrl: redisUrl!,
        redisPrefix: prefix,
        allowedOrigins: new Set(["http://localhost"]),
        port: 0,
        address: "127.0.0.1",
      });
      const second = createCollaborationServer({
        store,
        redisUrl: redisUrl!,
        redisPrefix: prefix,
        allowedOrigins: new Set(["http://localhost"]),
        port: 0,
        address: "127.0.0.1",
      });
      const providers: HocuspocusProvider[] = [];
      const sockets: HocuspocusProviderWebsocket[] = [];
      try {
        await Promise.all([first.listen(), second.listen()]);
        async function connect(
          node: typeof first,
          user: string,
          session: string,
        ) {
          const token = await store.issueTicket(
            "answer",
            id.answer,
            user,
            session,
          );
          const socket = new HocuspocusProviderWebsocket({
            url: node.webSocketURL,
            WebSocketPolyfill: OriginWebSocket,
          });
          const document = new Y.Doc();
          const provider = new HocuspocusProvider({
            websocketProvider: socket,
            document,
            name: `answer:${id.answer}`,
            awareness: null,
            token,
          });
          sockets.push(socket);
          providers.push(provider);
          provider.attach();
          return { provider, document };
        }
        const left = await connect(first, id.student, id.studentSession);
        const right = await connect(second, id.otherStudent, id.otherSession);
        await until(() => left.provider.isSynced && right.provider.isSynced);
        const before = right.document.getText("content").toString();
        left.document
          .getText("content")
          .insert(left.document.getText("content").length, " real nodes");
        await until(
          async () =>
            (await store.load("answer", id.answer)).text ===
            `${before} real nodes`,
        );
        await until(
          () =>
            right.document.getText("content").toString() ===
            `${before} real nodes`,
        );
        expect((await store.load("answer", id.answer)).text).toBe(
          `${before} real nodes`,
        );

        const answerService = new AnswerService(pool);
        const restBefore = await answerService.get(id.answer, id.instructor);
        const restText = `${before} real nodes REST`;
        await answerService.edit(
          id.answer,
          id.instructor,
          `"v${restBefore.version}"`,
          restText,
        );
        await until(
          () =>
            left.document.getText("content").toString() === restText &&
            right.document.getText("content").toString() === restText,
        );

        await pool.query(
          "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
          [id.course, id.student],
        );
        left.document
          .getText("content")
          .insert(left.document.getText("content").length, " forbidden");
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(right.document.getText("content").toString()).toBe(restText);
        expect((await store.load("answer", id.answer)).text).toBe(restText);
      } finally {
        for (const provider of providers) provider.destroy();
        for (const socket of sockets) socket.destroy();
        await Promise.all([first.destroy(), second.destroy()]);
        await pool.query(
          "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student') ON CONFLICT DO NOTHING",
          [id.course, id.student],
        );
      }
    },
    30_000,
  );

  (redisUrl ? it : it.skip)(
    "rejects an embedded followup update before persistence or peer broadcast",
    async () => {
      const prefix = `chalktalk-embed-test-${randomUUID()}`;
      const nodes = [0, 1].map(() =>
        createCollaborationServer({
          store,
          redisUrl: redisUrl!,
          redisPrefix: prefix,
          allowedOrigins: new Set(["http://localhost"]),
          port: 0,
          address: "127.0.0.1",
        }),
      );
      const providers: HocuspocusProvider[] = [];
      const sockets: HocuspocusProviderWebsocket[] = [];
      try {
        await Promise.all(nodes.map((node) => node.listen()));
        async function connect(
          node: (typeof nodes)[number],
          user: string,
          session: string,
        ) {
          const ticket = await store.issueTicket(
            "followup",
            id.followup,
            user,
            session,
          );
          const socket = new HocuspocusProviderWebsocket({
            url: node.webSocketURL,
            WebSocketPolyfill: OriginWebSocket,
          });
          const document = new Y.Doc();
          const provider = new HocuspocusProvider({
            websocketProvider: socket,
            document,
            name: `followup:${id.followup}`,
            awareness: null,
            token: ticket,
          });
          sockets.push(socket);
          providers.push(provider);
          provider.attach();
          return { provider, document };
        }
        const writer = await connect(nodes[0], id.student, id.studentSession);
        const peer = await connect(nodes[1], id.ta, id.taSession);
        await until(() => writer.provider.isSynced && peer.provider.isSynced);
        const peerDelta = peer.document.getText("content").toDelta();
        const before = await pool.query(
          `SELECT f.body_markdown,f.version,d.yjs_state,d.persistence_revision
           FROM followups f JOIN followup_collaboration_documents d ON d.followup_id=f.id
           WHERE f.id=$1`,
          [id.followup],
        );
        const map = new Y.Map();
        map.set("nested", new Y.Array());
        let rejected = false;
        writer.provider.on("close", () => {
          rejected = true;
        });
        writer.document.getText("content").insertEmbed(0, map);
        await until(() => rejected);
        const after = await pool.query(
          `SELECT f.body_markdown,f.version,d.yjs_state,d.persistence_revision
           FROM followups f JOIN followup_collaboration_documents d ON d.followup_id=f.id
           WHERE f.id=$1`,
          [id.followup],
        );
        expect(after.rows[0]).toEqual(before.rows[0]);
        expect(peer.document.getText("content").toDelta()).toEqual(peerDelta);
      } finally {
        for (const provider of providers) provider.destroy();
        for (const socket of sockets) socket.destroy();
        await Promise.all(nodes.map((node) => node.destroy()));
      }
    },
    30_000,
  );

  (redisUrl ? it : it.skip)(
    "withholds post-revocation Redis and REST updates from a connected editor",
    async () => {
      const prefix = `chalktalk-revocation-${randomUUID()}`;
      const nodes = [0, 1].map(() =>
        createCollaborationServer({
          store,
          redisUrl: redisUrl!,
          redisPrefix: prefix,
          allowedOrigins: new Set(["http://localhost"]),
          port: 0,
          address: "127.0.0.1",
        }),
      );
      const providers: HocuspocusProvider[] = [];
      const sockets: HocuspocusProviderWebsocket[] = [];
      async function connect(
        node: (typeof nodes)[number],
        user: string,
        session: string,
      ) {
        const ticket = await store.issueTicket(
          "answer",
          id.staffAnswer,
          user,
          session,
        );
        const socket = new HocuspocusProviderWebsocket({
          url: node.webSocketURL,
          WebSocketPolyfill: OriginWebSocket,
        });
        const document = new Y.Doc();
        const provider = new HocuspocusProvider({
          websocketProvider: socket,
          document,
          name: `answer:${id.staffAnswer}`,
          awareness: null,
          token: ticket,
        });
        sockets.push(socket);
        providers.push(provider);
        provider.attach();
        await until(() => provider.isSynced);
        return { provider, document, socket };
      }
      try {
        await Promise.all(nodes.map((node) => node.listen()));
        const writer = await connect(
          nodes[1],
          id.instructor,
          id.instructorSession,
        );
        for (const mode of [
          "membership",
          "role",
          "session",
          "account",
          "rest",
          "sync",
        ] as const) {
          const reader = await connect(nodes[0], id.ta, id.taSession);
          const oldText = reader.document.getText("content").toString();
          let closed = false;
          reader.provider.on("close", () => {
            closed = true;
          });
          try {
            if (mode === "membership" || mode === "rest")
              await pool.query(
                "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
                [id.course, id.ta],
              );
            else if (mode === "role" || mode === "sync")
              await pool.query(
                "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
                [id.course, id.ta],
              );
            else if (mode === "session")
              await pool.query(
                "UPDATE sessions SET revoked_at=now() WHERE id=$1",
                [id.taSession],
              );
            else if (mode === "account")
              await pool.query(
                "UPDATE users SET deleted_at=now() WHERE id=$1",
                [id.ta],
              );
            if (mode === "sync") {
              reader.socket.webSocket?.send(
                new OutgoingMessage(`answer:${id.staffAnswer}`)
                  .createSyncMessage()
                  .writeFirstSyncStepFor(reader.document)
                  .toUint8Array(),
              );
              await until(() => closed);
            }
            const next = `${oldText} ${mode}`;
            if (mode === "rest") {
              const service = new AnswerService(pool);
              const current = await service.get(id.staffAnswer, id.instructor);
              await service.edit(
                id.staffAnswer,
                id.instructor,
                `"v${current.version}"`,
                next,
              );
              await until(
                () => writer.document.getText("content").toString() === next,
              );
            } else {
              writer.document
                .getText("content")
                .insert(oldText.length, ` ${mode}`);
              await until(
                () => writer.document.getText("content").toString() === next,
              );
              await until(
                async () =>
                  (
                    await pool.query(
                      "SELECT body_markdown FROM answers WHERE id=$1",
                      [id.staffAnswer],
                    )
                  ).rows[0]?.body_markdown === next,
              );
            }
            await until(
              () => writer.document.getText("content").toString() === next,
            );
            await until(() => closed);
            expect(reader.document.getText("content").toString()).toBe(oldText);
          } finally {
            reader.provider.destroy();
            if (mode === "membership" || mode === "rest")
              await pool.query(
                "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'ta')",
                [id.course, id.ta],
              );
            else if (mode === "role" || mode === "sync")
              await pool.query(
                "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
                [id.course, id.ta],
              );
            else if (mode === "session")
              await pool.query(
                "UPDATE sessions SET revoked_at=NULL WHERE id=$1",
                [id.taSession],
              );
            else if (mode === "account")
              await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
                id.ta,
              ]);
          }
        }
      } finally {
        for (const provider of providers) provider.destroy();
        for (const socket of sockets) socket.destroy();
        await Promise.all(nodes.map((node) => node.destroy()));
      }
    },
    60_000,
  );

  (redisUrl ? it : it.skip)(
    "does not load initial document content after a session revocation commits",
    async () => {
      let entered!: () => void;
      let resume!: () => void;
      const loading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const intercepted = Object.create(store) as CollaborationStore;
      intercepted.loadAuthorized = async (...args) => {
        entered();
        await released;
        return store.loadAuthorized(...args);
      };
      const node = createCollaborationServer({
        store: intercepted,
        redisUrl: redisUrl!,
        redisPrefix: `chalktalk-load-race-${randomUUID()}`,
        allowedOrigins: new Set(["http://localhost"]),
        port: 0,
        address: "127.0.0.1",
      });
      let provider: HocuspocusProvider | undefined;
      let socket: HocuspocusProviderWebsocket | undefined;
      try {
        await node.listen();
        const ticket = await store.issueTicket(
          "answer",
          id.staffAnswer,
          id.ta,
          id.taSession,
        );
        socket = new HocuspocusProviderWebsocket({
          url: node.webSocketURL,
          WebSocketPolyfill: OriginWebSocket,
        });
        const document = new Y.Doc();
        let closed = false;
        provider = new HocuspocusProvider({
          websocketProvider: socket,
          document,
          name: `answer:${id.staffAnswer}`,
          awareness: null,
          token: ticket,
        });
        provider.on("close", () => {
          closed = true;
        });
        provider.attach();
        await loading;
        await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
          id.taSession,
        ]);
        resume();
        await until(() => closed);
        expect(provider.isSynced).toBe(false);
        expect(document.getText("content").toString()).toBe("");
      } finally {
        resume?.();
        provider?.destroy();
        socket?.destroy();
        await node.destroy();
        await pool.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [
          id.taSession,
        ]);
      }
    },
    30_000,
  );

  it("drops a queued content frame after role revocation commits", async () => {
    const applicationName = `collab_queue_${randomUUID()}`;
    const concurrentPool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
      application_name: applicationName,
    });
    const concurrentStore = new CollaborationStore(concurrentPool);
    const gate = await concurrentPool.connect();
    let gateOpen = false;
    let terminated = false;
    const sent: Uint8Array[] = [];
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
    const name = `answer:${id.staffAnswer}`;
    const adapter = new AuthorizedEgress(socket, concurrentStore, () => true);
    try {
      const document = await store.load("answer", id.staffAnswer);
      adapter.acceptInbound(
        new OutgoingMessage(name).writeAuthenticated(false).toUint8Array(),
      );
      adapter.bind(name, {
        kind: "answer",
        documentId: id.staffAnswer,
        userId: id.ta,
        sessionId: id.taSession,
      });
      await gate.query("BEGIN");
      gateOpen = true;
      await gate.query(
        "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
        [id.course, id.ta],
      );
      adapter.transport.send(
        new OutgoingMessage(name)
          .createSyncMessage()
          .writeUpdate(document.state)
          .toUint8Array(),
      );
      await until(async () => {
        const result = await admin.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE application_name=$1 AND wait_event_type='Lock'`,
          [applicationName],
        );
        return Number(result.rows[0].count) === 1;
      });
      expect(sent).toEqual([]);
      await gate.query("COMMIT");
      gateOpen = false;
      await until(() => terminated);
      expect(sent).toEqual([]);
    } finally {
      adapter.close();
      if (gateOpen) await gate.query("ROLLBACK");
      gate.release();
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [id.course, id.ta],
      );
      await concurrentPool.end();
    }
  });

  it("completes a concurrent outbound answer send and REST edit without deadlock", async () => {
    const applicationName = `collab_lock_${randomUUID()}`;
    const concurrentPool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
      application_name: applicationName,
    });
    const concurrentStore = new CollaborationStore(concurrentPool);
    const service = new AnswerService(concurrentPool);
    const gate = await concurrentPool.connect();
    let gateOpen = false;
    try {
      const before = await service.get(id.staffAnswer, id.instructor);
      await gate.query("BEGIN");
      gateOpen = true;
      await gate.query("SELECT id FROM answers WHERE id=$1 FOR UPDATE", [
        id.staffAnswer,
      ]);
      const edit = service
        .edit(
          id.staffAnswer,
          id.instructor,
          `"v${before.version}"`,
          `${before.bodyMarkdown} concurrent REST`,
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      const waiting = async () => {
        const result = await admin.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
             WHERE application_name=$1 AND wait_event_type='Lock'`,
          [applicationName],
        );
        return Number(result.rows[0].count);
      };
      await until(async () => (await waiting()) === 1);
      let sent = false;
      const outbound = concurrentStore
        .sendAuthorized("answer", id.staffAnswer, id.ta, id.taSession, () => {
          sent = true;
        })
        .then(
          () => ({ sent: true }),
          (error: unknown) => ({ error }),
        );
      await until(async () => (await waiting()) === 2);
      await gate.query("COMMIT");
      gateOpen = false;
      const [edited, delivered] = await Promise.all([edit, outbound]);
      expect(edited).not.toHaveProperty("error");
      expect(delivered).not.toHaveProperty("error");
      expect(sent).toBe(true);
      expect(
        (await service.get(id.staffAnswer, id.instructor)).bodyMarkdown,
      ).toBe(`${before.bodyMarkdown} concurrent REST`);
      await pool.query(
        "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
        [id.course, id.ta],
      );
      let revokedSend = false;
      await expect(
        concurrentStore.sendAuthorized(
          "answer",
          id.staffAnswer,
          id.ta,
          id.taSession,
          () => {
            revokedSend = true;
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(revokedSend).toBe(false);
    } finally {
      if (gateOpen) await gate.query("ROLLBACK");
      gate.release();
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [id.course, id.ta],
      );
      await concurrentPool.end();
    }
  }, 30_000);

  it("completes sibling live writes on one question without a post-lock upgrade deadlock", async () => {
    const applicationName = `collab_siblings_${randomUUID()}`;
    const concurrentPool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
      application_name: applicationName,
    });
    const concurrentStore = new CollaborationStore(concurrentPool);
    const gate = await concurrentPool.connect();
    let gateOpen = false;
    try {
      for (const targets of [
        [
          { kind: "answer", id: id.answer },
          { kind: "answer", id: id.staffAnswer },
        ],
        [
          { kind: "answer", id: id.answer },
          { kind: "followup", id: id.followup },
        ],
      ] as const) {
        const initial = await Promise.all(
          targets.map(({ kind, id: targetId }) =>
            concurrentStore.load(kind, targetId),
          ),
        );
        const suffixes = targets.map(() => ` sibling ${randomUUID()}`);
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("SELECT id FROM posts WHERE id=$1 FOR SHARE", [
          id.post,
        ]);
        const edits = targets.map(({ kind, id: targetId }, index) =>
          concurrentStore
            .applyUpdate(
              kind,
              targetId,
              id.instructor,
              id.instructorSession,
              changed(initial[index].state, suffixes[index]),
            )
            .then(
              (value) => ({ value }),
              (error: unknown) => ({ error }),
            ),
        );
        await until(async () => {
          const waiting = await admin.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM pg_stat_activity
             WHERE application_name=$1 AND wait_event_type='Lock'`,
            [applicationName],
          );
          return Number(waiting.rows[0].count) === 2;
        });
        await gate.query("COMMIT");
        gateOpen = false;
        const results = await Promise.all(edits);
        for (const result of results)
          expect(result).not.toHaveProperty("error");
        for (const [index, target] of targets.entries()) {
          const current = await concurrentStore.load(target.kind, target.id);
          expect(current.text).toBe(initial[index].text + suffixes[index]);
        }
      }
    } finally {
      if (gateOpen) await gate.query("ROLLBACK");
      gate.release();
      await concurrentPool.end();
    }
  }, 30_000);
});
