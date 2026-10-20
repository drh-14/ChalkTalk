import { Server, type Document } from "@hocuspocus/server";
import pg, { type Pool } from "pg";
import * as Y from "yjs";
import {
  COLLABORATION_EVENTS_CHANNEL,
  documentName,
  hashTicket,
  type CollaborationEvent,
} from "./service.js";

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
  const persisting = new Map<string, Promise<void>>();
  let listener: pg.Client | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  /** Rechecks, from current rows, that a connected user may still edit. */
  async function stillAuthorized(context: ConnectionContext): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1
       FROM collaboration_sessions s
       JOIN courses c ON c.id=s.course_id AND c.status='active'
       JOIN course_memberships m ON m.course_id=s.course_id AND m.user_id=$2
       JOIN sessions a ON a.id=$3 AND a.user_id=$2 AND a.revoked_at IS NULL AND a.expires_at>now()
       JOIN users u ON u.id=$2 AND u.deleted_at IS NULL
       JOIN posts p ON p.id=s.post_id
       WHERE s.id=$1 AND s.lifecycle_state='active'
         AND (m.role IN ('ta','instructor') OR (
           p.deleted_at IS NULL AND p.duplicate_status<>'confirmed' AND (
             s.created_by_user_id=$2 OR EXISTS (
               SELECT 1 FROM collaboration_participants cp
               WHERE cp.collaboration_session_id=s.id AND cp.user_id=$2))))`,
      [context.sessionId, context.userId, context.authSessionId],
    );
    return Boolean(result.rowCount);
  }

  /** Serializes stores per session so an older state never overwrites a newer one. */
  function persist(sessionId: string, document: Y.Doc): Promise<void> {
    const previous = persisting.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const state = Buffer.from(Y.encodeStateAsUpdate(document));
        const text = document.getText("content").toString();
        try {
          await pool.query(
            `INSERT INTO collaboration_documents (collaboration_session_id,yjs_state,text_projection,persisted_at,persistence_revision)
             VALUES ($1,$2,$3,clock_timestamp(),1)
             ON CONFLICT (collaboration_session_id) DO UPDATE SET yjs_state=excluded.yjs_state,
               text_projection=excluded.text_projection,persisted_at=excluded.persisted_at,
               persistence_revision=collaboration_documents.persistence_revision+1`,
            [sessionId, state, text],
          );
        } catch (error) {
          // A session removed with its post or course has nothing left to store.
          if ((error as { code?: string }).code !== "23503") throw error;
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

  function closeAll(document: Document, reason: string) {
    for (const connection of document.getConnections())
      connection.close({ code: 1000, reason });
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
        connection.close({
          code: 1000,
          reason:
            state.rows[0]?.lifecycle_state === "active"
              ? CLOSE_REASONS.removed
              : CLOSE_REASONS.ended,
        });
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

  async function sweep() {
    await recheck(() => true);
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

    async onConnect({ requestHeaders, documentName: name }) {
      const origin = requestHeaders.get("origin");
      if (!origin || !options.frontendOrigins.has(origin))
        throw new Rejection("Origin is not allowed");
      if (!sessionIdOf(name)) throw new Rejection("Unknown document");
    },

    async onAuthenticate({ token, documentName: name }) {
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
        }>(
          "UPDATE collaboration_connection_tickets SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING user_id,auth_session_id,collaboration_session_id",
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
        };
        if (!(await stillAuthorized(context)))
          throw new Rejection("Not authorized");
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

    async onStoreDocument({ document, documentName: name }) {
      await persist(sessionIdOf(name)!, document);
    },

    async beforeSync({ type, payload, document, connection }) {
      // SyncStep2 (1) and Update (2) carry document changes.
      if (type !== 1 && type !== 2) return;
      const probe = new Y.Doc();
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(document));
      Y.applyUpdate(probe, payload);
      const invalid =
        [...probe.share.keys()].some((key) => key !== "content") ||
        probe.getText("content").length > MAX_DOCUMENT_CHARACTERS;
      probe.destroy();
      if (invalid) {
        connection.close({ code: 1000, reason: CLOSE_REASONS.invalid });
        throw new Rejection("Invalid update");
      }
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

  return {
    server,
    get hocuspocus() {
      return server.hocuspocus;
    },
    connectionsOf,
    sweep,
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
