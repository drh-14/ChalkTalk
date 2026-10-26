import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { Pool, PoolClient } from "pg";
import { v5 as uuidv5 } from "uuid";
import type {
  ImportAuthor,
  ImportCourse,
  ImportFollowup,
  ImportRole,
} from "./convert.js";

/** Namespace for the deterministic ids that make a re-import update rather than duplicate. */
const PIAZZA_NAMESPACE = "6f0c7a4e-3d1b-5c2a-9e8f-7b6a5d4c3b2a";
export const PIAZZA_EMAIL_DOMAIN = "piazza.invalid";
const ANONYMOUS_NAME = "Anonymous Piazza user";

export type ImportCounts = {
  created: number;
  updated: number;
  skipped: number;
};
export type ImportSummary = {
  courseId: string;
  courseName: string;
  joinCode: string;
  posts: ImportCounts;
  answers: ImportCounts;
  followups: ImportCounts;
  people: { name: string; email: string; role: ImportRole; created: boolean }[];
};

const counts = (): ImportCounts => ({ created: 0, updated: 0, skipped: 0 });
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40) || "piazza.user";
export const piazzaEmail = (name: string, uid: string) =>
  `${slug(name)}.${uid.toLowerCase().replace(/[^a-z0-9]/g, "")}@${PIAZZA_EMAIL_DOMAIN}`;

const JOIN_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const joinCode = () =>
  [...randomBytes(8)]
    .map((byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length])
    .join("");

/**
 * Writes a converted Piazza class into ChalkTalk as a course owned by `ownerEmail`.
 * Every row's id derives from its Piazza id, so running it again adds new content,
 * refreshes edited content, and never duplicates. Content deleted in ChalkTalk stays deleted.
 */
export async function importPiazzaCourse(
  pool: Pool,
  course: ImportCourse,
  options: { ownerEmail: string; demoPassword?: string },
): Promise<ImportSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const summary = await write(client, course, options);
      await client.query("COMMIT");
      return summary;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function write(
  client: PoolClient,
  course: ImportCourse,
  options: { ownerEmail: string; demoPassword?: string },
): Promise<ImportSummary> {
  const id = (...parts: string[]) => uuidv5(parts.join(":"), PIAZZA_NAMESPACE);
  const courseId = id("course", course.piazzaId);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('piazza-import'), hashtext($1))",
    [courseId],
  );
  const owner = await client.query<{ id: string; organization_id: string }>(
    "SELECT id,organization_id FROM users WHERE email=$1 AND deleted_at IS NULL",
    [options.ownerEmail.trim().toLowerCase()],
  );
  if (!owner.rowCount)
    throw new Error(`No ChalkTalk account has the email ${options.ownerEmail}`);
  const ownerId = owner.rows[0]!.id;
  const organizationId = owner.rows[0]!.organization_id;

  const existingCourse = await client.query<{
    organization_id: string;
    name: string;
    join_code: string;
    status: string;
  }>("SELECT organization_id,name,join_code,status FROM courses WHERE id=$1", [
    courseId,
  ]);
  if (existingCourse.rowCount) {
    const row = existingCourse.rows[0]!;
    if (row.organization_id !== organizationId)
      throw new Error(
        "This Piazza class was already imported into another organization",
      );
    if (row.status === "deleting")
      throw new Error("The imported course is being deleted");
  } else {
    await client.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,$4,$5)",
      [courseId, organizationId, ownerId, course.name, joinCode()],
    );
  }
  const {
    rows: [courseRow],
  } = await client.query<{ name: string; join_code: string }>(
    "SELECT name,join_code FROM courses WHERE id=$1",
    [courseId],
  );

  // Logins for imported people are only usable with a demo password; otherwise
  // they share a hash of a secret that is discarded immediately.
  const passwordHash = await argon2.hash(
    options.demoPassword ?? randomBytes(32).toString("base64url"),
    { type: argon2.argon2id },
  );
  const users = new Map<string, string>();
  const roles = new Map<string, ImportRole>();
  const people: ImportSummary["people"] = [];
  const joined: string[] = [];
  const join = async (userId: string, role: ImportRole) => {
    const added = await client.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (course_id,user_id) DO NOTHING",
      [courseId, userId, role],
    );
    if (added.rowCount) joined.push(userId);
    const current = await client.query<{ role: ImportRole }>(
      "SELECT role FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [courseId, userId],
    );
    roles.set(userId, current.rows[0]!.role);
  };
  const ensurePerson = async (uid: string, name: string, role: ImportRole) => {
    const userId = id("user", organizationId, uid);
    const email = piazzaEmail(name, uid);
    const inserted = await client.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [userId, organizationId, email, name, passwordHash],
    );
    const existing = await client.query<{
      email: string;
      organization_id: string;
    }>("SELECT email,organization_id FROM users WHERE id=$1", [userId]);
    if (
      !existing.rowCount ||
      existing.rows[0]!.organization_id !== organizationId
    )
      throw new Error(
        `Imported account ${email} collides with an existing ChalkTalk user`,
      );
    if (!inserted.rowCount && options.demoPassword !== undefined)
      await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        userId,
        passwordHash,
      ]);
    await join(userId, role);
    people.push({
      name,
      email: existing.rows[0]!.email,
      role,
      created: Boolean(inserted.rowCount),
    });
    return userId;
  };

  await join(ownerId, "instructor");
  if (course.selfUid) users.set(course.selfUid, ownerId);
  const known = new Map(course.people.map((person) => [person.uid, person]));
  const referenced = new Set<string>(course.people.map((person) => person.uid));
  for (const post of course.posts) {
    const add = (uid: ImportAuthor) => uid && referenced.add(uid);
    add(post.author);
    for (const answer of post.answers) {
      answer.contributors.forEach(add);
      add(answer.endorsedBy);
      answer.helpfulFrom.forEach(add);
    }
    for (const followup of post.followups)
      for (const entry of [followup, ...followup.replies]) {
        add(entry.author);
        entry.goodFrom.forEach(add);
      }
  }
  for (const uid of referenced) {
    if (users.has(uid)) continue;
    const person = known.get(uid);
    users.set(
      uid,
      await ensurePerson(
        uid,
        person?.name ?? "Piazza user",
        person?.role ?? "student",
      ),
    );
  }
  let anonymousId: string | undefined;
  const userFor = async (author: ImportAuthor) => {
    if (author) return users.get(author)!;
    // Piazza hides anonymous authors from students; they share one placeholder.
    anonymousId ??= await ensurePerson(
      `anonymous-${course.piazzaId}`,
      ANONYMOUS_NAME,
      "student",
    );
    return anonymousId;
  };
  // Piazza history counts as already read for people who just joined.
  if (joined.length)
    await client.query(
      "INSERT INTO course_read_marks (course_id,user_id,read_before) SELECT $1,unnest($2::uuid[]),now() ON CONFLICT DO NOTHING",
      [courseId, joined],
    );

  const tagIds = new Map<string, string>();
  const tagFor = async (name: string) => {
    if (!tagIds.has(name)) {
      await client.query(
        "INSERT INTO tags (id,course_id,name) VALUES ($1,$2,$3) ON CONFLICT (course_id,name) DO NOTHING",
        [id("tag", course.piazzaId, name), courseId, name],
      );
      const tag = await client.query<{ id: string }>(
        "SELECT id FROM tags WHERE course_id=$1 AND name=$2",
        [courseId, name],
      );
      tagIds.set(name, tag.rows[0]!.id);
    }
    return tagIds.get(name)!;
  };

  const summary = { posts: counts(), answers: counts(), followups: counts() };
  for (const post of course.posts) {
    const postId = id("post", course.piazzaId, post.piazzaId);
    const authorId = await userFor(post.author);
    const created = await client.query<{ created_on: string }>(
      `INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,anonymous,private,pinned,created_at,updated_at,last_activity_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING
       RETURNING to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS created_on`,
      [
        postId,
        courseId,
        authorId,
        post.type,
        post.title,
        post.bodyMarkdown,
        post.anonymous,
        post.private,
        post.pinned,
        post.createdAt,
        post.updatedAt,
        post.lastActivityAt,
      ],
    );
    if (created.rowCount) {
      summary.posts.created++;
      if (post.type === "question")
        await client.query(
          "INSERT INTO question_creation_daily_counts(course_id,user_id,created_on,question_count) VALUES ($1,$2,$3,1) ON CONFLICT (course_id,user_id,created_on) DO UPDATE SET question_count=question_creation_daily_counts.question_count+1",
          [courseId, authorId, created.rows[0]!.created_on],
        );
      await client.query(
        "INSERT INTO post_follows (post_id,course_id,user_id,following) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING",
        [postId, courseId, authorId],
      );
    } else {
      const updated = await client.query(
        `UPDATE posts SET title=$2,body_markdown=$3,pinned=$4,updated_at=$5,
           last_activity_at=GREATEST(last_activity_at,$6),version=version+1
         WHERE id=$1 AND deleted_at IS NULL
           AND (title,body_markdown,pinned) IS DISTINCT FROM ($2,$3,$4)`,
        [
          postId,
          post.title,
          post.bodyMarkdown,
          post.pinned,
          post.updatedAt,
          post.lastActivityAt,
        ],
      );
      if (updated.rowCount) summary.posts.updated++;
      const live = await client.query(
        "SELECT 1 FROM posts WHERE id=$1 AND deleted_at IS NULL",
        [postId],
      );
      if (!live.rowCount) {
        summary.posts.skipped++;
        continue;
      }
    }
    for (const tag of post.tags)
      await client.query(
        "INSERT INTO post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [postId, await tagFor(tag)],
      );

    for (const answer of post.answers) {
      const answerId = id("answer", course.piazzaId, answer.piazzaId);
      const contributors: string[] = [];
      for (const author of answer.contributors) {
        const userId = await userFor(author);
        if (!contributors.includes(userId)) contributors.push(userId);
      }
      const creatorId = contributors[0]!;
      const endorserId = answer.endorsedBy
        ? users.get(answer.endorsedBy)!
        : null;
      const floor =
        answer.kind === "student"
          ? "student"
          : roles.get(creatorId) === "ta"
            ? "ta"
            : "instructor";
      const inserted = await client.query(
        `INSERT INTO answers (id,course_id,post_id,kind,body_markdown,anonymous,endorsed_at,endorsed_by_user_id,created_at,updated_at,created_by_user_id,edit_role_floor)
         VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::uuid IS NULL THEN NULL ELSE $9::timestamptz END,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [
          answerId,
          courseId,
          postId,
          answer.kind,
          answer.bodyMarkdown,
          answer.anonymous,
          endorserId,
          answer.createdAt,
          answer.updatedAt,
          creatorId,
          floor,
        ],
      );
      if (inserted.rowCount) {
        summary.answers.created++;
        for (const userId of contributors) {
          await client.query(
            "INSERT INTO answer_contributors (answer_id,user_id) VALUES ($1,$2)",
            [answerId, userId],
          );
          await client.query(
            "INSERT INTO answer_contribution_events(course_id,answer_id,user_id,contributed_at) VALUES ($1,$2,$3,$4)",
            [courseId, answerId, userId, answer.createdAt],
          );
        }
        if (endorserId)
          await client.query(
            "INSERT INTO answer_endorsement_events (course_id,answer_id,endorsed_by_user_id,endorsed_at) VALUES ($1,$2,$3,$4)",
            [courseId, answerId, endorserId, answer.updatedAt],
          );
      } else {
        const updated = await client.query(
          `UPDATE answers SET body_markdown=$2,updated_at=$3,version=version+1
           WHERE id=$1 AND deleted_at IS NULL AND body_markdown IS DISTINCT FROM $2`,
          [answerId, answer.bodyMarkdown, answer.updatedAt],
        );
        if (updated.rowCount) summary.answers.updated++;
        const live = await client.query(
          "SELECT endorsed_at FROM answers WHERE id=$1 AND deleted_at IS NULL",
          [answerId],
        );
        // Missing means deleted here, or ChalkTalk already has an answer of this kind.
        if (!live.rowCount) {
          summary.answers.skipped++;
          continue;
        }
        if (endorserId && !live.rows[0]!.endorsed_at) {
          await client.query(
            "UPDATE answers SET endorsed_at=$2,endorsed_by_user_id=$3,version=version+1 WHERE id=$1",
            [answerId, answer.updatedAt, endorserId],
          );
          await client.query(
            "INSERT INTO answer_endorsement_events (course_id,answer_id,endorsed_by_user_id,endorsed_at) VALUES ($1,$2,$3,$4)",
            [courseId, answerId, endorserId, answer.updatedAt],
          );
        }
      }
      for (const uid of answer.helpfulFrom)
        await client.query(
          "INSERT INTO answer_upvotes (answer_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [answerId, users.get(uid)],
        );
    }

    const writeFollowup = async (
      entry: Omit<ImportFollowup, "replies" | "resolved"> & {
        resolved?: boolean;
      },
      parentId: string | null,
      resolvedBy: string | null,
    ) => {
      const followupId = id("followup", course.piazzaId, entry.piazzaId);
      const authorId = await userFor(entry.author);
      const inserted = await client.query(
        `INSERT INTO followups (id,course_id,post_id,parent_followup_id,author_user_id,body_markdown,anonymous,created_at,updated_at,resolved_at,resolved_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10::uuid IS NULL THEN NULL ELSE $9::timestamptz END,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          followupId,
          courseId,
          postId,
          parentId,
          authorId,
          entry.bodyMarkdown,
          entry.anonymous,
          entry.createdAt,
          entry.updatedAt,
          resolvedBy,
        ],
      );
      if (inserted.rowCount) summary.followups.created++;
      else {
        const updated = await client.query(
          `UPDATE followups SET body_markdown=$2,updated_at=$3,version=version+1
           WHERE id=$1 AND deleted_at IS NULL AND body_markdown IS DISTINCT FROM $2`,
          [followupId, entry.bodyMarkdown, entry.updatedAt],
        );
        if (updated.rowCount) summary.followups.updated++;
        const live = await client.query(
          "SELECT 1 FROM followups WHERE id=$1 AND deleted_at IS NULL",
          [followupId],
        );
        if (!live.rowCount) {
          summary.followups.skipped++;
          return null;
        }
        if (resolvedBy)
          await client.query(
            "UPDATE followups SET resolved_at=$2,resolved_by_user_id=$3,version=version+1 WHERE id=$1 AND resolved_at IS NULL",
            [followupId, entry.updatedAt, resolvedBy],
          );
      }
      for (const uid of entry.goodFrom)
        await client.query(
          "INSERT INTO followup_upvotes (followup_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [followupId, users.get(uid)],
        );
      return followupId;
    };
    for (const followup of post.followups) {
      const lastReply = followup.replies.at(-1);
      const resolvedBy = followup.resolved
        ? await userFor(lastReply ? lastReply.author : followup.author)
        : null;
      const followupId = await writeFollowup(followup, null, resolvedBy);
      if (!followupId) continue;
      for (const reply of followup.replies)
        await writeFollowup(reply, followupId, null);
    }
  }

  return {
    courseId,
    courseName: courseRow!.name,
    joinCode: courseRow!.join_code.trim(),
    ...summary,
    people,
  };
}
