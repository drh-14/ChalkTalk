import { Server, type Document } from "@hocuspocus/server";
import pg, { type Pool, type PoolClient } from "pg";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client";
import { authorized } from "../observability/index.js";
import { readablePost } from "../posts/visibility.js";
import * as Y from "yjs";
import {
  COLLABORATION_EVENTS_CHANNEL,
  CollaborationSessionService,
  documentName,
  hashTicket,
  type CollaborationEvent,
} from "./service.js";
import { acceptsUpdate, whiteboardProjection } from "./whiteboard.js";

export const MAX_DOCUMENT_CHARACTERS = 200_000;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_EGRESS_BYTES = 1024 * 1024;
export const MAX_EGRESS_MESSAGES = 128;
export const AUTHORIZATION_TIMEOUT_MS = 2000;
export const CLOSE_REASONS = {
  ended: "session-ended",
  removed: "access-removed",
  invalid: "invalid-update",
  unavailable: "authorization-unavailable",
} as const;
const DOCUMENT_PATTERN =
  /^collaboration-session:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const COLORS = [
  "#c2410c",
  "#1d4ed8",
  "#047857",
  "#7c3aed",
  "#be123c",
  "#0e7490",
  "#a16207",
  "#4d7c0f",
];

export type ConnectionContext = {
  userId: string;
  authSessionId: string;
  sessionId: string;
  displayName: string;
  color: string;
  /** `read` connections are read-only: their updates are dropped. */
  permission: "read" | "write";
};

export type CollaborationServerOptions = {
  pool: Pool;
  databaseUrl: string;
  frontendOrigins: ReadonlySet<string>;
  port?: number;
  address?: string;
  debounce?: number;
  maxDebounce?: number;
  sweepIntervalMs?: number;
  listenerRetryMs?: number;
  /** Minutes with nobody connected before an active session ends. */
  idleEndMinutes?: number;
  /** Serves /metrics behind this bearer token when set. */
  metricsToken?: string;
};

export const colorFor = (userId: string) => {
  let hash = 0;
  for (const character of userId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
};

const sessionIdOf = (name: string) => DOCUMENT_PATTERN.exec(name)?.[1];

class Rejection extends Error {}

/**
 * Hocuspocus server for live code sessions. PostgreSQL is the only store and
 * the only source of authorization; nothing about identity is taken from the
 * client.
 */
export function createCollaborationServer(options: CollaborationServerOptions) {
  const { pool } = options;
  const metrics = createMetrics(() => server.hocuspocus.documents);
  const persisting = new Map<string, Promise<void>>();
  let listener: pg.Client | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  /** Rechecks current parent audience before any inbound or outbound content. */
  async function stillAuthorized(
    context: ConnectionContext,
    writable = true,
    db: Pool | PoolClient = pool,
    lock = false,
  ): Promise<boolean> {
    const result = await db.query<{
      audience: string;
      audience_group_id: string | null;
      post_id: string;
      course_id: string;
      role: string;
      created_by_user_id: string;
      author_user_id: string | null;
    }>(
      `SELECT p.audience,p.audience_group_id,p.id AS post_id,s.course_id,m.role,s.created_by_user_id,p.author_user_id
       FROM collaboration_sessions s
       JOIN courses c ON c.id=s.course_id ${writable ? "AND c.status='active'" : ""}
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2
       JOIN sessions a ON a.id=$3 AND a.user_id=$2 AND a.revoked_at IS NULL AND a.expires_at>now()
       JOIN users u ON u.id=$2 AND u.deleted_at IS NULL
       JOIN posts p ON p.id=s.post_id
       WHERE s.id=$1 ${writable ? "AND s.lifecycle_state='active'" : ""}
         AND p.deleted_at IS NULL AND p.duplicate_status<>'confirmed'
         AND ${readablePost("p", "$2")}
         AND (m.role IN ('ta','instructor') OR (
           s.created_by_user_id=$2 OR EXISTS (
               SELECT 1 FROM collaboration_participants cp
               WHERE cp.collaboration_session_id=s.id AND cp.user_id=$2)))
       ${lock ? "FOR SHARE OF s,c,m,a,u,p" : ""}`,
      [context.sessionId, context.userId, context.authSessionId],
    );
    const row = result.rows[0];
    if (!row) return false;
    if (!lock) return true;
    if (row.audience === "group") {
      const group = await db.query(
        "SELECT 1 FROM private_post_group_members WHERE group_id=$1 AND course_id=$2 AND user_id=$3 FOR SHARE",
        [row.audience_group_id, row.course_id, context.userId],
      );
      if (!group.rowCount) return false;
    }
    if (
      row.audience === "selected_staff" &&
      row.author_user_id !== context.userId
    ) {
      const recipient = await db.query(
        "SELECT 1 FROM post_staff_recipients WHERE post_id=$1 AND user_id=$2 FOR SHARE",
        [row.post_id, context.userId],
      );
      if (!recipient.rowCount) return false;
    }
    if (
      row.role !== "ta" &&
      row.role !== "instructor" &&
      row.created_by_user_id !== context.userId
    ) {
      const participant = await db.query(
        "SELECT 1 FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2 FOR SHARE",
        [context.sessionId, context.userId],
      );
      if (!participant.rowCount) return false;
    }
    return true;
  }

  async function lockedAuthorization(
    context: ConnectionContext,
    writable: boolean,
  ): Promise<{ client: PoolClient; allowed: boolean }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SET LOCAL statement_timeout = ${AUTHORIZATION_TIMEOUT_MS}`,
      );
      const allowed = await stillAuthorized(context, writable, client, true);
      return { client, allowed };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  async function releaseAuthorization(client: PoolClient) {
    try {
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }

  function authorizedWithinDeadline(
    context: ConnectionContext,
    writable = true,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Authorization timed out")),
        AUTHORIZATION_TIMEOUT_MS,
      );
      stillAuthorized(context, writable).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  type EgressGuard = { bind(context: ConnectionContext, name: string): void };
  const egressByRequest = new WeakMap<Request, EgressGuard>();
  const inboundAuthorization = new Map<string, PoolClient>();

  /** Serializes stores per session so an older state never overwrites a newer one. */
  function persist(sessionId: string, document: Y.Doc): Promise<void> {
    const previous = persisting.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const stopTimer = metrics.storeDuration.startTimer();
        const state = Buffer.from(Y.encodeStateAsUpdate(document));
        const text = document.getText("content").toString();
        const whiteboard = JSON.stringify(whiteboardProjection(document));
        try {
          await pool.query(
            `INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection,whiteboard_projection,persisted_at,persistence_revision)
             VALUES ($1,$2,$3,$4,clock_timestamp(),1)
             ON CONFLICT (collaboration_session_id) DO UPDATE SET yjs_state=excluded.yjs_state,
               text_projection=excluded.text_projection,
               whiteboard_projection=excluded.whiteboard_projection,persisted_at=excluded.persisted_at,
               persistence_revision=collaboration_documents.persistence_revision+1`,
            [sessionId, state, text, whiteboard],
          );
        } catch (error) {
          // A session removed with its post or course has nothing left to store.
          if ((error as { code?: string }).code !== "23503") throw error;
        } finally {
          stopTimer();
        }
      });
    persisting.set(sessionId, next);
    return next;
  }

  function connectionsOf(sessionId: string) {
    return (
      server.hocuspocus.documents
        .get(documentName(sessionId))
        ?.getConnections() ?? []
    );
  }

  function close(
    connection: { close(event: { code: number; reason: string }): void },
    reason: string,
  ) {
    metrics.closes.inc({ reason });
    connection.close({ code: 1000, reason });
  }

  function closeAll(document: Document, reason: string) {
    for (const connection of document.getConnections())
      close(connection, reason);
  }

  async function finishSession(sessionId: string, markEnded: boolean) {
    const document = server.hocuspocus.documents.get(documentName(sessionId));
    if (document) await persist(sessionId, document);
    if (markEnded)
      await pool.query(
        "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle_state='ending'",
        [sessionId],
      );
    if (document) {
      document.broadcastStateless(JSON.stringify({ type: "session-ended" }));
      closeAll(document, CLOSE_REASONS.ended);
    }
  }

  async function recheck(filter: (context: ConnectionContext) => boolean) {
    for (const document of server.hocuspocus.documents.values())
      for (const connection of document.getConnections()) {
        const context = connection.context as ConnectionContext;
        if (!context?.userId || !filter(context)) continue;
        if (await stillAuthorized(context)) continue;
        const state = await pool.query<{ lifecycle_state: string }>(
          "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1",
          [context.sessionId],
        );
        close(
          connection,
          state.rows[0]?.lifecycle_state === "active"
            ? CLOSE_REASONS.removed
            : CLOSE_REASONS.ended,
        );
      }
  }

  async function handleEvent(event: CollaborationEvent) {
    if (event.type === "session_updated") {
      server.hocuspocus.documents
        .get(documentName(event.sessionId))
        ?.broadcastStateless(JSON.stringify({ type: "session-updated" }));
      return;
    }
    if (event.type === "session_ending")
      return finishSession(event.sessionId, true);
    if (event.type === "session_ended")
      return finishSession(event.sessionId, false);
    const users = new Set(event.userIds);
    await recheck(
      (context) =>
        users.has(context.userId) &&
        (!event.sessionId || context.sessionId === event.sessionId),
    );
  }

  /** Records that these sessions have someone connected right now. */
  async function touch(sessionIds: string[]) {
    if (!sessionIds.length) return;
    await pool.query(
      "UPDATE collaboration_sessions SET last_active_at=now() WHERE id = ANY($1::uuid[]) AND lifecycle_state='active'",
      [sessionIds],
    );
  }

  function connectedSessions() {
    const ids: string[] = [];
    for (const [name, document] of server.hocuspocus.documents) {
      const id = sessionIdOf(name);
      if (id && document.getConnectionsCount() > 0) ids.push(id);
    }
    return ids;
  }

  /**
   * Ends sessions nobody has been connected to for the idle period, through
   * the same event as lifecycle-driven ends. Sessions with a connection on
   * this server are never ended, however quiet they are.
   */
  async function endIdle() {
    const connected = connectedSessions();
    await touch(connected);
    const ended = await pool.query<{ id: string }>(
      `UPDATE collaboration_sessions
       SET lifecycle_state='ended',ended_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
       WHERE lifecycle_state='active'
         AND last_active_at < now() - make_interval(mins => $1)
         AND NOT (id = ANY($2::uuid[]))
       RETURNING id`,
      [options.idleEndMinutes ?? 120, connected],
    );
    metrics.sessionsEnded.inc({ reason: "idle" }, ended.rowCount ?? 0);
    for (const row of ended.rows)
      await CollaborationSessionService.notify(pool, {
        type: "session_ended",
        sessionId: row.id,
      });
    return ended.rows.map((row) => row.id);
  }

  async function sweep() {
    await recheck(() => true);
    await endIdle();
  }

  async function startListener() {
    if (stopped) return;
    const client = new pg.Client({ connectionString: options.databaseUrl });
    const retry = () => {
      if (stopped || listener !== client) return;
      listener = undefined;
      void client.end().catch(() => undefined);
      retryTimer = setTimeout(
        () => void startListener(),
        options.listenerRetryMs ?? 1000,
      );
    };
    client.on("error", retry);
    client.on("end", retry);
    client.on("notification", (message) => {
      if (message.channel !== COLLABORATION_EVENTS_CHANNEL || !message.payload)
        return;
      let event: CollaborationEvent;
      try {
        event = JSON.parse(message.payload);
      } catch {
        return;
      }
      void handleEvent(event).catch(() => undefined);
    });
    try {
      listener = client;
      await client.connect();
      await client.query(`LISTEN ${COLLABORATION_EVENTS_CHANNEL}`);
      // Anything missed while disconnected is caught by an immediate sweep.
      await sweep();
    } catch {
      retry();
    }
  }

  const server = new Server<ConnectionContext>({
    port: options.port ?? 3100,
    address: options.address,
    quiet: true,
    stopOnSignals: false,
    debounce: options.debounce ?? 2000,
    maxDebounce: options.maxDebounce ?? 5000,
    websocketOptions: { maxPayload: MAX_MESSAGE_BYTES },

    async onRequest({ request, response }) {
      if (!options.metricsToken || request.url?.split("?")[0] !== "/metrics")
        return;
      if (!authorized(request.headers.authorization, options.metricsToken)) {
        response.writeHead(401, { "Content-Type": "text/plain" });
        response.end("Unauthorized");
      } else {
        response.writeHead(200, {
          "Content-Type": metrics.registry.contentType,
        });
        response.end(await metrics.registry.metrics());
      }
      // An empty rejection tells Hocuspocus the request was answered.
      return Promise.reject();
    },

    async onConnect({ requestHeaders, documentName: name }) {
      const origin = requestHeaders.get("origin");
      if (!origin || !options.frontendOrigins.has(origin))
        throw new Rejection("Origin is not allowed");
      if (!sessionIdOf(name)) throw new Rejection("Unknown document");
    },

    async onAuthenticate({
      token,
      documentName: name,
      connectionConfig,
      request,
    }) {
      const sessionId = sessionIdOf(name);
      if (!sessionId || typeof token !== "string" || !token)
        throw new Rejection("Not authorized");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const consumed = await client.query<{
          user_id: string;
          auth_session_id: string;
          collaboration_session_id: string;
          permission: "read" | "write";
        }>(
          "UPDATE collaboration_connection_tickets SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING user_id,auth_session_id,collaboration_session_id,permission",
          [hashTicket(token)],
        );
        const ticket = consumed.rows[0];
        if (!ticket || ticket.collaboration_session_id !== sessionId)
          throw new Rejection("Not authorized");
        const user = await client.query<{ display_name: string }>(
          "SELECT display_name FROM users WHERE id=$1",
          [ticket.user_id],
        );
        const context: ConnectionContext = {
          userId: ticket.user_id,
          authSessionId: ticket.auth_session_id,
          sessionId,
          displayName: user.rows[0]?.display_name ?? "Participant",
          color: colorFor(ticket.user_id),
          permission: ticket.permission,
        };
        // Hocuspocus neither applies nor broadcasts a read-only connection's updates.
        connectionConfig.readOnly = ticket.permission === "read";
        if (!(await authorizedWithinDeadline(context)))
          throw new Rejection("Not authorized");
        egressByRequest.get(request)?.bind(context, name);
        await client.query(
          "UPDATE collaboration_sessions SET last_active_at=now() WHERE id=$1",
          [sessionId],
        );
        await client.query("COMMIT");
        return context;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async onLoadDocument({ document, documentName: name }) {
      const sessionId = sessionIdOf(name)!;
      const saved = await pool.query<{ yjs_state: Buffer }>(
        "SELECT yjs_state FROM collaboration_documents WHERE collaboration_session_id=$1",
        [sessionId],
      );
      if (saved.rows[0])
        Y.applyUpdate(document, new Uint8Array(saved.rows[0].yjs_state));
      return document;
    },

    async onDisconnect({ documentName: name, clientsCount }) {
      // The idle period starts when the last participant leaves.
      const sessionId = sessionIdOf(name);
      if (sessionId && clientsCount === 0) await touch([sessionId]);
    },

    async onStoreDocument({ document, documentName: name }) {
      await persist(sessionIdOf(name)!, document);
    },

    async beforeHandleMessage({ context, connection, socketId }) {
      let reason: string = CLOSE_REASONS.removed;
      try {
        if (context?.userId) {
          const authorization = await lockedAuthorization(context, true);
          if (authorization.allowed) {
            inboundAuthorization.set(socketId, authorization.client);
            return;
          }
          await releaseAuthorization(authorization.client);
        }
        if (context?.userId && (await authorizedWithinDeadline(context, false)))
          reason = CLOSE_REASONS.ended;
      } catch {
        reason = CLOSE_REASONS.unavailable;
      }
      close(connection, reason);
      throw Object.assign(new Rejection("Not authorized"), {
        code: 1000,
        reason,
      });
    },

    async afterHandleMessage({ socketId }) {
      const client = inboundAuthorization.get(socketId);
      if (!client) return;
      inboundAuthorization.delete(socketId);
      await releaseAuthorization(client);
    },

    async beforeSync({ type, payload, document, connection }) {
      // SyncStep2 (1) and Update (2) carry document changes.
      if (type !== 1 && type !== 2) return;
      // A viewer's updates are dropped unapplied, so they are not validated.
      if (
        (connection.context as ConnectionContext | undefined)?.permission ===
        "read"
      )
        return;
      if (!acceptsUpdate(document, payload, MAX_DOCUMENT_CHARACTERS)) {
        metrics.rejectedUpdates.inc();
        close(connection, CLOSE_REASONS.invalid);
        throw new Rejection("Invalid update");
      }
    },

    async connected({ connection, context }) {
      // Awareness relays the server-stamped identity only to other clients,
      // so each client learns its own name and color here.
      connection.sendStateless(
        JSON.stringify({
          type: "presence",
          user: {
            userId: context.userId,
            name: context.displayName,
            color: context.color,
          },
        }),
      );
    },

    async beforeHandleAwareness({ states, context }) {
      if (!context) return;
      for (const state of states.values())
        state.user = {
          userId: context.userId,
          name: context.displayName,
          color: context.color,
        };
    },
  });

  // Guard every outbound frame, not merely connection setup or periodic
  // sweeps. A revoked member must never receive queued document updates.
  const handleConnection = server.hocuspocus.handleConnection.bind(
    server.hocuspocus,
  );
  server.hocuspocus.handleConnection = (socket, request, defaultContext) => {
    const send = socket.send.bind(socket);
    let context: ConnectionContext | undefined;
    let boundName: string | undefined;
    let closed = false;
    let queuedBytes = 0;
    const queue: Uint8Array[] = [];
    const bufferedBytes = () => {
      const value = (socket as { bufferedAmount?: number }).bufferedAmount;
      return value === undefined
        ? 0
        : Number.isFinite(value) && value >= 0
          ? value
          : Infinity;
    };
    let draining = false;
    const closeSocket = (reason: string) => {
      if (closed) return;
      closed = true;
      queue.length = 0;
      queuedBytes = 0;
      socket.close(1000, reason);
    };
    const drain = async () => {
      if (draining || closed) return;
      draining = true;
      try {
        while (queue.length && !closed) {
          const data = queue[0]!;
          if (!context) {
            closeSocket(CLOSE_REASONS.removed);
            return;
          }
          const authorization = await lockedAuthorization(context, false);
          try {
            if (!authorization.allowed) {
              closeSocket(CLOSE_REASONS.removed);
              return;
            }
            if (closed || socket.readyState !== 1) return;
            if (bufferedBytes() + data.byteLength + 14 > MAX_EGRESS_BYTES) {
              closeSocket(CLOSE_REASONS.unavailable);
              return;
            }
            send(data);
            queue.shift();
            queuedBytes -= data.byteLength;
          } finally {
            await releaseAuthorization(authorization.client);
          }
        }
      } catch {
        closeSocket(CLOSE_REASONS.unavailable);
      } finally {
        draining = false;
      }
    };
    egressByRequest.set(request, {
      bind(next, name) {
        if (
          name !== documentName(next.sessionId) ||
          (boundName !== undefined &&
            (boundName !== name ||
              context?.userId !== next.userId ||
              context?.authSessionId !== next.authSessionId))
        )
          throw new Rejection(
            "Socket is bound to another document or identity",
          );
        context = next;
        boundName = name;
      },
    });
    socket.send = (data) => {
      if (closed) return;
      if (!context) {
        send(data);
        return;
      }
      const binary =
        typeof data === "string"
          ? new TextEncoder().encode(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : undefined;
      if (
        !binary ||
        queue.length >= MAX_EGRESS_MESSAGES ||
        bufferedBytes() + queuedBytes + binary.byteLength + 14 >
          MAX_EGRESS_BYTES
      ) {
        closeSocket(CLOSE_REASONS.unavailable);
        return;
      }
      queue.push(binary.slice());
      queuedBytes += binary.byteLength;
      void drain();
    };
    return handleConnection(socket, request, defaultContext);
  };

  return {
    server,
    get hocuspocus() {
      return server.hocuspocus;
    },
    connectionsOf,
    sweep,
    endIdle,
    persist,
    async start() {
      stopped = false;
      await server.listen();
      await startListener();
      sweepTimer = setInterval(
        () => void sweep().catch(() => undefined),
        options.sweepIntervalMs ?? 15_000,
      );
    },
    /** Drops the LISTEN connection, as if the database link failed. */
    async dropListener() {
      await listener?.end();
    },
    async stop() {
      stopped = true;
      if (sweepTimer) clearInterval(sweepTimer);
      if (retryTimer) clearTimeout(retryTimer);
      const current = listener;
      listener = undefined;
      await current?.end().catch(() => undefined);
      server.hocuspocus.flushPendingStores();
      await Promise.allSettled([...persisting.values()]);
      await server.destroy();
      await Promise.allSettled([...persisting.values()]);
    },
  };
}

/** Prometheus series for live sessions; none carry user, session, or course ids. */
function createMetrics(documents: () => Map<string, Document>) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  new Gauge({
    name: "chalktalk_collaboration_connections",
    help: "Clients connected to live sessions",
    registers: [registry],
    collect() {
      let count = 0;
      for (const document of documents().values())
        count += document.getConnectionsCount();
      this.set(count);
    },
  });
  new Gauge({
    name: "chalktalk_collaboration_documents",
    help: "Live session documents loaded in memory",
    registers: [registry],
    collect() {
      this.set(documents().size);
    },
  });
  return {
    registry,
    storeDuration: new Histogram({
      name: "chalktalk_collaboration_store_duration_seconds",
      help: "Time to persist a live session document",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    rejectedUpdates: new Counter({
      name: "chalktalk_collaboration_rejected_updates_total",
      help: "Document updates rejected by validation",
      registers: [registry],
    }),
    closes: new Counter({
      name: "chalktalk_collaboration_closes_total",
      help: "Connections closed by the server, by close reason",
      labelNames: ["reason"] as const,
      registers: [registry],
    }),
    sessionsEnded: new Counter({
      name: "chalktalk_collaboration_sessions_ended_total",
      help: "Live sessions ended by the collaboration server, by reason",
      labelNames: ["reason"] as const,
      registers: [registry],
    }),
  };
}
