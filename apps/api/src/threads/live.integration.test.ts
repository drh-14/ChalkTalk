import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AuthService } from "../auth/service.js";
import { createThreadLiveServer } from "./live.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Thread live WebSocket with PostgreSQL", () => {
  it("relays committed changes to subscribers and typing only to current conversation viewers", async () => {
    const schema = `thread_live_${process.pid}_${Date.now()}`;
    const courseId = uuidv7();
    const boardId = uuidv7();
    const firstConversationId = uuidv7();
    const secondConversationId = uuidv7();
    const users = [uuidv7(), uuidv7(), uuidv7()];
    const admin = new Pool({ connectionString: databaseUrl });
    let pool: Pool | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    let live: ReturnType<typeof createThreadLiveServer> | undefined;
    const sockets: WebSocket[] = [];
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `--search_path="${schema}"`,
      });
      await pool.query(`CREATE TABLE courses (id uuid PRIMARY KEY,status text NOT NULL);
        CREATE TABLE course_memberships (course_id uuid,user_id uuid,PRIMARY KEY(course_id,user_id));
        CREATE TABLE thread_boards (id uuid PRIMARY KEY,course_id uuid,deleted_at timestamptz);
        CREATE TABLE thread_conversations (id uuid PRIMARY KEY,board_id uuid,course_id uuid);`);
      await pool.query("INSERT INTO courses VALUES ($1,'active')", [courseId]);
      await pool.query(
        "INSERT INTO thread_boards(id,course_id) VALUES ($1,$2)",
        [boardId, courseId],
      );
      await pool.query(
        "INSERT INTO thread_conversations(id,board_id,course_id) VALUES ($1,$3,$4),($2,$3,$4)",
        [firstConversationId, secondConversationId, boardId, courseId],
      );
      for (const userId of users)
        await pool.query("INSERT INTO course_memberships VALUES ($1,$2)", [
          courseId,
          userId,
        ]);

      const auth = {
        session: async (credential: string) => {
          const index = Number(credential);
          if (!Number.isInteger(index) || index < 0 || index > 2)
            throw Error("unauthorized");
          return {
            id: `session-${index}`,
            user: {
              id: users[index],
              displayName: ["Alice", "Bob", "Carol"][index],
            },
          };
        },
      } as unknown as AuthService;
      server = createServer((_request, response) => response.end());
      live = createThreadLiveServer({
        server,
        pool,
        authService: auth,
        frontendOrigins: new Set(["https://app.example.edu"]),
      });
      await live.start();
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      for (let index = 0; index < 3; index++) {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/api/v1/thread-events`,
          {
            headers: {
              Origin: "https://app.example.edu",
              Cookie: `__Host-chalktalk_session=${index}`,
            },
          },
        );
        sockets.push(socket);
        await once(socket, "open");
        socket.send(JSON.stringify({ type: "subscribe", courseId }));
        expect(
          JSON.parse((await once(socket, "message"))[0].toString()),
        ).toEqual({ type: "subscribed", courseId });
        socket.send(
          JSON.stringify({
            type: "view",
            courseId,
            conversationId:
              index === 2 ? secondConversationId : firstConversationId,
          }),
        );
        expect(
          JSON.parse((await once(socket, "message"))[0].toString()).type,
        ).toBe("viewing");
      }

      const changes = sockets.map((socket) => once(socket, "message"));
      await pool.query("SELECT pg_notify('thread_changes',$1)", [
        JSON.stringify({ courseId, boardId, sequence: 7 }),
      ]);
      for (const pending of changes)
        expect(JSON.parse((await pending)[0].toString())).toEqual({
          type: "changed",
          courseId,
          boardId,
          sequence: 7,
        });

      const bobTyping = once(sockets[1]!, "message");
      const carolEvents: unknown[] = [];
      sockets[2]!.on("message", (data) =>
        carolEvents.push(JSON.parse(data.toString())),
      );
      sockets[0]!.send(
        JSON.stringify({
          type: "typing",
          conversationId: firstConversationId,
          active: true,
        }),
      );
      expect(JSON.parse((await bobTyping)[0].toString())).toEqual({
        type: "typing",
        conversationId: firstConversationId,
        userId: users[0],
        displayName: "Alice",
        active: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(carolEvents).toEqual([]);
    } finally {
      for (const socket of sockets) socket.terminate();
      await live?.stop();
      if (server?.listening)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  }, 30000);
});
