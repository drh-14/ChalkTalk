import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { AuthError } from "../auth/errors.js";
import { recordActivity } from "../notifications/activity.js";
import { newMentions, parseMentions } from "../notifications/mentions.js";
import { canReadPost, readablePost } from "./visibility.js";
import { endCollaborationSessions } from "../collaboration/lifecycle.js";
import { logApiEvent, type Observability } from "../observability/index.js";
import { POST_REVISION_SQL, type SemanticIndex } from "../semantic/index.js";
import {
  hideAttachmentsForPostTree,
  listAttachments,
} from "../content-attachments/service.js";

type Db = Pool | PoolClient;
type Role = "student" | "ta" | "instructor";
type Row = {
  id: string;
  course_id: string;
  author_user_id: string | null;
  type: "question" | "note" | "poll";
  title: string | null;
  body_markdown: string | null;
  anonymous: boolean;
  pinned: boolean;
  announcement: boolean;
  discussion_locked: boolean;
  private: boolean;
  duplicate_of_post_id: string | null;
  duplicate_status: "none" | "suggested" | "confirmed";
  last_activity_at: Date;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: string | number;
  display_name: string | null;
  author_deleted_at: Date | null;
  answered: boolean;
  canonical_title?: string | null;
};
export type CreatePost = {
  type: "question" | "note" | "poll";
  title: string;
  bodyMarkdown: string;
  anonymous?: boolean;
  tags?: string[];
  /** Poll choices, in order; required for polls only. */
  options?: string[];
  selectionMode?: "single" | "multiple";
  maxSelections?: number;
  closesAt?: string;
  releaseMode?: "live" | "manual" | "automatic";
  explanation?: string;
  /** Notes only, staff only: pinned and emailed to the course. */
  announcement?: boolean;
  /** Questions and notes only: readable by the author and course staff. */
  private?: boolean;
};
export type UpdatePost = Partial<
  Omit<CreatePost, "type" | "options" | "announcement">
> & {
  pinned?: boolean;
  duplicateOfPostId?: string | null;
  duplicateStatus?: "none" | "suggested" | "confirmed";
};
export type Post = Record<string, unknown> & {
  id: string;
  courseId: string;
  type: "question" | "note" | "poll";
  deleted: boolean;
  version: number;
};
export type MergedReference = {
  id: string;
  courseId: string;
  duplicateOfPostId: string;
  duplicateStatus: "confirmed";
  version: number;
};
export type ListPosts = {
  q?: string;
  semanticQuery?: string;
  type?: "question" | "note" | "poll";
  announcement?: boolean;
  /** Only private posts the viewer can read. */
  private?: true;
  /** Only questions with an unresolved followup discussion. */
  unresolvedFollowups?: true;
  tags?: string[];
  tagMatch?: "all";
  authorId?: string;
  createdAfter?: string;
  createdBefore?: string;
  answered?: boolean;
  pinned?: boolean;
  authorRole?: "instructor" | "ta";
  duplicateStatus?: "none" | "suggested" | "confirmed";
  sort: "relevance" | "newest" | "oldest" | "recent_activity";
  limit: number;
  cursor?: string;
  newSince?: string;
};
export const postEtag = (post: { version: number }) => `"v${post.version}"`;
const notFound = () => new AuthError(404, "not_found", "Post is not found");
/** Private posts the viewer cannot read look exactly like missing ones. */
const readable = (row: Row, viewerId: string, role: Role) => {
  if (!canReadPost(row, viewerId, role)) throw notFound();
};
const validation = (message: string) =>
  new AuthError(422, "validation_failed", message);
const STAFF = new Set<Role>(["ta", "instructor"]);
const ANSWERED =
  "EXISTS (SELECT 1 FROM answers a WHERE a.post_id=p.id AND a.deleted_at IS NULL)";
/** Active, unresolved followup discussions on the post aliased `p`. */
const UNRESOLVED =
  "FROM followups uf WHERE uf.post_id=p.id AND uf.parent_followup_id IS NULL AND uf.deleted_at IS NULL AND uf.resolved_at IS NULL";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PostService {
  constructor(
    private readonly pool: Pool,
    private readonly observability?: Observability,
    private readonly semantic?: SemanticIndex,
  ) {}
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async optionalSemanticWrite(
    db: PoolClient,
    postId: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    const eligible = await db.query(
      "SELECT 1 FROM posts WHERE id=$1 AND type IN ('question','note')",
      [postId],
    );
    if (!eligible.rowCount) return;
    if (!this.semantic) {
      await this.markSemanticCatchup(db, postId);
      return;
    }
    let needsCatchup = false;
    await db.query("SAVEPOINT semantic_side_effect");
    try {
      needsCatchup = (await work()) === false;
    } catch {
      await db.query("ROLLBACK TO SAVEPOINT semantic_side_effect");
      needsCatchup = true;
      logApiEvent(this.observability, "semantic_index_write_failed");
    } finally {
      await db.query("RELEASE SAVEPOINT semantic_side_effect");
    }
    if (needsCatchup) await this.markSemanticCatchup(db, postId);
  }
  private async markSemanticCatchup(
    db: PoolClient,
    postId: string,
  ): Promise<void> {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('semantic_embedding_generations'))",
    );
    if (this.semantic) {
      await db.query(
        "INSERT INTO semantic_embedding_generations(generation) VALUES($1) ON CONFLICT (generation) DO UPDATE SET last_seen_at=now()",
        [this.semantic.config.generation],
      );
      await db.query(
        "INSERT INTO semantic_post_catchup(post_id,generation) VALUES($1,$2) ON CONFLICT (post_id,generation) DO NOTHING",
        [postId, this.semantic.config.generation],
      );
    } else {
      await db.query(
        `INSERT INTO semantic_post_catchup(post_id,generation)
         SELECT $1,generation FROM semantic_embedding_generations
         WHERE last_seen_at >= now()-interval '1 day'
         ON CONFLICT (post_id,generation) DO NOTHING`,
        [postId],
      );
    }
  }
  private async removeEmbeddings(
    db: PoolClient,
    postId: string,
  ): Promise<void> {
    const table = await db.query<{ relation: string | null }>(
      "SELECT to_regclass('post_embeddings')::text AS relation",
    );
    if (table.rows[0]?.relation)
      await db.query("DELETE FROM post_embeddings WHERE post_id=$1", [postId]);
    await db.query("DELETE FROM semantic_post_catchup WHERE post_id=$1", [
      postId,
    ]);
  }
  private async membership(
    db: Db,
    courseId: string,
    userId: string,
    lock = false,
  ) {
    const result = await db.query<{
      role: Role;
      status: string;
      allow_anonymous_posting: boolean;
      allow_private_posting: boolean;
    }>(
      `SELECT m.role,c.status,c.allow_anonymous_posting,c.allow_private_posting FROM course_memberships m JOIN courses c ON c.id=m.course_id WHERE m.course_id=$1 AND m.user_id=$2${lock ? " FOR SHARE OF m,c" : ""}`,
      [courseId, userId],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private writable(status: string) {
    if (status !== "active")
      throw new AuthError(409, "course_archived", "Course is not active");
  }
  private async row(
    db: Db,
    id: string,
    lock = false,
  ): Promise<Row | undefined> {
    const result = await db.query<Row>(
      `SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,${ANSWERED} AS answered FROM posts p LEFT JOIN users u ON u.id=p.author_user_id WHERE p.id=$1${lock ? " FOR UPDATE OF p" : ""}`,
      [id],
    );
    return result.rows[0];
  }
  private async tags(db: Db, postId: string): Promise<string[]> {
    const result = await db.query<{ name: string }>(
      "SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=$1 ORDER BY t.name",
      [postId],
    );
    return result.rows.map((item) => item.name);
  }
  private async project(
    db: Db,
    row: Row,
    viewerId: string,
    role: Role,
  ): Promise<Post> {
    const common = {
      id: row.id,
      courseId: row.course_id,
      type: row.type,
      deleted: Boolean(row.deleted_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
    };
    if (row.deleted_at) return common;
    const authorDeleted = Boolean(row.author_deleted_at || !row.author_user_id);
    const reveal =
      !row.anonymous || viewerId === row.author_user_id || STAFF.has(role);
    return {
      ...common,
      title: row.title,
      bodyMarkdown: row.body_markdown,
      author: {
        userId: authorDeleted || !reveal ? null : row.author_user_id,
        displayName: authorDeleted
          ? "Deleted user"
          : reveal
            ? row.display_name
            : "Anonymous",
        anonymous: row.anonymous,
        deleted: authorDeleted,
      },
      anonymous: row.anonymous,
      tags: await this.tags(db, row.id),
      attachments:
        row.duplicate_status === "confirmed"
          ? []
          : await listAttachments(db, "post", row.id),
      pinned: row.pinned,
      announcement: row.announcement,
      discussionLocked: row.type === "note" ? false : row.discussion_locked,
      private: row.private,
      duplicateOfPostId: row.duplicate_of_post_id,
      duplicateStatus: row.duplicate_status,
      lastActivityAt: row.last_activity_at.toISOString(),
      ...(row.type === "question"
        ? {
            answered: row.answered,
            unresolvedFollowups: await this.unresolvedFollowups(db, row.id),
          }
        : {}),
      ...(row.type === "poll"
        ? await this.pollState(db, row.id, viewerId, role)
        : {}),
      ...(await this.viewerState(db, row, viewerId)),
    };
  }
  private async unresolvedFollowups(db: Db, postId: string) {
    const result = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count ${UNRESOLVED.replace("uf.post_id=p.id", "uf.post_id=$1")}`,
      [postId],
    );
    return result.rows[0]!.count;
  }
  private async pollSettings(db: Db, postId: string) {
    const result = await db.query<{
      selection_mode: "single" | "multiple";
      max_selections: number;
      closes_at: Date | null;
      closed_at: Date | null;
      release_mode: "live" | "manual" | "automatic";
      results_released_at: Date | null;
      explanation: string | null;
      due: boolean;
    }>(
      `SELECT *,closes_at <= clock_timestamp() AS due FROM poll_settings WHERE post_id=$1`,
      [postId],
    );
    const settings = result.rows[0];
    if (!settings)
      throw new AuthError(500, "internal_error", "Poll settings are missing");
    return settings;
  }
  private effectivePoll(
    settings: Awaited<ReturnType<PostService["pollSettings"]>>,
  ) {
    const closed = Boolean(settings.closed_at || settings.due);
    const resultsReleased = Boolean(
      settings.results_released_at ||
      settings.release_mode === "live" ||
      (settings.release_mode === "automatic" && closed),
    );
    return { closed, resultsReleased };
  }
  private async assertBallotOpen(db: Db, postId: string) {
    const result = await db.query<{ open: boolean }>(
      `SELECT closed_at IS NULL AND (closes_at IS NULL OR closes_at > clock_timestamp()) AS open
       FROM poll_settings WHERE post_id=$1`,
      [postId],
    );
    if (!result.rows[0]?.open)
      throw new AuthError(409, "poll_closed", "The poll or course is closed");
  }
  /** Viewer-aware poll state; unreleased aggregates never leave the API. */
  private async pollState(
    db: Db,
    postId: string,
    viewerId: string,
    role: Role,
  ) {
    const settings = await this.pollSettings(db, postId);
    const { closed, resultsReleased } = this.effectivePoll(settings);
    const showResults = STAFF.has(role) || resultsReleased;
    const options = await db.query<{
      id: string;
      label: string;
      vote_count: string;
      selected: boolean;
      total_votes: number;
    }>(
      `SELECT o.id,o.label,count(v.user_id) AS vote_count,coalesce(bool_or(v.user_id=$2),false) AS selected,
              (SELECT count(DISTINCT user_id)::int FROM poll_votes WHERE post_id=$1) AS total_votes
       FROM poll_options o LEFT JOIN poll_votes v ON v.option_id=o.id
       WHERE o.post_id=$1 GROUP BY o.id,o.label,o.position ORDER BY o.position`,
      [postId, viewerId],
    );
    const list = options.rows.map((option) => ({
      id: option.id,
      label: option.label,
      selected: option.selected,
      ...(showResults ? { voteCount: Number(option.vote_count) } : {}),
    }));
    return {
      options: list,
      selectionMode: settings.selection_mode,
      maxSelections: settings.max_selections,
      closesAt: settings.closes_at?.toISOString() ?? null,
      closed,
      releaseMode: settings.release_mode,
      resultsReleased,
      ...(showResults
        ? {
            totalVotes: options.rows[0]?.total_votes ?? 0,
            ...(settings.explanation
              ? { explanation: settings.explanation }
              : {}),
          }
        : {}),
    };
  }
  /** Whether the viewer follows the post and has unread activity on it. */
  private async viewerState(db: Db, row: Row, viewerId: string) {
    const state = await db.query<{ following: boolean; unread: boolean }>(
      `SELECT coalesce((SELECT following FROM post_follows WHERE post_id=$1 AND user_id=$2),false) AS following,
              $3::timestamptz > greatest(
                coalesce((SELECT read_at FROM post_reads WHERE post_id=$1 AND user_id=$2),'-infinity'),
                coalesce((SELECT read_before FROM course_read_marks WHERE course_id=$4 AND user_id=$2),'-infinity')
              ) AS unread`,
      [row.id, viewerId, row.last_activity_at, row.course_id],
    );
    return state.rows[0]!;
  }
  private async replaceTags(
    db: Db,
    postId: string,
    courseId: string,
    names: string[],
  ) {
    await db.query("DELETE FROM post_tags WHERE post_id=$1", [postId]);
    for (const name of names) {
      const tag = await db.query<{ id: string }>(
        "INSERT INTO tags (id,course_id,name) VALUES ($1,$2,$3) ON CONFLICT (course_id,name) DO UPDATE SET name=excluded.name RETURNING id",
        [uuidv7(), courseId, name],
      );
      await db.query("INSERT INTO post_tags (post_id,tag_id) VALUES ($1,$2)", [
        postId,
        tag.rows[0]!.id,
      ]);
    }
  }
  async create(
    courseId: string,
    userId: string,
    body: CreatePost,
    key?: string,
  ): Promise<{ value: Post; status: number }> {
    return this.tx((db) => this.createInTx(db, courseId, userId, body, key));
  }
  private async createInTx(
    db: PoolClient,
    courseId: string,
    userId: string,
    body: CreatePost,
    key?: string,
  ): Promise<{ value: Post; status: number }> {
    if (key !== undefined && (key.length < 1 || key.length > 255))
      throw validation("Idempotency-Key is invalid");
    const scope = `post-create:${userId}:${courseId}`;
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    const member = await this.membership(db, courseId, userId, true);
    if (key !== undefined) {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [scope, key],
      );
      const old = await db.query<{
        request_hash: Buffer;
        response_body: Post;
        response_status: number;
      }>(
        "SELECT request_hash,response_body,response_status FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [scope, key],
      );
      if (old.rows[0]) {
        if (!old.rows[0].request_hash.equals(hash))
          throw new AuthError(
            409,
            "idempotency_key_reused",
            "Idempotency key was reused",
          );
        if (body.type === "poll") {
          this.writable(member.status);
          if (!STAFF.has(member.role))
            throw new AuthError(
              403,
              "permission_denied",
              "Only staff may create polls",
            );
          const current = await this.row(db, old.rows[0].response_body.id);
          if (!current) throw notFound();
          return {
            value: await this.project(db, current, userId, member.role),
            status: old.rows[0].response_status,
          };
        }
        return {
          value: old.rows[0].response_body,
          status: old.rows[0].response_status,
        };
      }
      await db.query(
        "DELETE FROM idempotency_records WHERE scope=$1 AND key=$2 AND expires_at<=now()",
        [scope, key],
      );
    }
    this.writable(member.status);
    const staff = STAFF.has(member.role);
    if (body.type === "poll" && !staff)
      throw new AuthError(
        403,
        "permission_denied",
        "Only staff may create polls",
      );
    if (body.announcement && !staff)
      throw new AuthError(
        403,
        "permission_denied",
        "Only staff may post announcements",
      );
    if (body.private && body.announcement)
      throw new AuthError(
        422,
        "private_announcement",
        "Announcements are for the whole course and cannot be private",
      );
    if (body.private && body.type === "poll")
      throw new AuthError(422, "private_poll", "Polls cannot be private");
    if (body.anonymous && !member.allow_anonymous_posting)
      throw new AuthError(
        409,
        "anonymous_posting_disabled",
        "Anonymous posting is disabled for this course",
      );
    if (body.private && !member.allow_private_posting)
      throw new AuthError(
        409,
        "private_posting_disabled",
        "Private posting is disabled for this course",
      );
    if (
      body.type === "poll" &&
      body.closesAt &&
      (!Number.isFinite(Date.parse(body.closesAt)) ||
        Date.parse(body.closesAt) <= Date.now())
    )
      throw validation("Close time must be in the future");
    const id = uuidv7();
    await db.query(
      "SELECT singleton FROM digest_schedule_state WHERE singleton=true FOR SHARE",
    );
    const created = await db.query<{ created_on: string }>(
      `WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS at)
         INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,anonymous,announcement,pinned,private,created_at,updated_at,last_activity_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,stamp.at,stamp.at,stamp.at FROM stamp
         RETURNING (created_at AT TIME ZONE 'UTC')::date AS created_on`,
      [
        id,
        courseId,
        userId,
        body.type,
        body.title,
        body.bodyMarkdown,
        body.anonymous ?? false,
        body.announcement ?? false,
        body.private ?? false,
      ],
    );
    for (const [position, label] of (body.options ?? []).entries())
      await db.query(
        "INSERT INTO poll_options (id,course_id,post_id,position,label) VALUES ($1,$2,$3,$4,$5)",
        [uuidv7(), courseId, id, position, label],
      );
    if (body.type === "poll")
      await db.query(
        `INSERT INTO poll_settings (post_id,selection_mode,max_selections,closes_at,release_mode,results_released_at,explanation)
           VALUES ($1,$2,$3,$4,$5,CASE WHEN $5='live' THEN clock_timestamp() ELSE NULL END,$6)`,
        [
          id,
          body.selectionMode ?? "single",
          body.maxSelections ?? 1,
          body.closesAt ?? null,
          body.releaseMode ?? "live",
          body.explanation ?? null,
        ],
      );
    if (body.announcement)
      // One job per recipient, so a failing address retries on its own.
      await db.query(
        `INSERT INTO jobs (id,kind,payload,deduplication_key)
           SELECT gen_random_uuid(),'send_announcement_email',
             jsonb_build_object('postId',$1::uuid,'userId',m.user_id),$1::text||':'||m.user_id
           FROM course_memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
           WHERE m.course_id=$2 AND m.user_id<>$3 AND m.announcement_emails
           ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
        [id, courseId, userId],
      );
    if (body.type === "question")
      await db.query(
        "INSERT INTO question_creation_daily_counts(course_id,user_id,created_on,question_count) VALUES ($1,$2,$3,1) ON CONFLICT (course_id,user_id,created_on) DO UPDATE SET question_count=question_creation_daily_counts.question_count+1",
        [courseId, userId, created.rows[0]!.created_on],
      );
    await this.replaceTags(db, id, courseId, body.tags ?? []);
    await this.optionalSemanticWrite(db, id, () =>
      this.semantic!.enqueue(db, id),
    );
    await recordActivity(db, {
      courseId,
      postId: id,
      actorId: userId,
      ...(body.announcement ? { kind: "announcement" as const } : {}),
      anonymous: body.anonymous ?? false,
      mentions: parseMentions(body.bodyMarkdown),
      follow: true,
    });
    const row = await this.row(db, id);
    const value = await this.project(db, row!, userId, member.role);
    if (key !== undefined)
      await db.query(
        "INSERT INTO idempotency_records (scope,key,request_hash,response_status,response_body,expires_at) VALUES ($1,$2,$3,201,$4,now()+interval '24 hours')",
        [scope, key, hash, value],
      );
    return { value, status: 201 };
  }
  async get(id: string, userId: string): Promise<Post | MergedReference> {
    const row = await this.row(this.pool, id);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    readable(row, userId, member.role);
    if (row.duplicate_status === "confirmed") return this.mergedReference(row);
    const value = await this.project(this.pool, row, userId, member.role);
    if (!row.deleted_at) {
      try {
        await this.pool.query(
          "INSERT INTO post_view_events (id,course_id,post_id,user_id,viewed_on) VALUES ($1,$2,$3,$4,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT (course_id,post_id,user_id,viewed_on) DO NOTHING",
          [uuidv7(), row.course_id, row.id, userId],
        );
        // Opening a post reads it and its notifications.
        await this.pool.query(
          `WITH read AS (
             INSERT INTO post_reads (post_id,user_id,read_at) VALUES ($1,$2,clock_timestamp())
             ON CONFLICT (post_id,user_id) DO UPDATE SET read_at=excluded.read_at
           )
           UPDATE notifications SET read_at=clock_timestamp() WHERE post_id=$1 AND user_id=$2 AND read_at IS NULL`,
          [row.id, userId],
        );
        // The post was projected before this read was recorded.
        value.unread = false;
      } catch {
        logApiEvent(this.observability, "post_view_write_failed");
      }
    }
    return value;
  }
  async getDuplicateReview(id: string, userId: string): Promise<Post> {
    const row = await this.row(this.pool, id);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    if (row.deleted_at || row.duplicate_status !== "confirmed")
      throw notFound();
    if (!STAFF.has(member.role))
      throw new AuthError(
        403,
        "permission_denied",
        "Duplicate review is staff-only",
      );
    return this.project(this.pool, row, userId, member.role);
  }
  private mergedReference(row: Row): MergedReference {
    return {
      id: row.id,
      courseId: row.course_id,
      duplicateOfPostId: row.duplicate_of_post_id!,
      duplicateStatus: "confirmed",
      version: Number(row.version),
    };
  }
  async list(courseId: string, userId: string, options: ListPosts) {
    const member = await this.membership(this.pool, courseId, userId);
    if (options.duplicateStatus === "confirmed" && !STAFF.has(member.role))
      throw new AuthError(
        403,
        "permission_denied",
        "Duplicate review is staff-only",
      );
    const { cursor, limit, newSince, ...filters } = options;
    const ordinarySearch =
      options.duplicateStatus !== "confirmed" &&
      !/["\u201c\u201d]|\bOR\b|(^|\s)-\S/i.test(options.q ?? "");
    const semanticInput =
      options.duplicateStatus === "confirmed" || options.type === "poll"
        ? undefined
        : (options.semanticQuery ?? (ordinarySearch ? options.q : undefined));
    const semanticCapable = Boolean(
      this.semantic && semanticInput && (await this.semantic.available()),
    );
    const semanticEmbedding =
      semanticCapable && (await this.semantic!.healthy())
        ? await this.semantic!.embedQuery(semanticInput!)
        : undefined;
    let semanticReady = Boolean(semanticEmbedding);
    let watermark: { at: string } | undefined;
    if (newSince) {
      try {
        const token = JSON.parse(
          Buffer.from(newSince, "base64url").toString("utf8"),
        );
        if (
          token.courseId !== courseId ||
          token.userId !== userId ||
          typeof token.at !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(token.at) ||
          Number.isNaN(Date.parse(token.at))
        )
          throw Error();
        watermark = token;
      } catch {
        throw new AuthError(400, "invalid_request", "Feed snapshot is invalid");
      }
    }
    const binding = createHash("sha256")
      .update(
        JSON.stringify({
          courseId,
          userId,
          filters,
          searchVersion: options.sort === "relevance" ? 3 : undefined,
          semanticGeneration: semanticCapable
            ? this.semantic!.config.generation
            : undefined,
        }),
      )
      .digest("hex");
    let after:
      | { pinned: boolean; value: number | string; id: string; tier?: number }
      | undefined;
    if (cursor) {
      try {
        const parsed = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        );
        if (
          parsed.binding !== binding ||
          typeof parsed.pinned !== "boolean" ||
          typeof parsed.id !== "string" ||
          !UUID_PATTERN.test(parsed.id) ||
          (parsed.tier !== undefined &&
            (!Number.isInteger(parsed.tier) ||
              parsed.tier < 0 ||
              parsed.tier > 2)) ||
          (options.sort === "relevance"
            ? typeof parsed.value !== "number" ||
              !Number.isFinite(parsed.value) ||
              parsed.value < 0
            : typeof parsed.value !== "string" ||
              !Number.isFinite(Date.parse(parsed.value)) ||
              new Date(parsed.value).toISOString() !== parsed.value)
        )
          throw Error();
        after = parsed;
        if (
          options.sort === "relevance" &&
          semanticCapable &&
          parsed.tier === undefined
        )
          semanticReady = false;
      } catch {
        throw new AuthError(
          400,
          "invalid_request",
          "Pagination cursor is invalid",
        );
      }
    }
    if (
      options.sort === "relevance" &&
      after?.tier !== undefined &&
      !semanticReady
    )
      throw new AuthError(
        409,
        "search_restart_required",
        "Search ranking changed. Restart without the cursor.",
      );
    const values: unknown[] = [courseId];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const visibility = readablePost("p", add(userId), add(member.role));
    const clauses = ["p.course_id=$1", "p.deleted_at IS NULL", visibility];
    if (options.private) clauses.push("p.private");
    if (watermark)
      clauses.push(`p.created_at>${add(watermark.at)}::timestamptz`);
    if (options.unresolvedFollowups)
      clauses.push(`p.type='question' AND EXISTS (SELECT 1 ${UNRESOLVED})`);
    const possibleFuzzyTerms = (
      options.q?.match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((term) => [...term].length >= 3);
    const searchTerms =
      ordinarySearch && possibleFuzzyTerms.length
        ? (
            await this.pool.query<{ term: string }>(
              `SELECT DISTINCT lower(term) AS term FROM unnest($1::text[]) AS input(term)
               WHERE length(term)>=3 AND to_tsvector('english',term) <> ''::tsvector`,
              [possibleFuzzyTerms],
            )
          ).rows.map((row) => row.term)
        : [];
    const fuzzySearch = searchTerms.length > 0;
    const searchQuery = options.q
      ? `websearch_to_tsquery('english',${add(options.q)})`
      : undefined;
    if (options.duplicateStatus !== "confirmed")
      clauses.push("p.duplicate_status <> 'confirmed'");
    if (searchQuery && !fuzzySearch && !semanticReady)
      clauses.push(`p.search_vector @@ ${searchQuery}`);
    if (options.type) clauses.push(`p.type=${add(options.type)}`);
    if (options.announcement !== undefined)
      clauses.push(`p.announcement=${add(options.announcement)}`);
    if (options.tags?.length) {
      const tags = add(options.tags);
      // Tag names are unique per course and the list is deduplicated, so a full count means every tag.
      clauses.push(
        options.tagMatch === "all"
          ? `(SELECT count(*) FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND t.name=ANY(${tags}::text[]))=cardinality(${tags}::text[])`
          : `EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND t.name=ANY(${tags}::text[]))`,
      );
    }
    if (options.authorId) {
      clauses.push(`p.author_user_id=${add(options.authorId)}`);
      if (!STAFF.has(member.role)) {
        clauses.push("u.deleted_at IS NULL");
        clauses.push(`(p.anonymous=false OR p.author_user_id=${add(userId)})`);
      }
    }
    if (options.createdAfter)
      clauses.push(`p.created_at>=${add(options.createdAfter)}::timestamptz`);
    if (options.createdBefore)
      clauses.push(`p.created_at<=${add(options.createdBefore)}::timestamptz`);
    if (options.answered !== undefined)
      clauses.push(
        `p.type='question' AND ${options.answered ? "" : "NOT "}${ANSWERED}`,
      );
    if (options.pinned !== undefined)
      clauses.push(`p.pinned=${add(options.pinned)}`);
    if (options.authorRole) {
      clauses.push(
        `EXISTS (SELECT 1 FROM course_memberships am WHERE am.course_id=p.course_id AND am.user_id=p.author_user_id AND am.role=${add(options.authorRole)})`,
      );
      // Like authorId, a student may not learn the role behind someone else's anonymous post.
      if (!STAFF.has(member.role))
        clauses.push(`(p.anonymous=false OR p.author_user_id=${add(userId)})`);
    }
    if (options.duplicateStatus)
      clauses.push(`p.duplicate_status=${add(options.duplicateStatus)}`);
    const sortExpression =
      options.sort === "newest" || options.sort === "oldest"
        ? "date_trunc('milliseconds',p.created_at)"
        : options.sort === "recent_activity"
          ? "date_trunc('milliseconds',p.last_activity_at)"
          : `round(ts_rank_cd(p.search_vector,${searchQuery})::numeric,6)`;
    const sortValue = options.sort === "relevance" ? "numeric" : "timestamptz";
    const ascending = options.sort === "oldest";
    let cursorClause = "";
    if (after) {
      const pinned = add(after.pinned);
      const tier =
        semanticReady && options.sort === "relevance"
          ? add(after.tier)
          : undefined;
      const rank = add(after.value);
      const id = add(after.id);
      cursorClause = `AND (listed.pinned < ${pinned}::boolean OR (listed.pinned = ${pinned}::boolean AND (${tier ? "listed.match_tier," : ""}listed.rank_value,listed.id)${ascending ? ">" : "<"}(${tier ? `${tier}::integer,` : ""}${rank}::${sortValue},${id}::uuid)))`;
    }
    const direction = ascending ? "ASC" : "DESC";
    const source = `FROM posts p LEFT JOIN users u ON u.id=p.author_user_id LEFT JOIN posts canonical ON canonical.id=p.duplicate_of_post_id WHERE ${clauses.join(" AND ")}`;
    const listed = semanticReady
      ? (() => {
          const terms = add(searchTerms);
          const generation = semanticEmbedding
            ? add(this.semantic!.config.generation)
            : undefined;
          const vector = semanticEmbedding
            ? add(semanticEmbedding.vector)
            : undefined;
          const dimensions = semanticEmbedding
            ? add(semanticEmbedding.dimensions)
            : undefined;
          const semanticMatches = vector
            ? `SELECT e.post_id,MAX(CASE WHEN public.vector_dims(e.embedding)=${dimensions}::integer
                 THEN 1-(e.embedding OPERATOR(public.<=>) ${vector}::public.vector) END) AS similarity
               FROM post_embeddings e JOIN posts sp ON sp.id=e.post_id
               WHERE sp.course_id=$1 AND sp.deleted_at IS NULL AND sp.duplicate_status <> 'confirmed' AND sp.type IN ('question','note')
                 AND e.generation=${generation} AND e.source_revision=${POST_REVISION_SQL.replaceAll("p.", "sp.")}
               GROUP BY e.post_id
               HAVING MAX(CASE WHEN public.vector_dims(e.embedding)=${dimensions}::integer
                 THEN 1-(e.embedding OPERATOR(public.<=>) ${vector}::public.vector) END) IS NOT NULL`
            : "SELECT NULL::uuid AS post_id,NULL::double precision AS similarity WHERE false";
          return `search_terms AS (
            SELECT unnest(${terms}::text[]) AS term
          ), fuzzy_ids AS (
            SELECT p.id FROM posts p JOIN search_terms t
              ON t.term OPERATOR(public.<<%) p.title OR t.term OPERATOR(public.<<%) p.body_markdown
            WHERE p.course_id=$1 AND p.deleted_at IS NULL
            GROUP BY p.id HAVING count(*)=(SELECT count(*) FROM search_terms)
          ), semantic_matches AS (${semanticMatches}), candidate_ids AS (
            SELECT p.id FROM posts p WHERE p.course_id=$1 AND p.deleted_at IS NULL AND p.search_vector @@ ${searchQuery}
            UNION SELECT id FROM fuzzy_ids
            UNION SELECT post_id FROM semantic_matches
          ), candidates AS (
            SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,
              ${ANSWERED} AS answered,canonical.title AS canonical_title,
              p.search_vector @@ ${searchQuery} AS lexical_match,
              (ts_rank_cd(p.search_vector,${searchQuery})
                + ts_rank_cd(to_tsvector('english',p.title),${searchQuery})) AS lexical_score,
              COALESCE((SELECT avg(greatest(
                public.strict_word_similarity(t.term,coalesce(p.title,'')),
                0.75*public.strict_word_similarity(t.term,coalesce(p.body_markdown,''))
              )) FROM search_terms t),0) AS fuzzy_score,
              sm.similarity AS semantic_score,
              (p.id IN (SELECT id FROM fuzzy_ids)) AS fuzzy_match
            ${source.replace(" WHERE ", " LEFT JOIN semantic_matches sm ON sm.post_id=p.id WHERE ")}
              AND p.id IN (SELECT id FROM candidate_ids)
          ), ranked AS (
            SELECT candidates.*,
              row_number() OVER (PARTITION BY lexical_match ORDER BY lexical_score DESC,id DESC) AS lexical_position,
              row_number() OVER (PARTITION BY (lexical_match OR fuzzy_match) ORDER BY fuzzy_score DESC,id DESC) AS fuzzy_position
            FROM candidates
          ), listed AS (
            SELECT ranked.*,
              CASE WHEN lexical_match THEN 2 WHEN fuzzy_match THEN 1 ELSE 0 END AS match_tier,
              ${
                options.sort === "relevance"
                  ? `round(CASE WHEN lexical_match THEN ${fuzzySearch ? "1.0+1.5/(60+lexical_position)+1.0/(60+fuzzy_position)" : `round(ts_rank_cd(search_vector,${searchQuery})::numeric,6)`}
                     WHEN fuzzy_match THEN 1.0/(60+fuzzy_position)
                     ELSE (1.0+semantic_score)/2.0 END::numeric,12)`
                  : sortExpression.replaceAll("p.", "ranked.")
              } AS rank_value
            FROM ranked
          )`;
        })()
      : fuzzySearch
        ? (() => {
            const terms = add(searchTerms);
            return `search_terms AS (
            SELECT unnest(${terms}::text[]) AS term
          ), fuzzy_ids AS (
            SELECT p.id FROM posts p JOIN search_terms t
              ON t.term OPERATOR(public.<<%) p.title OR t.term OPERATOR(public.<<%) p.body_markdown
            WHERE p.course_id=$1 AND p.deleted_at IS NULL
            GROUP BY p.id HAVING count(*)=(SELECT count(*) FROM search_terms)
          ), candidate_ids AS (
            SELECT p.id FROM posts p WHERE p.course_id=$1 AND p.deleted_at IS NULL AND p.search_vector @@ ${searchQuery}
            UNION SELECT id FROM fuzzy_ids
          ), ${
            options.sort === "relevance"
              ? `candidates AS (
            SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,
              ${ANSWERED} AS answered,canonical.title AS canonical_title,
              p.search_vector @@ ${searchQuery} AS lexical_match,
              (ts_rank_cd(p.search_vector,${searchQuery})
                + ts_rank_cd(to_tsvector('english',p.title),${searchQuery})) AS lexical_score,
              COALESCE((SELECT avg(greatest(
                public.strict_word_similarity(t.term,coalesce(p.title,'')),
                0.75*public.strict_word_similarity(t.term,coalesce(p.body_markdown,''))
              )) FROM search_terms t),0) AS fuzzy_score
            ${source} AND p.id IN (SELECT id FROM candidate_ids)
          ), ranked AS (
            SELECT candidates.*,
              row_number() OVER (PARTITION BY lexical_match ORDER BY lexical_score DESC,id DESC) AS lexical_position,
              row_number() OVER (ORDER BY fuzzy_score DESC,id DESC) AS fuzzy_position
          FROM candidates
          ), listed AS (
            SELECT ranked.*,round(CASE WHEN lexical_match THEN 1.0+1.5/(60+lexical_position)+1.0/(60+fuzzy_position) ELSE 1.0/(60+fuzzy_position) END,12) AS rank_value FROM ranked
          )`
              : `listed AS (
            SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,${ANSWERED} AS answered,canonical.title AS canonical_title,${sortExpression} AS rank_value
            ${source} AND p.id IN (SELECT id FROM candidate_ids)
          )`
          }`;
          })()
        : `listed AS (SELECT p.*,u.display_name,u.deleted_at AS author_deleted_at,${ANSWERED} AS answered,canonical.title AS canonical_title,${sortExpression} AS rank_value ${source})`;
    if (watermark) {
      const count = await this.pool.query<{ count: number }>(
        `WITH ${listed} SELECT count(*)::int AS count FROM listed`,
        values,
      );
      return {
        data: [],
        page: { nextCursor: null, hasMore: false },
        newCount: count.rows[0]!.count,
      };
    }
    const query = `WITH ${listed}
    SELECT page.*,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_at
    FROM (SELECT 1) anchor LEFT JOIN LATERAL (
      SELECT listed.* FROM listed WHERE true ${cursorClause}
      ORDER BY listed.pinned DESC,${semanticReady && options.sort === "relevance" ? "listed.match_tier DESC," : ""}listed.rank_value ${direction},listed.id ${direction} LIMIT ${add(limit + 1)}
    ) page ON true`;
    const result = await this.pool.query<
      Row & {
        rank_value: number | Date;
        match_tier?: number;
        snapshot_at: string;
      }
    >(query, values);
    const pageRows = result.rows
      .filter((row) => row.id !== null)
      .slice(0, limit);
    const snapshot = Buffer.from(
      JSON.stringify({
        courseId,
        userId,
        at: result.rows[0]!.snapshot_at,
      }),
    ).toString("base64url");
    const data = await Promise.all(
      pageRows.map((row) =>
        options.duplicateStatus === "confirmed"
          ? Promise.resolve({
              ...this.mergedReference(row),
              title: row.title,
              canonicalTitle: row.canonical_title,
              type: row.type,
            })
          : this.project(this.pool, row, userId, member.role),
      ),
    );
    const tail = pageRows.at(-1);
    const nextCursor =
      result.rows.length > limit && tail
        ? Buffer.from(
            JSON.stringify({
              binding,
              pinned: tail.pinned,
              value:
                tail.rank_value instanceof Date
                  ? tail.rank_value.toISOString()
                  : Number(tail.rank_value),
              id: tail.id,
              ...(semanticReady && options.sort === "relevance"
                ? { tier: tail.match_tier }
                : {}),
            }),
          ).toString("base64url")
        : null;
    return {
      data,
      page: { nextCursor, hasMore: result.rows.length > limit },
      snapshot,
    };
  }
  private checkRevision(row: Row, etag: string | undefined) {
    if (!etag)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (etag !== postEtag({ version: Number(row.version) }))
      throw new AuthError(412, "version_conflict", "Post version has changed");
  }
  async setDiscussionLocked(
    id: string,
    userId: string,
    etag: string | undefined,
    locked: boolean,
  ): Promise<Post> {
    if (!UUID_PATTERN.test(id)) throw notFound();
    return this.tx(async (db) => {
      const row = await this.row(db, id, true);
      if (!row || row.deleted_at || row.duplicate_status === "confirmed")
        throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      readable(row, userId, member.role);
      if (!STAFF.has(member.role))
        throw new AuthError(
          403,
          "permission_denied",
          "Only staff may lock a post",
        );
      this.writable(member.status);
      this.checkRevision(row, etag);
      if (row.type === "note")
        throw validation("Only questions and polls can be discussion locked");
      if (row.discussion_locked !== locked) {
        await db.query(
          "UPDATE posts SET discussion_locked=$2,updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
          [id, locked],
        );
      }
      return this.project(db, (await this.row(db, id))!, userId, member.role);
    });
  }

  async update(
    id: string,
    userId: string,
    etag: string | undefined,
    body: UpdatePost,
  ): Promise<Post | MergedReference> {
    return this.tx(async (db) => {
      const initial = await this.row(db, id);
      if (!initial) throw notFound();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        initial.course_id,
      ]);
      const row = await this.row(db, id, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      if (row.deleted_at) throw notFound();
      readable(row, userId, member.role);
      this.writable(member.status);
      this.checkRevision(row, etag);
      const staff = STAFF.has(member.role);
      const author = row.author_user_id === userId;
      const ordinary =
        body.title !== undefined ||
        body.bodyMarkdown !== undefined ||
        body.anonymous !== undefined ||
        body.tags !== undefined ||
        body.private !== undefined;
      if (body.private === true && !row.private)
        throw new AuthError(
          422,
          "post_already_public",
          "A public post cannot be made private",
        );
      const publishing = body.private === false && row.private;
      const mentions =
        body.bodyMarkdown === undefined
          ? { userIds: [], staff: false }
          : newMentions(row.body_markdown, body.bodyMarkdown);
      const duplicate =
        body.duplicateOfPostId !== undefined ||
        body.duplicateStatus !== undefined;
      if (ordinary && !author && !staff)
        throw new AuthError(
          403,
          "permission_denied",
          "Post edit is not permitted",
        );
      if (
        body.anonymous === true &&
        !row.anonymous &&
        !member.allow_anonymous_posting
      )
        throw new AuthError(
          409,
          "anonymous_posting_disabled",
          "Anonymous posting is disabled for this course",
        );
      if (body.pinned !== undefined && !staff)
        throw new AuthError(403, "permission_denied", "Pinning is staff-only");
      if (row.announcement && body.anonymous)
        throw validation("Announcements cannot be anonymous");
      if (
        duplicate &&
        !staff &&
        (body.duplicateStatus !== "suggested" || !body.duplicateOfPostId)
      )
        throw new AuthError(
          403,
          "permission_denied",
          "Duplicate review is staff-only",
        );
      if (
        row.duplicate_status === "confirmed" &&
        (body.duplicateStatus !== "none" ||
          body.duplicateOfPostId !== null ||
          Object.entries(body).some(
            ([key, value]) =>
              value !== undefined &&
              !["duplicateStatus", "duplicateOfPostId"].includes(key),
          ))
      )
        throw new AuthError(
          409,
          "post_merged",
          "Unmerge the post before editing it",
        );
      const targetId =
        body.duplicateOfPostId === undefined
          ? row.duplicate_of_post_id
          : body.duplicateOfPostId;
      const status =
        body.duplicateStatus === undefined
          ? row.duplicate_status
          : body.duplicateStatus;
      if ((status === "none") !== (targetId === null))
        throw validation("Duplicate status and target must agree");
      if (status === "confirmed") {
        const inbound = await db.query(
          "SELECT 1 FROM posts WHERE duplicate_of_post_id=$1 AND duplicate_status='confirmed' AND deleted_at IS NULL LIMIT 1",
          [id],
        );
        if (inbound.rowCount)
          throw new AuthError(
            409,
            "canonical_has_duplicates",
            "Unmerge referring posts first",
          );
      }
      if (targetId !== null) {
        const target = await this.row(db, targetId);
        if (
          !target ||
          target.deleted_at ||
          target.duplicate_status === "confirmed" ||
          target.course_id !== row.course_id ||
          target.id === row.id
        )
          throw validation("Duplicate target is invalid");
        // The source's readers could not follow a redirect to a private post.
        if (target.private)
          throw new AuthError(
            422,
            "duplicate_target_private",
            "A post cannot be merged into a private post",
          );
      }
      await db.query(
        "UPDATE posts SET title=$2,body_markdown=$3,anonymous=$4,pinned=$5,duplicate_of_post_id=$6,duplicate_status=$7,private=$8,updated_at=now(),last_activity_at=now(),version=version+1 WHERE id=$1",
        [
          id,
          body.title ?? row.title,
          body.bodyMarkdown ?? row.body_markdown,
          body.anonymous ?? row.anonymous,
          body.pinned ?? row.pinned,
          targetId,
          status,
          publishing ? false : row.private,
        ],
      );
      if (mentions.userIds.length || mentions.staff)
        await recordActivity(db, {
          courseId: row.course_id,
          postId: id,
          actorId: userId,
          anonymous: body.anonymous ?? row.anonymous,
          mentions,
          follow: false,
        });
      if (publishing && staff && !author && row.author_user_id)
        await recordActivity(db, {
          courseId: row.course_id,
          postId: id,
          actorId: userId,
          kind: "post_published",
          recipients: "author",
          follow: false,
        });
      if (status === "confirmed" && row.duplicate_status !== "confirmed")
        await endCollaborationSessions(db, { postId: id });
      if (body.tags !== undefined)
        await this.replaceTags(db, id, row.course_id, body.tags);
      if (status === "confirmed") await this.removeEmbeddings(db, id);
      else if (
        body.title !== undefined ||
        body.bodyMarkdown !== undefined ||
        row.duplicate_status === "confirmed"
      ) {
        await this.optionalSemanticWrite(db, id, () =>
          this.semantic!.enqueue(db, id),
        );
      }
      const updated = (await this.row(db, id))!;
      if (
        row.type === "question" &&
        row.duplicate_status !== "confirmed" &&
        status === "confirmed"
      ) {
        await db.query(
          "INSERT INTO jobs (id,kind,payload,deduplication_key) VALUES ($1,'send_question_duplicate_email',$2,$3) ON CONFLICT (kind,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING",
          [
            uuidv7(),
            {
              sourcePostId: id,
              canonicalPostId: targetId,
              staffUserId: userId,
              staffRole: member.role,
            },
            `${id}:${updated.version}`,
          ],
        );
      }
      return status === "confirmed"
        ? this.mergedReference(updated)
        : this.project(db, updated, userId, member.role);
    });
  }
  /** Follows or unfollows a readable post; an unfollow stops automatic follows. */
  async setFollowing(postId: string, userId: string, following: boolean) {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    const row = await this.row(this.pool, postId);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    readable(row, userId, member.role);
    if (row.deleted_at || row.duplicate_status === "confirmed")
      throw notFound();
    await this.pool.query(
      `INSERT INTO post_follows (post_id,course_id,user_id,following) VALUES ($1,$2,$3,$4)
       ON CONFLICT (post_id,user_id) DO UPDATE SET following=excluded.following,updated_at=now()`,
      [postId, row.course_id, userId, following],
    );
    return { following };
  }

  /**
   * Members whose names contain the query, for the @mention picker. With a
   * post, only members who can read it are suggested.
   */
  async mentionSuggestions(
    courseId: string,
    userId: string,
    query: string,
    postId?: string,
  ) {
    if (!UUID_PATTERN.test(courseId)) throw notFound();
    const member = await this.membership(this.pool, courseId, userId);
    let post: Row | undefined;
    if (postId !== undefined) {
      if (!UUID_PATTERN.test(postId)) throw notFound();
      post = await this.row(this.pool, postId);
      if (!post || post.course_id !== courseId || post.deleted_at)
        throw notFound();
      readable(post, userId, member.role);
    }
    // LIKE treats %, _, and the escape character itself as special.
    const literal = query.replace(/[\\%_]/g, (match) => `\\${match}`);
    const result = await this.pool.query<{
      user_id: string;
      display_name: string;
      role: Role;
    }>(
      `SELECT m.user_id,u.display_name,m.role
       FROM course_memberships m
       JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL
       LEFT JOIN posts p ON p.id=$4
       WHERE m.course_id=$1 AND m.user_id<>$2 AND u.display_name ILIKE $3
         AND (p.id IS NULL OR ${readablePost("p", "m.user_id", "m.role")})
       ORDER BY (u.display_name ILIKE $5) DESC, lower(u.display_name), m.user_id
       LIMIT 8`,
      [courseId, userId, `%${literal}%`, post?.id ?? null, `${literal}%`],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
    }));
  }

  /** Marks every post in the course read for the caller as of now. */
  async markCourseRead(courseId: string, userId: string) {
    if (!UUID_PATTERN.test(courseId)) throw notFound();
    await this.membership(this.pool, courseId, userId);
    await this.pool.query(
      `INSERT INTO course_read_marks (course_id,user_id,read_before) VALUES ($1,$2,clock_timestamp())
       ON CONFLICT (course_id,user_id) DO UPDATE SET read_before=excluded.read_before`,
      [courseId, userId],
    );
  }

  /** Replaces the caller's whole ballot atomically. */
  async vote(postId: string, userId: string, choice: string | string[]) {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    return this.tx(async (db) => {
      const row = await this.row(db, postId, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      readable(row, userId, member.role);
      if (row.deleted_at || row.duplicate_status === "confirmed")
        throw notFound();
      if (row.type !== "poll")
        throw new AuthError(422, "not_a_poll", "The post is not a poll");
      if (row.discussion_locked)
        throw new AuthError(409, "discussion_locked", "Discussion is locked");
      const settings = await this.pollSettings(db, postId);
      if (member.status !== "active" || this.effectivePoll(settings).closed)
        throw new AuthError(409, "poll_closed", "The poll or course is closed");
      const ids = typeof choice === "string" ? [choice] : choice;
      if (
        (typeof choice === "string" && settings.selection_mode !== "single") ||
        ids.length < 1 ||
        ids.length > settings.max_selections ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !UUID_PATTERN.test(id))
      )
        throw new AuthError(
          422,
          "poll_option_invalid",
          "Ballot choices are invalid",
        );
      const options = await db.query<{ id: string }>(
        "SELECT id FROM poll_options WHERE post_id=$1 AND id=ANY($2::uuid[])",
        [postId, ids],
      );
      if (options.rowCount !== ids.length)
        throw new AuthError(
          422,
          "poll_option_invalid",
          "The option does not belong to this poll",
        );
      await db.query(
        `DELETE FROM poll_votes WHERE post_id=$1 AND user_id=$2
         AND EXISTS (SELECT 1 FROM poll_settings WHERE post_id=$1 AND closed_at IS NULL
                     AND (closes_at IS NULL OR closes_at > clock_timestamp()))`,
        [postId, userId],
      );
      const inserted = await db.query(
        `INSERT INTO poll_votes (course_id,post_id,user_id,option_id)
         SELECT $1,$2,$3,choice.option_id FROM unnest($4::uuid[]) AS choice(option_id)
         WHERE EXISTS (SELECT 1 FROM poll_settings WHERE post_id=$2 AND closed_at IS NULL
                       AND (closes_at IS NULL OR closes_at > clock_timestamp()))`,
        [row.course_id, postId, userId, ids],
      );
      if (inserted.rowCount !== ids.length)
        throw new AuthError(409, "poll_closed", "The poll or course is closed");
      await this.assertBallotOpen(db, postId);
      return {
        postId,
        ...(await this.pollState(db, postId, userId, member.role)),
      };
    });
  }

  /** Removes the caller's vote; succeeds when there was none. */
  async unvote(postId: string, userId: string) {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    await this.tx(async (db) => {
      const row = await this.row(db, postId, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      readable(row, userId, member.role);
      if (row.deleted_at || row.duplicate_status === "confirmed")
        throw notFound();
      if (row.type !== "poll")
        throw new AuthError(422, "not_a_poll", "The post is not a poll");
      if (row.discussion_locked)
        throw new AuthError(409, "discussion_locked", "Discussion is locked");
      const settings = await this.pollSettings(db, postId);
      if (member.status !== "active" || this.effectivePoll(settings).closed)
        throw new AuthError(409, "poll_closed", "The poll or course is closed");
      await db.query(
        `DELETE FROM poll_votes WHERE post_id=$1 AND user_id=$2
         AND EXISTS (SELECT 1 FROM poll_settings WHERE post_id=$1 AND closed_at IS NULL
                     AND (closes_at IS NULL OR closes_at > clock_timestamp()))`,
        [postId, userId],
      );
      await this.assertBallotOpen(db, postId);
    });
  }

  /** Serializes staff poll transitions with ballots on the post row. */
  async transitionPoll(
    postId: string,
    userId: string,
    etag: string | undefined,
    action: "close" | "reopen" | "release",
  ): Promise<Post> {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    return this.tx(async (db) => {
      const row = await this.row(db, postId, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      readable(row, userId, member.role);
      if (row.deleted_at || row.duplicate_status === "confirmed")
        throw notFound();
      if (row.type !== "poll")
        throw new AuthError(422, "not_a_poll", "The post is not a poll");
      if (!STAFF.has(member.role))
        throw new AuthError(
          403,
          "permission_denied",
          "Only staff may manage polls",
        );
      this.writable(member.status);
      this.checkRevision(row, etag);
      const settings = await this.pollSettings(db, postId);
      const effective = this.effectivePoll(settings);
      if (
        (action === "close" && effective.closed) ||
        (action === "reopen" && !effective.closed)
      )
        throw new AuthError(
          409,
          "poll_state_conflict",
          "Poll is already in that state",
        );
      if (action === "close")
        await db.query(
          `UPDATE poll_settings SET closed_at=clock_timestamp(),results_released_at=CASE WHEN release_mode='automatic' THEN coalesce(results_released_at,clock_timestamp()) ELSE results_released_at END WHERE post_id=$1`,
          [postId],
        );
      else if (action === "reopen")
        await db.query(
          `UPDATE poll_settings SET closed_at=NULL,closes_at=CASE WHEN closes_at<=clock_timestamp() THEN NULL ELSE closes_at END,results_released_at=CASE WHEN release_mode='automatic' AND $2 THEN coalesce(results_released_at,clock_timestamp()) ELSE results_released_at END WHERE post_id=$1`,
          [postId, effective.closed],
        );
      else
        await db.query(
          "UPDATE poll_settings SET results_released_at=coalesce(results_released_at,clock_timestamp()) WHERE post_id=$1",
          [postId],
        );
      await db.query(
        "UPDATE posts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [postId],
      );
      return this.project(
        db,
        (await this.row(db, postId))!,
        userId,
        member.role,
      );
    });
  }

  /** Only aggregate values leave the database; no ballot rows are returned. */
  async pollCsv(postId: string, userId: string): Promise<string> {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    const row = await this.row(this.pool, postId);
    if (!row) throw notFound();
    const member = await this.membership(this.pool, row.course_id, userId);
    readable(row, userId, member.role);
    if (row.deleted_at || row.duplicate_status === "confirmed")
      throw notFound();
    if (row.type !== "poll")
      throw new AuthError(422, "not_a_poll", "The post is not a poll");
    if (!STAFF.has(member.role))
      throw new AuthError(
        403,
        "permission_denied",
        "Only staff may export polls",
      );
    await this.pollSettings(this.pool, postId);
    const result = await this.pool.query<{
      label: string;
      count: number;
      ballots: number;
    }>(
      `SELECT o.label,count(v.user_id)::int AS count,
              (SELECT count(DISTINCT user_id)::int FROM poll_votes WHERE post_id=$1) AS ballots
       FROM poll_options o LEFT JOIN poll_votes v ON v.option_id=o.id
       WHERE o.post_id=$1 GROUP BY o.id ORDER BY o.position`,
      [postId],
    );
    const cell = (value: string | number) => {
      let raw = String(value);
      if (/^[\s]*[=+@-]/.test(raw)) raw = `'${raw}`;
      return `"${raw.replaceAll('"', '""')}"`;
    };
    return (
      [
        "option,count,ballots",
        ...result.rows.map((r) =>
          [r.label, r.count, r.ballots].map(cell).join(","),
        ),
      ].join("\r\n") + "\r\n"
    );
  }

  async clonePoll(postId: string, userId: string): Promise<Post> {
    if (!UUID_PATTERN.test(postId)) throw notFound();
    return this.tx(async (db) => {
      const row = await this.row(db, postId, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      readable(row, userId, member.role);
      if (row.deleted_at || row.duplicate_status === "confirmed")
        throw notFound();
      if (row.type !== "poll")
        throw new AuthError(422, "not_a_poll", "The post is not a poll");
      if (!STAFF.has(member.role))
        throw new AuthError(
          403,
          "permission_denied",
          "Only staff may clone polls",
        );
      this.writable(member.status);
      const settings = await this.pollSettings(db, postId);
      const options = await db.query<{ label: string }>(
        "SELECT label FROM poll_options WHERE post_id=$1 ORDER BY position",
        [postId],
      );
      const created = await this.createInTx(db, row.course_id, userId, {
        type: "poll",
        title: row.title!,
        bodyMarkdown: row.body_markdown!,
        options: options.rows.map((r) => r.label),
        selectionMode: settings.selection_mode,
        maxSelections: settings.max_selections,
        releaseMode:
          settings.release_mode === "live" ? "manual" : settings.release_mode,
        ...(settings.explanation ? { explanation: settings.explanation } : {}),
      });
      return created.value;
    });
  }

  async delete(
    id: string,
    userId: string,
    etag: string | undefined,
  ): Promise<void> {
    await this.tx(async (db) => {
      const initial = await this.row(db, id);
      if (!initial) throw notFound();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        initial.course_id,
      ]);
      const row = await this.row(db, id, true);
      if (!row) throw notFound();
      const member = await this.membership(db, row.course_id, userId, true);
      if (row.deleted_at) throw notFound();
      readable(row, userId, member.role);
      this.writable(member.status);
      this.checkRevision(row, etag);
      if (row.duplicate_status === "confirmed")
        throw new AuthError(
          409,
          "post_merged",
          "Unmerge the post before deleting it",
        );
      const inbound = await db.query(
        "SELECT 1 FROM posts WHERE duplicate_of_post_id=$1 AND duplicate_status='confirmed' AND deleted_at IS NULL LIMIT 1",
        [id],
      );
      if (inbound.rowCount)
        throw new AuthError(
          409,
          "canonical_has_duplicates",
          "Unmerge referring posts first",
        );
      if (row.author_user_id !== userId && !STAFF.has(member.role))
        throw new AuthError(
          403,
          "permission_denied",
          "Post deletion is not permitted",
        );
      await db.query("DELETE FROM post_tags WHERE post_id=$1", [id]);
      await this.removeEmbeddings(db, id);
      await hideAttachmentsForPostTree(db, id);
      await db.query(
        "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now(),updated_at=now(),last_activity_at=now(),version=version+1 WHERE id=$1",
        [id],
      );
      await endCollaborationSessions(db, { postId: id });
    });
  }
}
