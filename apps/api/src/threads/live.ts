import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Pool, PoolClient, Notification } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import type { AuthService } from "../auth/service.js";
import { SESSION_COOKIE_NAME } from "../auth/crypto.js";

const PATH = "/api/v1/thread-events";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE = 1024;
const TYPING_INTERVAL_MS = 500;
const SESSION_RECHECK_MS = 30_000;

type Client = {
  id: string;
  sessionId: string;
  socket: WebSocket;
  credential: string;
  userId: string;
  displayName: string;
  courses: Set<string>;
  viewVersion: number;
  viewing?: { courseId: string; conversationId: string };
  lastTypingAt: number;
};

type LiveOptions = {
  server: Server;
  pool: Pool;
  authService: AuthService;
  frontendOrigins: ReadonlySet<string>;
};

function sessionCookie(request: IncomingMessage): string | undefined {
  const raw = request.headers.cookie;
  return raw
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);
}

function send(client: Client, message: object): void {
  if (client.socket.readyState === WebSocket.OPEN)
    client.socket.send(JSON.stringify(message));
}

function reject(socket: Duplex, status: number): void {
  const reason =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : "Service Unavailable";
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

export function createThreadLiveServer({
  server,
  pool,
  authService,
  frontendOrigins,
}: LiveOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const clients = new Set<Client>();
  let listener: PoolClient | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function disconnectClients(): void {
    for (const client of clients)
      client.socket.close(1012, "Live listener reconnecting");
  }

  function scheduleReconnect(): void {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connectListener();
    }, 1000);
    retry.unref();
  }

  async function connectListener(): Promise<void> {
    if (stopped) return;
    try {
      const connection = await pool.connect();
      if (stopped) {
        connection.release();
        return;
      }
      listener = connection;
      connection.on("notification", (notification) => {
        void onNotification(notification).catch(() => {});
      });
      connection.on("error", () => {
        if (listener === connection) listener = undefined;
        disconnectClients();
        connection.release();
        scheduleReconnect();
      });
      await connection.query("LISTEN thread_changes");
      await connection.query("LISTEN thread_typing");
    } catch {
      if (listener) {
        listener.release();
        listener = undefined;
      }
      disconnectClients();
      scheduleReconnect();
    }
  }

  async function current(client: Client): Promise<boolean> {
    try {
      const session = await authService.session(client.credential);
      if (session.id !== client.sessionId || session.user.id !== client.userId)
        throw Error("Session changed");
      return true;
    } catch {
      send(client, { type: "error", code: "authentication_required" });
      client.socket.close(1008, "Session expired");
      return false;
    }
  }

  async function member(client: Client, courseId: string): Promise<boolean> {
    if (!(await current(client))) return false;
    const result = await pool.query(
      "SELECT 1 AS ok FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [courseId, client.userId],
    );
    if (result.rowCount ?? result.rows.length) return true;
    client.courses.delete(courseId);
    client.viewVersion += 1;
    if (client.viewing?.courseId === courseId) client.viewing = undefined;
    send(client, { type: "error", code: "access_revoked", courseId });
    return false;
  }

  async function availableConversation(
    courseId: string,
    conversationId: string,
    requireActive: boolean,
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT c.course_id FROM thread_conversations c
       JOIN thread_boards b ON b.id=c.board_id AND b.course_id=c.course_id
       JOIN courses course ON course.id=c.course_id
       WHERE c.id=$1 AND c.course_id=$2 AND b.deleted_at IS NULL AND ($3::boolean = false OR course.status='active')`,
      [conversationId, courseId, requireActive],
    );
    return Boolean(result.rows.length);
  }

  async function handle(client: Client, raw: Buffer): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!event || typeof event !== "object" || Array.isArray(event))
        throw Error("Invalid event");
    } catch {
      send(client, { type: "error", code: "invalid_event" });
      return;
    }
    if (
      event.type === "subscribe" &&
      typeof event.courseId === "string" &&
      UUID.test(event.courseId)
    ) {
      if (!(await member(client, event.courseId))) return;
      client.courses.add(event.courseId);
      send(client, { type: "subscribed", courseId: event.courseId });
    } else if (
      event.type === "view" &&
      typeof event.courseId === "string" &&
      UUID.test(event.courseId) &&
      typeof event.conversationId === "string" &&
      UUID.test(event.conversationId)
    ) {
      const viewVersion = ++client.viewVersion;
      if (
        !client.courses.has(event.courseId) ||
        !(await member(client, event.courseId)) ||
        !(await availableConversation(
          event.courseId,
          event.conversationId,
          false,
        ))
      ) {
        if (viewVersion === client.viewVersion)
          send(client, { type: "error", code: "not_found" });
        return;
      }
      if (viewVersion !== client.viewVersion) return;
      client.viewing = {
        courseId: event.courseId,
        conversationId: event.conversationId,
      };
      send(client, { type: "viewing", conversationId: event.conversationId });
    } else if (
      event.type === "unview" &&
      typeof event.conversationId === "string" &&
      UUID.test(event.conversationId)
    ) {
      client.viewVersion += 1;
      if (event.conversationId === client.viewing?.conversationId)
        client.viewing = undefined;
    } else if (
      event.type === "typing" &&
      typeof event.active === "boolean" &&
      event.conversationId === client.viewing?.conversationId
    ) {
      const view = client.viewing;
      const viewVersion = client.viewVersion;
      if (
        !view ||
        !(await member(client, view.courseId)) ||
        !(await availableConversation(
          view.courseId,
          view.conversationId,
          true,
        )) ||
        viewVersion !== client.viewVersion ||
        client.viewing !== view
      )
        return;
      if (event.active && Date.now() - client.lastTypingAt < TYPING_INTERVAL_MS)
        return;
      client.lastTypingAt = Date.now();
      await pool.query("SELECT pg_notify('thread_typing', $1)", [
        JSON.stringify({
          courseId: view.courseId,
          conversationId: view.conversationId,
          userId: client.userId,
          displayName: client.displayName,
          active: event.active,
          originSocketId: client.id,
        }),
      ]);
    } else {
      send(client, { type: "error", code: "invalid_event" });
    }
  }

  async function onNotification(notification: Notification): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(notification.payload ?? "") as Record<string, unknown>;
    } catch {
      return;
    }
    if (
      !event ||
      typeof event.courseId !== "string" ||
      !UUID.test(event.courseId)
    )
      return;
    if (notification.channel === "thread_changes") {
      if (
        typeof event.boardId !== "string" ||
        !UUID.test(event.boardId) ||
        !Number.isSafeInteger(event.sequence)
      )
        return;
      await Promise.all(
        [...clients]
          .filter((client) => client.courses.has(event.courseId as string))
          .map(async (client) => {
            if (await member(client, event.courseId as string))
              send(client, {
                type: "changed",
                courseId: event.courseId,
                boardId: event.boardId,
                sequence: event.sequence,
              });
          }),
      );
    } else if (notification.channel === "thread_typing") {
      if (
        typeof event.conversationId !== "string" ||
        !UUID.test(event.conversationId) ||
        typeof event.userId !== "string" ||
        typeof event.displayName !== "string" ||
        typeof event.active !== "boolean"
      )
        return;
      await Promise.all(
        [...clients]
          .filter(
            (client) =>
              client.viewing?.conversationId === event.conversationId &&
              client.viewing?.courseId === event.courseId &&
              client.id !== event.originSocketId,
          )
          .map(async (client) => {
            if (
              (await member(client, event.courseId as string)) &&
              client.viewing?.conversationId === event.conversationId &&
              client.viewing?.courseId === event.courseId
            )
              send(client, {
                type: "typing",
                conversationId: event.conversationId,
                userId: event.userId,
                displayName: event.displayName,
                active: event.active,
              });
          }),
      );
    }
  }

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "", "http://localhost").pathname !== PATH)
      return;
    const origin = request.headers.origin;
    const credential = sessionCookie(request);
    if (!origin || !frontendOrigins.has(origin)) return reject(socket, 403);
    if (!credential) return reject(socket, 401);
    if (!listener) return reject(socket, 503);
    void authService
      .session(credential)
      .then((session) => {
        if (stopped || socket.destroyed) return;
        wss.handleUpgrade(request, socket, head, (webSocket) => {
          const client: Client = {
            id: randomUUID(),
            sessionId: session.id,
            socket: webSocket,
            credential,
            userId: session.user.id,
            displayName: session.user.displayName,
            courses: new Set(),
            viewVersion: 0,
            lastTypingAt: 0,
          };
          clients.add(client);
          webSocket.on("message", (data) => {
            void handle(client, Buffer.from(data.toString())).catch(() =>
              send(client, { type: "error", code: "service_unavailable" }),
            );
          });
          webSocket.on("close", () => {
            clients.delete(client);
          });
        });
      })
      .catch(() => reject(socket, 401));
  };
  server.on("upgrade", upgrade);

  return {
    async start() {
      await connectListener();
      timer = setInterval(() => {
        for (const client of clients) void current(client);
      }, SESSION_RECHECK_MS);
      timer.unref();
    },
    async stop() {
      stopped = true;
      server.off("upgrade", upgrade);
      if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
      for (const client of clients) client.socket.terminate();
      clients.clear();
      if (listener) {
        await listener.query("UNLISTEN *");
        listener.release();
        listener = undefined;
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
