import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Pool, PoolClient } from "pg";

const USER_COUNT = 20;
export async function acquireFixtureClient(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/EMAXCONNSESSION|max clients reached in session mode/i.test(message))
      throw new Error("CONNECTION_ACQUISITION_EXHAUSTED");
    throw error;
  }
}
const MAX_INDEXABLE_POSTS = 7;
const RAMP_INDEXABLE_POSTS = 15;
const MAX_SEMANTIC_JOBS = 64;
const MAX_SEMANTIC_CATCHUP_ROWS = 64;
const BASE_URL = "https://joinchalktalk.com";
const OWNED_TABLES = new Set([
  "users",
  "courses",
  "course_memberships",
  "sessions",
  "posts",
  "poll_options",
  "poll_settings",
  "poll_votes",
  "answers",
  "answer_contributors",
  "answer_contribution_events",
  "answer_collaboration_documents",
  "answer_upvotes",
  "followups",
  "followup_upvotes",
  "notifications",
  "post_reads",
  "post_view_events",
  "post_follows",
  "post_drafts",
  "post_tags",
  "tags",
  "question_creation_daily_counts",
  "course_read_marks",
  "course_staff_profiles",
  "course_information",
  "semantic_post_catchup",
  "post_embeddings",
  "thread_boards",
  "thread_conversations",
  "thread_messages",
  "thread_watches",
  "thread_message_reads",
  "thread_notifications",
  "thread_course_counters",
  "thread_changes",
  "course_resource_catalogs",
  "course_resources",
  "course_resource_revisions",
]);
const DELETE_ORDER = [
  "thread_notifications",
  "thread_message_reads",
  "thread_watches",
  "thread_changes",
  "thread_course_counters",
  "thread_messages",
  "thread_conversations",
  "thread_boards",
  "course_resource_revisions",
  "course_resources",
  "course_resource_catalogs",
  "semantic_post_catchup",
  "post_embeddings",
  "notifications",
  "post_reads",
  "post_view_events",
  "post_follows",
  "post_drafts",
  "post_tags",
  "answer_upvotes",
  "followup_upvotes",
  "answer_contribution_events",
  "answer_contributors",
  "answer_collaboration_documents",
  "poll_votes",
  "poll_options",
  "poll_settings",
  "followups",
  "answers",
  "question_creation_daily_counts",
  "posts",
  "tags",
  "course_read_marks",
  "course_staff_profiles",
  "course_information",
  "sessions",
  "course_memberships",
  "courses",
  "users",
  "organizations",
];

export interface FixtureManifest {
  mode?: "smoke" | "ramp";
  runId: string;
  deployedSha: string;
  baseUrl: string;
  expectedProjectRef: string;
  expectedHost: string;
  organizationId: string;
  courseId: string;
  questionId: string;
  pollId: string;
  pollOptionId: string;
  courses?: {
    id: string;
    questionId: string;
    pollId: string;
    pollOptionId: string;
    boardId: string;
    resourceId: string;
  }[];
  users: {
    id: string;
    email: string;
    password: string;
    courseId?: string;
    role?: "instructor" | "student";
  }[];
}

export function validateRunId(runId: string): void {
  if (!/^load-[0-9]{8}-[a-z0-9]{8,32}$/.test(runId))
    throw new Error(
      "Run ID must be load-YYYYMMDD-<8–32 lowercase letters/digits>",
    );
}

export function fixtureIdentity(runId: string): {
  domain: string;
  courseName: string;
} {
  validateRunId(runId);
  return {
    domain: `${runId}.loadtest.invalid`,
    courseName: `Load test ${runId}`,
  };
}

export function validateProductionTarget(
  connectionString: string,
  expectedRef: string,
  expectedHost: string,
): void {
  const url = new URL(connectionString);
  if (!/^postgres(?:ql)?:$/.test(url.protocol))
    throw new Error("PostgreSQL URL required");
  if (!/^[a-z0-9]{20}$/.test(expectedRef))
    throw new Error("Invalid Supabase project reference");
  if (!/^[a-z0-9.-]+\.supabase\.com$/.test(expectedHost))
    throw new Error("Expected host must be a Supabase host");
  if (
    url.hostname !== expectedHost ||
    url.username !== `postgres.${expectedRef}`
  )
    throw new Error("Supabase host/project reference mismatch");
  if (
    url.pathname !== "/postgres" ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    url.hash
  )
    throw new Error("Expected production database and verified TLS");
  if (!url.password) throw new Error("Database password missing");
}

export function validateManifest(
  manifest: FixtureManifest,
  runId: string,
  sha: string,
): void {
  validateRunId(runId);
  const ramp = manifest.mode === "ramp";
  const expectedUsers = ramp ? 30 : USER_COUNT;
  const cohorts = manifest.courses;
  if (
    !/^[0-9a-f]{40}$/.test(sha) ||
    manifest.runId !== runId ||
    manifest.deployedSha !== sha ||
    manifest.baseUrl !== BASE_URL ||
    manifest.users?.length !== expectedUsers ||
    new Set(manifest.users.map((u) => u.id)).size !== expectedUsers ||
    manifest.users.some(
      (u, i) =>
        u.email !==
          `vu${String(i + 1).padStart(2, "0")}@${fixtureIdentity(runId).domain}` ||
        (ramp &&
          (u.courseId !== cohorts?.[i % 3]?.id ||
            u.role !== (i < 3 ? "instructor" : "student"))),
    ) ||
    (ramp &&
      (cohorts?.length !== 3 ||
        new Set(cohorts.map((cohort) => cohort.id)).size !== 3 ||
        new Set(cohorts.flatMap((cohort) => Object.values(cohort))).size !==
          18 ||
        manifest.courseId !== cohorts[0]?.id ||
        manifest.questionId !== cohorts[0]?.questionId ||
        manifest.pollId !== cohorts[0]?.pollId ||
        manifest.pollOptionId !== cohorts[0]?.pollOptionId)) ||
    (!ramp && manifest.mode !== undefined && manifest.mode !== "smoke")
  )
    throw new Error("Credential manifest does not match run and deployed SHA");
}

export async function provisionFixture(
  pool: Pool,
  runId: string,
  sha: string,
  expectedProjectRef: string,
  expectedHost: string,
  saveManifest: (manifest: FixtureManifest) => Promise<void>,
  mode: "smoke" | "ramp" = "smoke",
): Promise<FixtureManifest> {
  validateRunId(runId);
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error("Full deployed commit SHA required");
  const { domain, courseName } = fixtureIdentity(runId);
  const client = await pool.connect();
  let saved = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const db = await client.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    if (db.rows[0]?.current_database !== "postgres")
      throw new Error("Not connected to the production postgres database");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [runId]);
    const existing = await client.query(
      "SELECT 1 FROM organizations WHERE domain = $1 UNION ALL SELECT 1 FROM courses WHERE name = $2 LIMIT 1",
      [domain, courseName],
    );
    if (existing.rowCount) throw new Error("Fixture namespace already exists");

    const organizationId = randomUUID();
    const cohorts = Array.from({ length: mode === "ramp" ? 3 : 1 }, (_, i) => ({
      id: randomUUID(),
      name: i ? `${courseName} course ${i + 1}` : courseName,
      questionId: randomUUID(),
      pollId: randomUUID(),
      pollOptionId: randomUUID(),
      secondOptionId: randomUUID(),
      boardId: randomUUID(),
      resourceId: randomUUID(),
    }));
    const users = Array.from(
      { length: mode === "ramp" ? 30 : USER_COUNT },
      (_, i) => ({
        id: randomUUID(),
        email: `vu${String(i + 1).padStart(2, "0")}@${domain}`,
        password: randomBytes(24).toString("base64url"),
        ...(mode === "ramp"
          ? {
              courseId: cohorts[i % 3]!.id,
              role: (i < 3 ? "instructor" : "student") as
                "instructor" | "student",
            }
          : {}),
      }),
    );
    const hashes: string[] = [];
    for (const user of users)
      hashes.push(await argon2.hash(user.password, { type: argon2.argon2id }));
    await client.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,$2,$3)",
      [organizationId, domain, courseName],
    );
    for (let i = 0; i < users.length; i++) {
      const user = users[i]!;
      await client.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash,notification_emails) VALUES ($1,$2,$3,$4,$5,false)",
        [
          user.id,
          organizationId,
          user.email,
          `Load test user ${i + 1}`,
          hashes[i],
        ],
      );
    }
    for (let cohortIndex = 0; cohortIndex < cohorts.length; cohortIndex++) {
      const cohort = cohorts[cohortIndex]!;
      const instructor = users[cohortIndex]!;
      await client.query(
        "INSERT INTO courses (id,organization_id,name,created_by_user_id,join_code) VALUES ($1,$2,$3,$4,$5)",
        [
          cohort.id,
          organizationId,
          cohort.name,
          instructor.id,
          randomBytes(4).toString("hex").toUpperCase(),
        ],
      );
      for (let i = 0; i < users.length; i++) {
        const user = users[i]!;
        if (mode === "ramp" && i % 3 !== cohortIndex) continue;
        await client.query(
          "INSERT INTO course_memberships (course_id,user_id,role,activity_emails,announcement_emails,digest_emails) VALUES ($1,$2,$3,false,false,false)",
          [
            cohort.id,
            user.id,
            user.role ?? (i === 0 ? "instructor" : "student"),
          ],
        );
      }
      await client.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question',$4,$5)",
        [
          cohort.questionId,
          cohort.id,
          instructor.id,
          `${cohort.name} seed question`,
          "Synthetic question for isolated load testing",
        ],
      );
      await client.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'poll',$4,$5)",
        [
          cohort.pollId,
          cohort.id,
          instructor.id,
          `${cohort.name} seed poll`,
          "Synthetic poll for isolated load testing",
        ],
      );
      await client.query(
        "INSERT INTO poll_settings (post_id,results_released_at) VALUES ($1,now())",
        [cohort.pollId],
      );
      await client.query(
        "INSERT INTO poll_options (id,course_id,post_id,position,label) VALUES ($1,$2,$3,0,'Option A'),($4,$2,$3,1,'Option B')",
        [cohort.pollOptionId, cohort.id, cohort.pollId, cohort.secondOptionId],
      );
      if (mode === "ramp") {
        await client.query(
          "INSERT INTO thread_boards (id,course_id,title) VALUES ($1,$2,$3)",
          [cohort.boardId, cohort.id, `${cohort.name} discussion`],
        );
        await client.query(
          "INSERT INTO course_resource_catalogs (course_id) VALUES ($1)",
          [cohort.id],
        );
        await client.query(
          "INSERT INTO course_resources (id,course_id,title,visibility,position,active_revision_id) VALUES ($1,$2,$3,'class',0,$1)",
          [cohort.resourceId, cohort.id, `${cohort.name} guide`],
        );
        await client.query(
          "INSERT INTO course_resource_revisions (id,resource_id,course_id,kind,url) VALUES ($1,$1,$2,'link','https://example.invalid/load-test-guide')",
          [cohort.resourceId, cohort.id],
        );
      }
    }
    const first = cohorts[0]!;
    const manifest: FixtureManifest = {
      ...(mode === "ramp" ? { mode } : {}),
      runId,
      deployedSha: sha,
      baseUrl: BASE_URL,
      expectedProjectRef,
      expectedHost,
      organizationId,
      courseId: first.id,
      questionId: first.questionId,
      pollId: first.pollId,
      pollOptionId: first.pollOptionId,
      ...(mode === "ramp"
        ? {
            courses: cohorts.map(
              ({
                id,
                questionId,
                pollId,
                pollOptionId,
                boardId,
                resourceId,
              }) => ({
                id,
                questionId,
                pollId,
                pollOptionId,
                boardId,
                resourceId,
              }),
            ),
          }
        : {}),
      users,
    };
    await saveManifest(manifest);
    saved = true;
    await client.query("COMMIT");
    return manifest;
  } catch (error) {
    await client.query("ROLLBACK");
    if (saved)
      throw new Error(
        "Provisioning failed after manifest was written; retain it for review",
        { cause: error },
      );
    throw error;
  } finally {
    client.release();
  }
}

interface OwnedIds {
  organization: string[];
  course: string[];
  user: string[];
  post: string[];
  indexablePost: string[];
  answer: string[];
  followup: string[];
  option: string[];
  board: string[];
  conversation: string[];
  message: string[];
  resource: string[];
  revision: string[];
}

async function ownedIds(
  client: PoolClient,
  manifest: FixtureManifest,
): Promise<OwnedIds> {
  const course = manifest.courses?.map((cohort) => cohort.id) ?? [
    manifest.courseId,
  ];
  const posts = await client.query<{ id: string; type: string }>(
    "SELECT id,type FROM posts WHERE course_id=ANY($1::uuid[])",
    [course],
  );
  const answers = await client.query<{ id: string }>(
    "SELECT id FROM answers WHERE course_id=ANY($1::uuid[])",
    [course],
  );
  const followups = await client.query<{ id: string }>(
    "SELECT id FROM followups WHERE course_id=ANY($1::uuid[])",
    [course],
  );
  const options = await client.query<{ id: string }>(
    "SELECT id FROM poll_options WHERE course_id=ANY($1::uuid[])",
    [course],
  );
  const roots: string[][] = [];
  for (const table of [
    "thread_boards",
    "thread_conversations",
    "thread_messages",
    "course_resources",
    "course_resource_revisions",
  ]) {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE course_id=ANY($1::uuid[])`,
      [course],
    );
    roots.push(result.rows.map((row) => row.id));
  }
  return {
    organization: [manifest.organizationId],
    course,
    user: manifest.users.map((u) => u.id),
    post: posts.rows.map((r) => r.id),
    indexablePost: posts.rows
      .filter((r) => r.type === "question" || r.type === "note")
      .map((r) => r.id),
    answer: answers.rows.map((r) => r.id),
    followup: followups.rows.map((r) => r.id),
    option: options.rows.map((r) => r.id),
    board: roots[0]!,
    conversation: roots[1]!,
    message: roots[2]!,
    resource: roots[3]!,
    revision: roots[4]!,
  };
}

const ID_COLUMNS: Record<string, keyof OwnedIds> = {
  organization_id: "organization",
  course_id: "course",
  post_id: "post",
  answer_id: "answer",
  followup_id: "followup",
  parent_followup_id: "followup",
  option_id: "option",
  poll_option_id: "option",
  user_id: "user",
  author_user_id: "user",
  actor_user_id: "user",
  created_by_user_id: "user",
  endorsed_by_user_id: "user",
  recipient_user_id: "user",
  owner_user_id: "user",
  last_edited_by_user_id: "user",
  board_id: "board",
  conversation_id: "conversation",
  message_id: "message",
  resource_id: "resource",
  active_revision_id: "revision",
  revision_id: "revision",
};

interface TableMatch {
  table: string;
  count: number;
  where: string;
  params: string[][];
}

async function fixtureJobs(client: PoolClient, ids: OwnedIds, runId: string) {
  const patterns = [runId, ...Object.values(ids).flat()].map(
    (value) => `%${value}%`,
  );
  const result = await client.query<{
    id: string;
    kind: string;
    payload: unknown;
    deduplication_key: string | null;
    status: string;
  }>(
    "SELECT id,kind,payload,deduplication_key,status FROM jobs WHERE payload::text LIKE ANY($1::text[]) OR deduplication_key LIKE ANY($1::text[])",
    [patterns],
  );
  const allowed: string[] = [];
  const violations: string[] = [];
  for (const job of result.rows) {
    const payload = job.payload;
    if (
      job.kind !== "index_post" ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "generation,postId,revision" ||
      typeof (payload as Record<string, unknown>).postId !== "string" ||
      !ids.indexablePost.includes((payload as Record<string, string>).postId) ||
      typeof (payload as Record<string, unknown>).generation !== "string" ||
      !/^[0-9a-f]{64}$/.test((payload as Record<string, string>).generation) ||
      typeof (payload as Record<string, unknown>).revision !== "string" ||
      !/^[0-9a-f]{64}$/.test((payload as Record<string, string>).revision) ||
      job.deduplication_key !==
        `${(payload as Record<string, string>).postId}:${(payload as Record<string, string>).generation}:${(payload as Record<string, string>).revision}`
    ) {
      violations.push("jobs: ambiguous or foreign fixture reference");
    } else {
      allowed.push(job.id);
      if (job.status !== "succeeded")
        violations.push("jobs: fixture indexing work is not quiescent");
    }
  }
  if (allowed.length > MAX_SEMANTIC_JOBS)
    violations.push("jobs: fixture semantic job cap exceeded");
  return { ids: allowed, violations };
}

async function scanOwnedReferences(
  client: PoolClient,
  ids: OwnedIds,
): Promise<{ matches: TableMatch[]; violations: string[] }> {
  const columns = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='uuid' ORDER BY table_name,column_name",
  );
  const byTable = new Map<string, { name: string; key: keyof OwnedIds }[]>();
  const addColumn = (table: string, name: string, key: keyof OwnedIds) => {
    if (!ids[key].length) return;
    const fields = byTable.get(table) ?? [];
    const existing = fields.find((field) => field.name === name);
    if (existing && existing.key !== key)
      throw new Error(`${table}.${name}: ambiguous fixture reference`);
    if (!existing) byTable.set(table, [...fields, { name, key }]);
  };
  for (const { table_name: table, column_name: column } of columns.rows) {
    const key = ID_COLUMNS[column];
    if (key) addColumn(table, column, key);
  }
  // Discover FK columns by the referenced key, not by naming convention. This
  // catches a new ON DELETE CASCADE table before it can silently delete data.
  const foreignKeys = await client.query<{
    table_name: string;
    column_name: string;
    target_table: string;
    target_column: string;
  }>(`SELECT child.relname AS table_name, child_att.attname AS column_name,
      parent.relname AS target_table, parent_att.attname AS target_column
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY ck(attnum,ord) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY pk(attnum,ord) ON pk.ord=ck.ord
    JOIN pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=ck.attnum
    JOIN pg_attribute parent_att ON parent_att.attrelid=parent.oid AND parent_att.attnum=pk.attnum
    WHERE fk.contype='f' AND ns.nspname='public'`);
  const rootKey: Record<string, keyof OwnedIds> = {
    organizations: "organization",
    courses: "course",
    users: "user",
    posts: "post",
    answers: "answer",
    followups: "followup",
    poll_options: "option",
    thread_boards: "board",
    thread_conversations: "conversation",
    thread_messages: "message",
    course_resources: "resource",
    course_resource_revisions: "revision",
  };
  for (const fk of foreignKeys.rows) {
    const key =
      fk.target_column === "id"
        ? rootKey[fk.target_table]
        : ID_COLUMNS[fk.target_column];
    if (key) addColumn(fk.table_name, fk.column_name, key);
  }
  const matches: TableMatch[] = [];
  const violations: string[] = [];
  for (const [table, fields] of byTable) {
    const where = fields
      .map(
        ({ name }, i) =>
          `t."${name.replaceAll('"', '""')}" = ANY($${i + 1}::uuid[])`,
      )
      .join(" OR ");
    const params = fields.map(({ key }) => ids[key]);
    const rows = await client.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM public."${table.replaceAll('"', '""')}" t WHERE ${where}`,
      params,
    );
    if (!rows.rowCount) continue;
    matches.push({ table, count: rows.rowCount, where, params });
    if (!OWNED_TABLES.has(table)) {
      violations.push(`${table}: unrecognized references to fixture IDs`);
      continue;
    }
    for (const { row } of rows.rows) {
      for (const { name, key } of fields) {
        const value = row[name];
        if (value && !ids[key].includes(String(value)))
          violations.push(`${table}.${name}: foreign reference`);
      }
      if (
        table === "thread_changes" &&
        ![...ids.board, ...ids.conversation, ...ids.message].includes(
          String(row.entity_id),
        )
      )
        violations.push("thread_changes.entity_id: unknown fixture entity");
    }
  }
  return { matches, violations: [...new Set(violations)] };
}

export async function inventoryFixture(
  client: PoolClient,
  manifest: FixtureManifest,
): Promise<{
  counts: Record<string, number>;
  violations: string[];
  jobIds: string[];
}> {
  const ids = await ownedIds(client, manifest);
  const { matches, violations } = await scanOwnedReferences(client, ids);
  const counts = Object.fromEntries(
    matches.map(({ table, count }) => [table, count]),
  );
  counts.indexable_posts = ids.indexablePost.length;
  counts.semantic_post_catchup ??= 0;
  if (
    counts.indexable_posts >
    (manifest.mode === "ramp" ? RAMP_INDEXABLE_POSTS : MAX_INDEXABLE_POSTS)
  )
    violations.push("posts: fixture indexable post cap exceeded");
  if (manifest.mode === "ramp") {
    const caps: Record<string, number> = {
      posts: 18,
      answers: 6,
      followups: 6,
      poll_votes: 6,
      thread_boards: 3,
      thread_conversations: 6,
      thread_messages: 18,
      thread_watches: 18,
      thread_message_reads: 60,
      thread_notifications: 256,
      thread_changes: 64,
      thread_course_counters: 3,
      course_resource_catalogs: 3,
      course_resources: 3,
      course_resource_revisions: 3,
    };
    for (const [table, cap] of Object.entries(caps))
      if ((counts[table] ?? 0) > cap)
        violations.push(`${table}: fixture row cap exceeded`);
  }
  if (counts.semantic_post_catchup > MAX_SEMANTIC_CATCHUP_ROWS)
    violations.push("semantic_post_catchup: fixture catch-up cap exceeded");
  const organizationCount = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM organizations WHERE id=$1",
    [manifest.organizationId],
  );
  counts.organizations = organizationCount.rows[0]?.count ?? 0;
  const courseCount = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM courses WHERE id=ANY($1::uuid[])",
    [ids.course],
  );
  counts.courses = courseCount.rows[0]?.count ?? 0;
  const organization = await client.query<{ domain: string }>(
    "SELECT domain FROM organizations WHERE id=$1",
    [manifest.organizationId],
  );
  if (
    organization.rows[0] &&
    organization.rows[0].domain !== fixtureIdentity(manifest.runId).domain
  )
    violations.push("organizations: manifest namespace mismatch");
  const course = await client.query<{ name: string; organization_id: string }>(
    "SELECT name,organization_id FROM courses WHERE id=ANY($1::uuid[]) ORDER BY name",
    [ids.course],
  );
  const expectedNames = ids.course.map((_, i) =>
    i
      ? `${fixtureIdentity(manifest.runId).courseName} course ${i + 1}`
      : fixtureIdentity(manifest.runId).courseName,
  );
  if (
    course.rows.some(
      (row) =>
        row.organization_id !== manifest.organizationId ||
        !expectedNames.includes(row.name),
    )
  )
    violations.push("courses: manifest identity mismatch");
  const users = await client.query<{
    id: string;
    email: string;
    organization_id: string;
  }>("SELECT id,email,organization_id FROM users WHERE id=ANY($1::uuid[])", [
    ids.user,
  ]);
  counts.users = users.rowCount ?? 0;
  const expectedEmails = new Map(manifest.users.map((u) => [u.id, u.email]));
  if (
    users.rows.some(
      (u) =>
        u.organization_id !== manifest.organizationId ||
        expectedEmails.get(u.id) !== u.email,
    )
  )
    violations.push("users: manifest identity mismatch");
  const jobs = await fixtureJobs(client, ids, manifest.runId);
  counts.jobs = jobs.ids.length;
  violations.push(...jobs.violations);
  return { counts, violations, jobIds: jobs.ids.sort() };
}

export async function teardownFixture(
  pool: Pool,
  manifest: FixtureManifest,
): Promise<Record<string, number>> {
  const client = await acquireFixtureClient(pool);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      manifest.runId,
    ]);
    await client.query("LOCK TABLE jobs IN SHARE ROW EXCLUSIVE MODE");
    await client.query(
      "LOCK TABLE semantic_post_catchup IN SHARE ROW EXCLUSIVE MODE",
    );
    const ids = await ownedIds(client, manifest);
    const { matches, violations } = await scanOwnedReferences(client, ids);
    const before = await inventoryFixture(client, manifest);
    if (
      before.counts.organizations !== 1 ||
      before.counts.courses !== ids.course.length ||
      before.counts.users !== (manifest.mode === "ramp" ? 30 : USER_COUNT)
    )
      violations.push("Manifest roots do not exactly match the database");
    violations.push(...before.violations);
    if (violations.length)
      throw new Error(
        `Cleanup refused: ${[...new Set(violations)].join("; ")}`,
      );
    const jobs = await fixtureJobs(client, ids, manifest.runId);
    if (jobs.ids.length)
      await client.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [
        jobs.ids,
      ]);
    const byTable = new Map(matches.map((match) => [match.table, match]));
    for (const table of DELETE_ORDER) {
      if (table === "organizations")
        await client.query(
          "DELETE FROM organizations WHERE id=$1 AND domain=$2",
          [manifest.organizationId, fixtureIdentity(manifest.runId).domain],
        );
      else if (table === "users")
        await client.query(
          "DELETE FROM users WHERE id=ANY($1::uuid[]) AND organization_id=$2",
          [ids.user, manifest.organizationId],
        );
      else if (table === "courses")
        await client.query(
          "DELETE FROM courses WHERE id=ANY($1::uuid[]) AND organization_id=$2",
          [ids.course, manifest.organizationId],
        );
      else {
        const match = byTable.get(table);
        if (match)
          await client.query(
            `DELETE FROM public."${table}" t WHERE ${match.where}`,
            match.params,
          );
      }
    }
    const after = await inventoryFixture(client, manifest);
    if (
      Object.values(after.counts).some((count) => count !== 0) ||
      after.violations.length
    )
      throw new Error("Cleanup left fixture residues; rolled back");
    await client.query("COMMIT");
    return before.counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
