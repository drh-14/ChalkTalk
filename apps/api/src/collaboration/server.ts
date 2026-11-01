import { Hocuspocus, type Document } from "@hocuspocus/server";
import pg, { type Pool, type PoolClient } from "pg";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client";
import { authorized } from "../observability/index.js";
import * as Y from "yjs";
import {
  COLLABORATION_EVENTS_CHANNEL,
  CollaborationSessionService,
  documentName,
  hashTicket,
  type CollaborationEvent,
} from "./service.js";
import { acceptsUpdate, whiteboardProjection } from "./whiteboard.js";
import { createCollaborationTransport } from "./transport.js";

export const MAX_DOCUMENT_CHARACTERS = 200_000;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const CLOSE_REASONS = {
  ended: "session-ended",
  removed: "access-removed",
  invalid: "invalid-update",
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
  admissionTimeoutMs?: number;
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

async function boundedQuery<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Pool | PoolClient,
  text: string,
  values: unknown[] = [],
  timeout = 2000,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      db.query<Row>({ text, values, query_timeout: timeout } as pg.QueryConfig),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database query timed out")),
          timeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Hocuspocus server for live code sessions. PostgreSQL is the only store and
 * the only source of authorization; nothing about identity is taken from the
 * client.
 */
export function createCollaborationServer(options: CollaborationServerOptions) {
  const { pool } = options;
  const metrics = createMetrics(() => server.hocuspocus.documents);
  const persisting = new Map<string, Promise<void>>();
  const failedStores = new Set<string>();
  const admissions = new Map<
    Request,
    {
      client: PoolClient;
      phase: "active" | "committing" | "finished";
      socketId: string;
    }
  >();
  const admissionSockets = new Map<string, Request>();
  const aborting = new Set<Promise<void>>();
  let listener: pg.Client | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  /** Rechecks current membership, participation, and ticket permission. */
  async function stillAuthorized(context: ConnectionContext): Promise<boolean> {
    try {
      const result = await boundedQuery(
        pool,
        `SELECT 1
       FROM collaboration_sessions s
       JOIN courses c ON c.id=s.course_id AND c.status='active'
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2
       JOIN sessions a ON a.id=$3 AND a.user_id=$2 AND a.revoked_at IS NULL AND a.expires_at>now()
       JOIN users u ON u.id=$2 AND u.deleted_at IS NULL
       JOIN collaboration_participants cp ON cp.collaboration_session_id=s.id AND cp.user_id=$2
       WHERE s.id=$1 AND s.lifecycle_state='active'
         AND ($4='read' OR cp.permission='edit')`,
        [
          context.sessionId,
          context.userId,
          context.authSessionId,
          context.permission,
        ],
      );
      return Boolean(result.rowCount);
    } catch {
      return false;
    }
  }

  async function abortAdmission(request: Request) {
    const lease = admissions.get(request);
    if (!lease || lease.phase !== "active") return;
    lease.phase = "finished";
    admissions.delete(request);
    admissionSockets.delete(lease.socketId);
    try {
      await boundedQuery(lease.client, "ROLLBACK", [], 1000);
      lease.client.release();
    } catch {
      lease.client.release(true);
    }
  }

  /** Serializes stores per session so an older state never overwrites a newer one. */
  function persist(
    sessionId: string,
    document: Y.Doc,
    finalize = false,
  ): Promise<void> {
    const previous = persisting.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const stopTimer = metrics.storeDuration.startTimer();
        const state = Buffer.from(Y.encodeStateAsUpdate(document));
        const text = document.getText("content").toString();
        const whiteboard = JSON.stringify(whiteboardProjection(document));
        try {
          const store = async (db: Pick<Pool, "query">) =>
            db.query(
              `INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection,whiteboard_projection,persisted_at,persistence_revision)
             VALUES ($1,$2,$3,$4,clock_timestamp(),1)
             ON CONFLICT (collaboration_session_id) DO UPDATE SET yjs_state=excluded.yjs_state,
               text_projection=excluded.text_projection,
               whiteboard_projection=excluded.whiteboard_projection,persisted_at=excluded.persisted_at,
               persistence_revision=collaboration_documents.persistence_revision+1`,
              [sessionId, state, text, whiteboard],
            );
          if (finalize) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const row = await client.query<{
                lifecycle_state: string;
                final_snapshot_confirmed: boolean;
              }>(
                "SELECT lifecycle_state,final_snapshot_confirmed FROM collaboration_sessions WHERE id=$1 FOR UPDATE",
                [sessionId],
              );
              if (
                row.rows[0] &&
                !row.rows[0].final_snapshot_confirmed &&
                (row.rows[0].lifecycle_state === "ending" ||
                  row.rows[0].lifecycle_state === "ended")
              ) {
                await store(client);
                if (row.rows[0].lifecycle_state === "ending")
                  await client.query(
                    "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),final_snapshot_confirmed=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
                    [sessionId],
                  );
              }
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          } else {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const row = await client.query<{
                lifecycle_state: string;
              }>(
                "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1 FOR UPDATE",
                [sessionId],
              );
              if (row.rows[0] && row.rows[0].lifecycle_state !== "ended")
                await store(client);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          }
          failedStores.delete(sessionId);
        } catch (error) {
          // A session removed with its post or course has nothing left to store.
          if ((error as { code?: string }).code !== "23503") {
            failedStores.add(sessionId);
            throw error;
          }
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
    connection: {
      request: Request;
      close(event: { code: number; reason: string }): void;
    },
    reason: string,
  ) {
    metrics.closes.inc({ reason });
    connection.close({ code: 1000, reason });
    server.socketFor(connection.request)?.close(1000, reason);
  }

  function closeAll(document: Document, reason: string) {
    for (const connection of document.getConnections())
      close(connection, reason);
  }

  async function finishSession(sessionId: string, markEnded: boolean) {
    const document = server.hocuspocus.documents.get(documentName(sessionId));
    try {
      if (document) await persist(sessionId, document, true);
      if (markEnded && !document)
        await pool.query(
          "UPDATE collaboration_sessions SET lifecycle_state='ended',ended_at=clock_timestamp(),final_snapshot_confirmed=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle_state='ending'",
          [sessionId],
        );
    } finally {
      // A failed store must not leave editors connected to an ending session.
      // The API's timeout fallback keeps its snapshot explicitly unconfirmed.
      if (document) {
        document.broadcastStateless(JSON.stringify({ type: "session-ended" }));
        closeAll(document, CLOSE_REASONS.ended);
      }
    }
  }

  async function recheck(filter: (context: ConnectionContext) => boolean) {
    for (const document of server.hocuspocus.documents.values())
      for (const connection of document.getConnections()) {
        const context = connection.context as ConnectionContext;
        if (!context?.userId || !filter(context)) continue;
        if (await stillAuthorized(context)) continue;
        const state = await boundedQuery<{ lifecycle_state: string }>(
          pool,
          "SELECT lifecycle_state FROM collaboration_sessions WHERE id=$1",
          [context.sessionId],
        ).catch(() => undefined);
        close(
          connection,
          state?.rows[0]?.lifecycle_state === "active"
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
       SET lifecycle_state='ended',ended_at=clock_timestamp(),final_snapshot_confirmed=false,version=version+1,updated_at=clock_timestamp()
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
    for (const sessionId of failedStores) {
      const document = server.hocuspocus.documents.get(documentName(sessionId));
      if (!document) {
        failedStores.delete(sessionId);
        continue;
      }
      try {
        await persist(sessionId, document);
        if (document.getConnectionsCount() === 0)
          await server.hocuspocus.unloadDocument(document);
      } catch {
        // Keep the in-memory document and retry at the next sweep.
      }
    }
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

  const hocuspocus = new Hocuspocus<ConnectionContext>({
    quiet: true,
    debounce: options.debounce ?? 2000,
    maxDebounce: options.maxDebounce ?? 5000,

    async onConnect({ requestHeaders, documentName: name, request }) {
      const origin = requestHeaders.get("origin");
      if (!origin || !options.frontendOrigins.has(origin)) {
        server.socketFor(request)?.reject("Origin is not allowed");
        throw new Rejection("Origin is not allowed");
      }
      if (!sessionIdOf(name)) {
        server.socketFor(request)?.reject("Unknown document");
        throw new Rejection("Unknown document");
      }
    },

    async onAuthenticate({
      token,
      documentName: name,
      connectionConfig,
      request,
      socketId,
    }) {
      const sessionId = sessionIdOf(name);
      if (!sessionId || typeof token !== "string" || !token) {
        server.socketFor(request)?.reject("Not authorized");
        throw new Rejection("Not authorized");
      }
      const socket = server.socketFor(request);
      if (!socket || socket.readyState !== 1)
        throw new Rejection("Not authorized");
      const client = await pool.connect().catch((error) => {
        socket.reject("Not authorized");
        throw error;
      });
      try {
        if (socket.readyState !== 1) throw new Rejection("Not authorized");
        await boundedQuery(client, "BEGIN");
        const pending = await boundedQuery<{
          user_id: string;
          auth_session_id: string;
          collaboration_session_id: string;
          permission: "read" | "write";
        }>(
          client,
          "SELECT user_id,auth_session_id,collaboration_session_id,permission FROM collaboration_connection_tickets WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
          [hashTicket(token)],
        );
        const ticket = pending.rows[0];
        if (!ticket || ticket.collaboration_session_id !== sessionId)
          throw new Rejection("Not authorized");
        const session = await boundedQuery<{
          course_id: string;
          lifecycle_state: string;
        }>(
          client,
          "SELECT course_id,lifecycle_state FROM collaboration_sessions WHERE id=$1 FOR SHARE",
          [sessionId],
        );
        if (session.rows[0]?.lifecycle_state !== "active")
          throw new Rejection("Not authorized");
        const courseId = session.rows[0].course_id;
        const course = await boundedQuery<{ status: string }>(
          client,
          "SELECT status FROM courses WHERE id=$1",
          [courseId],
        );
        if (course.rows[0]?.status !== "active")
          throw new Rejection("Not authorized");
        const membership = await boundedQuery(
          client,
          "SELECT 1 FROM course_memberships WHERE course_id=$1 AND user_id=$2 FOR SHARE",
          [courseId, ticket.user_id],
        );
        if (!membership.rowCount) throw new Rejection("Not authorized");
        const participant = await boundedQuery<{ permission: string }>(
          client,
          "SELECT permission FROM collaboration_participants WHERE collaboration_session_id=$1 AND user_id=$2 FOR SHARE",
          [sessionId, ticket.user_id],
        );
        if (
          !participant.rowCount ||
          (ticket.permission === "write" &&
            participant.rows[0]?.permission !== "edit")
        )
          throw new Rejection("Not authorized");
        const authSession = await boundedQuery(
          client,
          "SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR SHARE",
          [ticket.auth_session_id, ticket.user_id],
        );
        if (!authSession.rowCount) throw new Rejection("Not authorized");
        const user = await boundedQuery<{ display_name: string }>(
          client,
          "SELECT display_name FROM users WHERE id=$1 AND deleted_at IS NULL",
          [ticket.user_id],
        );
        if (!user.rowCount) throw new Rejection("Not authorized");
        const consumed = await boundedQuery(
          client,
          "UPDATE collaboration_connection_tickets SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
          [hashTicket(token)],
        );
        if (!consumed.rowCount || socket.readyState !== 1)
          throw new Rejection("Not authorized");
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
        if (socket.readyState !== 1) throw new Rejection("Not authorized");
        admissions.set(request, { client, phase: "active", socketId });
        admissionSockets.set(socketId, request);
        return context;
      } catch (error) {
        socket.reject("Not authorized");
        try {
          await boundedQuery(client, "ROLLBACK", [], 1000);
          client.release();
        } catch {
          client.release(true);
        }
        throw error;
      }
    },

    async onLoadDocument({ document, documentName: name, socketId }) {
      const sessionId = sessionIdOf(name)!;
      let saved;
      try {
        saved = await boundedQuery<{ yjs_state: Buffer }>(
          pool,
          "SELECT yjs_state FROM collaboration_documents WHERE collaboration_session_id=$1",
          [sessionId],
        );
      } catch (error) {
        const request = admissionSockets.get(socketId);
        if (request) server.socketFor(request)?.abort();
        throw error;
      }
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

    async beforeHandleMessage({ context, connection }) {
      if (
        admissions.has(connection.request) ||
        !context?.userId ||
        !(await stillAuthorized(context))
      ) {
        close(connection, CLOSE_REASONS.removed);
        throw new Rejection("Not authorized");
      }
    },

    async beforeSync({ type, payload, document, connection }) {
      const context = connection.context as ConnectionContext;
      // SyncStep2 (1) and Update (2) carry document changes.
      if (type !== 1 && type !== 2) return;
      // A viewer's updates are dropped unapplied, so they are not validated.
      if (context.permission === "read") return;
      if (!acceptsUpdate(document, payload, MAX_DOCUMENT_CHARACTERS)) {
        metrics.rejectedUpdates.inc();
        close(connection, CLOSE_REASONS.invalid);
        throw new Rejection("Invalid update");
      }
    },

    async connected({ connection, context, request, socketId }) {
      const lease = admissions.get(request);
      const socket = server.socketFor(request);
      if (
        !lease ||
        lease.phase !== "active" ||
        !socket ||
        socket.readyState !== 1
      ) {
        socket?.abort();
        throw new Rejection("Not authorized");
      }
      lease.phase = "committing";
      try {
        await boundedQuery(lease.client, "COMMIT");
        lease.client.release();
        lease.phase = "finished";
        admissions.delete(request);
        admissionSockets.delete(socketId);
        if (!socket.confirm()) throw new Rejection("Not authorized");
        socket.finish();
      } catch (error) {
        socket.abort();
        if (lease.phase !== "finished") {
          lease.phase = "finished";
          admissions.delete(request);
          admissionSockets.delete(socketId);
          try {
            await boundedQuery(lease.client, "ROLLBACK", [], 1000);
            lease.client.release();
          } catch {
            lease.client.release(true);
          }
        }
        throw error;
      }
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

  const server = createCollaborationTransport({
    hocuspocus,
    address: options.address,
    port: options.port ?? 3100,
    maxPayload: MAX_MESSAGE_BYTES,
    admissionTimeoutMs: options.admissionTimeoutMs ?? 5000,
    onAbort(request) {
      const work = abortAdmission(request);
      aborting.add(work);
      void work.finally(() => aborting.delete(work));
    },
    async onRequest(request, response) {
      if (!options.metricsToken || request.url?.split("?")[0] !== "/metrics") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("Welcome to Hocuspocus!");
        return;
      }
      if (!authorized(request.headers.authorization, options.metricsToken)) {
        response.writeHead(401, { "Content-Type": "text/plain" });
        response.end("Unauthorized");
      } else {
        response.writeHead(200, {
          "Content-Type": metrics.registry.contentType,
        });
        response.end(await metrics.registry.metrics());
      }
    },
  });

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
      const deadline = Date.now() + 5000;
      const bounded = async <T>(work: Promise<T>): Promise<T> => {
        let timeout: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Collaboration shutdown timed out; unsaved document state may remain",
                    ),
                  ),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      };
      if (sweepTimer) clearInterval(sweepTimer);
      if (retryTimer) clearTimeout(retryTimer);
      const current = listener;
      listener = undefined;
      if (current) await bounded(current.end().catch(() => undefined));
      server.hocuspocus.flushPendingStores();
      await bounded(Promise.allSettled([...persisting.values()]));
      // Hocuspocus keeps a document in memory after a failed store. Retry it
      // once on clean shutdown, then unload disconnected documents so a
      // recovered database does not leave destroy() waiting indefinitely.
      for (const [name, document] of server.hocuspocus.documents) {
        const sessionId = sessionIdOf(name);
        if (!sessionId || document.getConnectionsCount() > 0) continue;
        try {
          await bounded(persist(sessionId, document));
        } catch (error) {
          console.error("Collaboration document is not durably stored", error);
        }
        await bounded(server.hocuspocus.unloadDocument(document));
      }
      await bounded(server.destroy());
      await bounded(Promise.allSettled([...aborting]));
      await bounded(Promise.allSettled([...persisting.values()]));
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
