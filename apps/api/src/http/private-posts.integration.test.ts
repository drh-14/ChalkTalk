import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { runMigrations, getMigrationDirectory } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { NotificationService } from "../notifications/service.js";
import { PostService } from "../posts/service.js";
import { assertPostVisible } from "../posts/visibility.js";
import {
  CollaborationSessionService,
  COLLABORATION_EVENTS_CHANNEL,
} from "../collaboration/service.js";
import { ContentAttachmentService } from "../content-attachments/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `private_posts_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831d5f",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12bca9",
  asker: "01a0e5cc-58ae-7009-9f43-c8155fb2359f",
  classmate: "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c",
  ta: "01a0e5cc-58ae-7009-9f43-ddd412c3880b",
  instructor: "01a0e5cc-58ae-7009-9f43-ea8bbebc2a38",
};
const names: Record<string, string> = {
  [ids.asker]: "Asker",
  [ids.classmate]: "Classmate",
  [ids.ta]: "Teaching Assistant",
  [ids.instructor]: "Instructor",
};
let admin: Pool;
let pool: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  ALLOWED_SCHOOL_DOMAINS: "example.edu",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const cookie = "__Host-chalktalk_session=opaque";
function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: "01a0e5cc-58af-7467-8ab1-740de2b8c8c3",
        user: {
          id: userId,
          email: "user@example.edu",
          displayName: names[userId]!,
          notificationEmails: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        expiresAt: "2026-12-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
    answerService: new AnswerService(pool),
    followupService: new FollowupService(pool),
    notificationService: new NotificationService(pool),
  });
}
const unsafe = (test: request.Test) =>
  test
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
async function create(userId: string, extra: object = {}) {
  return unsafe(
    request(app(userId)).post(`/api/v1/courses/${ids.course}/posts`),
  ).send({
    type: "question",
    title: "My grade on lab 3",
    bodyMarkdown: "Was problem 2 graded correctly?",
    private: true,
    ...extra,
  });
}
async function privateQuestion(extra: object = {}) {
  const created = await create(ids.asker, extra);
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}
const feed = async (userId: string, query = "") =>
  (
    await get(userId, `/api/v1/courses/${ids.course}/posts?limit=100${query}`)
  ).body.data.map((post: { id: string }) => post.id) as string[];

integration("private posts HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    for (const [key, id] of Object.entries(ids))
      if (!["organization", "course"].includes(key))
        await pool.query(
          "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
          [id, ids.organization, `${key}@example.edu`, names[id]],
        );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.organization, ids.instructor],
    );
    await pool.query(
      `INSERT INTO course_memberships (course_id,user_id,role) VALUES
       ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta'),($1,$5,'instructor')`,
      [ids.course, ids.asker, ids.classmate, ids.ta, ids.instructor],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("enforces the schema default and check", async () => {
    const postId = await privateQuestion();
    const row = await pool.query("SELECT private FROM posts WHERE id=$1", [
      postId,
    ]);
    expect(row.rows[0].private).toBe(true);
    await expect(
      pool.query("UPDATE posts SET type='poll' WHERE id=$1", [postId]),
    ).rejects.toThrow(/posts_(private|audience)_check/);
    const open = await create(ids.asker, { private: undefined });
    expect(open.body.data.private).toBe(false);
  });

  it("keeps legacy private-only inserts restricted", async () => {
    const postId = randomUUID();
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,private) VALUES($1,$2,$3,'question','Legacy private post','Restricted body',true)",
      [postId, ids.course, ids.asker],
    );
    const stored = await pool.query<{ audience: string; private: boolean }>(
      "SELECT audience,private FROM posts WHERE id=$1",
      [postId],
    );
    expect(stored.rows[0]).toEqual({ audience: "staff", private: true });
    expect((await get(ids.classmate, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );
    expect((await get(ids.ta, `/api/v1/posts/${postId}`)).status).toBe(200);
    expect((await get(ids.asker, `/api/v1/posts/${postId}`)).status).toBe(200);
  });

  it("shows a private post to its author and staff only", async () => {
    const postId = await privateQuestion();
    for (const userId of [ids.asker, ids.ta, ids.instructor]) {
      const read = await get(userId, `/api/v1/posts/${postId}`);
      expect(read.status).toBe(200);
      expect(read.body.data.private).toBe(true);
    }
    const hidden = await get(ids.classmate, `/api/v1/posts/${postId}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("not_found");
  });

  it("limits a selected-staff post to its author and named current staff", async () => {
    const created = await create(ids.asker, {
      private: undefined,
      audience: "selected_staff",
      staffRecipientIds: [ids.ta],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.audience).toBe("selected_staff");
    const postId = created.body.data.id as string;
    expect((await get(ids.asker, `/api/v1/posts/${postId}`)).status).toBe(200);
    expect((await get(ids.ta, `/api/v1/posts/${postId}`)).status).toBe(200);
    expect((await get(ids.instructor, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );
    expect(await feed(ids.instructor)).not.toContain(postId);
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.ta],
    );
    try {
      expect((await get(ids.ta, `/api/v1/posts/${postId}`)).status).toBe(404);
      expect(await feed(ids.ta)).not.toContain(postId);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.ta],
      );
    }
  });

  it("applies group membership immediately, even to a post's author", async () => {
    const group = await unsafe(
      request(app(ids.instructor)).post(
        `/api/v1/courses/${ids.course}/private-groups`,
      ),
    ).send({ name: "Project mentors", memberIds: [ids.asker, ids.ta] });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;
    const created = await create(ids.asker, {
      private: undefined,
      audience: "group",
      groupId,
    });
    expect(created.status).toBe(201);
    const postId = created.body.data.id as string;
    expect((await get(ids.ta, `/api/v1/posts/${postId}`)).status).toBe(200);
    expect((await get(ids.instructor, `/api/v1/posts/${postId}`)).status).toBe(
      404,
    );
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "For the group only" });
    expect(answered.status).toBe(201);
    const listener = await pool.connect();
    await listener.query(`LISTEN ${COLLABORATION_EVENTS_CHANNEL}`);
    const changed = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Access event not delivered")),
        3000,
      );
      listener.once("notification", (message) => {
        clearTimeout(timeout);
        resolve(JSON.parse(message.payload!));
      });
    });
    try {
      await unsafe(
        request(app(ids.instructor)).delete(
          `/api/v1/courses/${ids.course}/private-groups/${groupId}/members/${ids.asker}`,
        ),
      ).expect(204);
      expect(await changed).toMatchObject({
        type: "access_changed",
        courseId: ids.course,
        userIds: [ids.asker],
      });
    } finally {
      await listener.query(`UNLISTEN ${COLLABORATION_EVENTS_CHANNEL}`);
      listener.release();
    }
    expect((await get(ids.asker, `/api/v1/posts/${postId}`)).status).toBe(404);
    await unsafe(
      request(app(ids.asker)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(404);
    expect((await get(ids.asker, answered.headers.location)).status).toBe(404);
    expect(
      (await get(ids.asker, `/api/v1/posts/${postId}/answers`)).status,
    ).toBe(404);
    const notifications = await get(
      ids.asker,
      "/api/v1/users/me/notifications",
    );
    expect(notifications.status).toBe(200);
    expect(
      notifications.body.data.map((item: { postId: string }) => item.postId),
    ).not.toContain(postId);
    expect((await get(ids.ta, `/api/v1/posts/${postId}`)).status).toBe(200);
    await unsafe(
      request(app(ids.instructor)).delete(
        `/api/v1/courses/${ids.course}/private-groups/${groupId}`,
      ),
    ).expect(409);
  });

  it("holds audience grants through a visibility-checked write transaction", async () => {
    const group = await unsafe(
      request(app(ids.instructor)).post(
        `/api/v1/courses/${ids.course}/private-groups`,
      ),
    ).send({ name: "Write race group", memberIds: [ids.asker] });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;
    const groupPost = await create(ids.asker, {
      private: undefined,
      audience: "group",
      groupId,
    });
    expect(groupPost.status).toBe(201);
    const staffPost = await create(ids.asker, {
      private: undefined,
      audience: "selected_staff",
      staffRecipientIds: [ids.ta],
    });
    expect(staffPost.status).toBe(201);

    for (const scenario of [
      {
        postId: groupPost.body.data.id as string,
        viewerId: ids.asker,
        revoke:
          "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
        params: [groupId, ids.asker],
      },
      {
        postId: staffPost.body.data.id as string,
        viewerId: ids.ta,
        revoke:
          "DELETE FROM post_staff_recipients WHERE post_id=$1 AND user_id=$2",
        params: [staffPost.body.data.id as string, ids.ta],
      },
    ]) {
      const writer = await pool.connect();
      const revoker = await pool.connect();
      try {
        await writer.query("BEGIN");
        await assertPostVisible(writer, scenario.postId, scenario.viewerId);
        await revoker.query("BEGIN");
        await revoker.query("SET LOCAL lock_timeout = '100ms'");
        await expect(
          revoker.query(scenario.revoke, scenario.params),
        ).rejects.toMatchObject({ code: "55P03" });
        await revoker.query("ROLLBACK");
        await writer.query("UPDATE posts SET updated_at=now() WHERE id=$1", [
          scenario.postId,
        ]);
        await writer.query("COMMIT");
        await pool.query(scenario.revoke, scenario.params);
        expect(
          (await get(scenario.viewerId, `/api/v1/posts/${scenario.postId}`))
            .status,
        ).toBe(404);
      } finally {
        await writer.query("ROLLBACK");
        await revoker.query("ROLLBACK");
        writer.release();
        revoker.release();
      }
    }
  });

  it("restricts group administration and validates exclusive audiences", async () => {
    const groupPath = `/api/v1/courses/${ids.course}/private-groups`;
    const denied = await unsafe(request(app(ids.asker)).post(groupPath)).send({
      name: "Student made",
      memberIds: [ids.asker],
    });
    expect(denied.status).toBe(403);
    const group = await unsafe(
      request(app(ids.instructor)).post(groupPath),
    ).send({ name: "  Graders  ", memberIds: [ids.ta] });
    expect(group.status).toBe(201);
    expect(group.body.data).toEqual({
      id: expect.any(String),
      name: "Graders",
      joined: false,
      memberIds: [ids.ta],
    });
    const listed = await get(ids.instructor, groupPath);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toContainEqual(group.body.data);
    const duplicate = await unsafe(request(app(ids.ta)).post(groupPath)).send({
      name: "graders",
      memberIds: [],
    });
    expect(duplicate.status).toBe(409);
    const groupId = group.body.data.id as string;
    expect(
      (
        await create(ids.asker, {
          private: undefined,
          audience: "group",
          groupId,
        })
      ).status,
    ).toBe(422);
    expect(
      (await create(ids.asker, { private: true, audience: "class" })).status,
    ).toBe(422);
    expect(
      (
        await create(ids.asker, {
          private: undefined,
          audience: "selected_staff",
          staffRecipientIds: [ids.classmate],
        })
      ).status,
    ).toBe(422);
    const renamed = await unsafe(
      request(app(ids.ta)).patch(`${groupPath}/${groupId}`),
    ).send({ name: "Reviewers" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toEqual({
      id: groupId,
      name: "Reviewers",
      joined: true,
      memberIds: [ids.ta],
    });
    const empty = await unsafe(
      request(app(ids.instructor)).post(groupPath),
    ).send({ name: "Empty group", memberIds: [] });
    expect(empty.status).toBe(201);
    expect(empty.body.data).toEqual({
      id: expect.any(String),
      name: "Empty group",
      joined: false,
      memberIds: [],
    });
    expect((await get(ids.instructor, groupPath)).body.data).toContainEqual(
      empty.body.data,
    );
    expect((await get(ids.asker, groupPath)).body.data).toEqual([]);
  });

  it("serializes role changes with private group listing", async () => {
    const groupPath = `/api/v1/courses/${ids.course}/private-groups`;
    const joined = await unsafe(
      request(app(ids.instructor)).post(groupPath),
    ).send({ name: "Role change joined", memberIds: [ids.ta] });
    expect(joined.status).toBe(201);
    const unjoined = await unsafe(
      request(app(ids.instructor)).post(groupPath),
    ).send({ name: "Role change unjoined", memberIds: [ids.asker] });
    expect(unjoined.status).toBe(201);

    let queries = 0;
    let demotion: Promise<unknown> | undefined;
    const racedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (statement: string, values?: unknown[]) => {
            const result = await client.query(statement, values);
            if (++queries === 2)
              demotion = pool.query(
                "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
                [ids.course, ids.ta],
              );
            return result;
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    try {
      const groups = await new PostService(racedPool).listPrivateGroups(
        ids.course,
        ids.ta,
      );
      expect(groups).toContainEqual({
        id: joined.body.data.id,
        name: "Role change joined",
        joined: true,
        memberIds: [ids.ta],
      });
      expect(groups.map((group) => group.id)).toContain(unjoined.body.data.id);
      await demotion;
      const after = await new PostService(pool).listPrivateGroups(
        ids.course,
        ids.ta,
      );
      expect(after).toContainEqual({
        id: joined.body.data.id,
        name: "Role change joined",
        joined: true,
      });
      expect(after.map((group) => group.id)).not.toContain(
        unjoined.body.data.id,
      );
      expect(after.every((group) => !("memberIds" in group))).toBe(true);
    } finally {
      await demotion;
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.ta],
      );
    }
  });

  it("does not return anonymous author-filter results after staff demotion", async () => {
    const created = await create(ids.instructor, {
      private: undefined,
      anonymous: true,
      title: "Anonymous author filter race",
    });
    expect(created.status).toBe(201);
    for (const filter of [
      { authorId: ids.instructor },
      { authorRole: "instructor" as const },
    ]) {
      let queries = 0;
      const racedPool = {
        query: async (statement: string, values?: unknown[]) => {
          const result = await pool.query(statement, values);
          if (++queries === 2)
            await pool.query(
              "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
              [ids.course, ids.ta],
            );
          return result;
        },
        connect: () => pool.connect(),
      } as unknown as Pool;
      try {
        await expect(
          new PostService(racedPool).list(ids.course, ids.ta, {
            sort: "newest",
            limit: 25,
            ...filter,
          }),
        ).rejects.toMatchObject({
          status: 409,
          code: "search_restart_required",
        });
      } finally {
        await pool.query(
          "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
          [ids.course, ids.ta],
        );
      }
    }
  });

  it("rejects deletion when a concurrent group post commits", async () => {
    const groupPath = `/api/v1/courses/${ids.course}/private-groups`;
    const group = await unsafe(request(app(ids.instructor)).post(groupPath))
      .send({ name: "Concurrent group", memberIds: [ids.asker] })
      .expect(201);
    const groupId = group.body.data.id as string;
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT 1 FROM private_post_groups WHERE id=$1 FOR SHARE",
        [groupId],
      );
      await client.query(
        `INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown,audience,audience_group_id)
         VALUES ($1,$2,$3,'question','Concurrent post','Body','group',$4)`,
        [
          "01a0e5cc-58ae-7009-9f43-aaaaaaaaaaaa",
          ids.course,
          ids.asker,
          groupId,
        ],
      );
      const deleting = unsafe(
        request(app(ids.instructor)).delete(`${groupPath}/${groupId}`),
      ).then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await client.query("COMMIT");
      committed = true;
      const response = await deleting;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("group_in_use");
    } finally {
      if (!committed) await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not replay a group creation response after its author loses membership", async () => {
    const group = await unsafe(
      request(app(ids.instructor)).post(
        `/api/v1/courses/${ids.course}/private-groups`,
      ),
    )
      .send({ name: "Replay group", memberIds: [ids.asker] })
      .expect(201);
    const body = {
      type: "question",
      title: "Private replay",
      bodyMarkdown: "Only for this group",
      audience: "group",
      groupId: group.body.data.id,
    };
    const first = await unsafe(
      request(app(ids.asker)).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .set("Idempotency-Key", "group-replay-key")
      .send(body);
    expect(first.status).toBe(201);
    await unsafe(
      request(app(ids.instructor)).delete(
        `/api/v1/courses/${ids.course}/private-groups/${group.body.data.id}/members/${ids.asker}`,
      ),
    ).expect(204);
    const replay = await unsafe(
      request(app(ids.asker)).post(`/api/v1/courses/${ids.course}/posts`),
    )
      .set("Idempotency-Key", "group-replay-key")
      .send(body);
    expect(replay.status).toBe(404);
    expect(replay.body.error.code).toBe("not_found");
  });

  it("rejects private announcements, private polls, and non-boolean values", async () => {
    const announcement = await create(ids.instructor, {
      type: "note",
      announcement: true,
    });
    expect(announcement.status).toBe(422);
    expect(announcement.body.error.code).toBe("private_announcement");
    const poll = await create(ids.instructor, {
      type: "poll",
      options: [{ label: "Yes" }, { label: "No" }],
    });
    expect(poll.status).toBe(422);
    expect(poll.body.error.code).toBe("private_poll");
    const invalid = await create(ids.asker, { private: "yes" });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("validation_failed");
  });

  it("lists, searches, and filters private posts only for those who can read them", async () => {
    const postId = await privateQuestion({ title: "Zebra regrade request" });
    expect(await feed(ids.classmate)).not.toContain(postId);
    expect(await feed(ids.asker)).toContain(postId);
    expect(await feed(ids.ta)).toContain(postId);
    expect(await feed(ids.classmate, "&q=zebra")).not.toContain(postId);
    expect(await feed(ids.instructor, "&q=zebra")).toContain(postId);
    // Fuzzy matching runs through a separate candidate query.
    expect(await feed(ids.classmate, "&q=zebr")).not.toContain(postId);

    const mine = await feed(ids.asker, "&private=true");
    expect(mine).toContain(postId);
    const openId = (await create(ids.classmate, { private: false })).body.data
      .id;
    expect(await feed(ids.ta, "&private=true")).not.toContain(openId);
    expect(await feed(ids.classmate, "&private=true")).toEqual([]);
    for (const value of ["false", "1"])
      expect(
        (
          await get(
            ids.asker,
            `/api/v1/courses/${ids.course}/posts?private=${value}`,
          )
        ).status,
      ).toBe(400);
  });

  it("hides answers, followups, replies, upvotes, follows, and edits from classmates", async () => {
    const postId = await privateQuestion();
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "We will regrade it." });
    expect(answered.status).toBe(201);
    const followup = await unsafe(
      request(app(ids.asker)).post(`/api/v1/posts/${postId}/followups`),
    ).send({ bodyMarkdown: "Thanks!" });
    expect(followup.status).toBe(201);
    const reply = await unsafe(
      request(app(ids.instructor)).post(`${followup.headers.location}/replies`),
    ).send({ bodyMarkdown: "You're welcome." });
    expect(reply.status).toBe(201);

    const reads = [
      `/api/v1/posts/${postId}/answers`,
      answered.headers.location,
      `/api/v1/posts/${postId}/followups`,
      followup.headers.location,
      `${followup.headers.location}/replies`,
    ];
    for (const path of reads) {
      expect((await get(ids.classmate, path)).status, path).toBe(404);
      expect((await get(ids.asker, path)).status, path).toBe(200);
    }
    const writes = [
      unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${postId}/answers`),
      ).send({
        bodyMarkdown: "Me too",
      }),
      unsafe(
        request(app(ids.classmate)).post(`/api/v1/posts/${postId}/followups`),
      ).send({ bodyMarkdown: "Me too" }),
      unsafe(
        request(app(ids.classmate)).put(`${answered.headers.location}/upvote`),
      ),
      unsafe(
        request(app(ids.classmate)).put(`${followup.headers.location}/upvote`),
      ),
      unsafe(request(app(ids.classmate)).put(`/api/v1/posts/${postId}/follow`)),
      unsafe(request(app(ids.classmate)).patch(`/api/v1/posts/${postId}`))
        .set("If-Match", '"v1"')
        .send({ title: "Mine now" }),
      unsafe(request(app(ids.classmate)).delete(`/api/v1/posts/${postId}`)).set(
        "If-Match",
        '"v1"',
      ),
    ];
    for (const write of writes) expect((await write).status).toBe(404);
  });

  it("hides attachments on a private post and its answers", async () => {
    const postId = await privateQuestion();
    const answered = await unsafe(
      request(app(ids.ta)).post(`/api/v1/posts/${postId}/answers`),
    ).send({ bodyMarkdown: "See attached." });
    const s3 = { send: async () => ({ Body: "file" }) } as unknown as S3Client;
    const attachments = new ContentAttachmentService(pool, s3, "bucket");
    for (const [column, parent] of [
      ["post_id", postId],
      ["answer_id", answered.body.data.id],
    ]) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO content_attachments (id,course_id,${column},object_key,file_name,media_type,size_bytes,checksum_sha256)
         VALUES (gen_random_uuid(),$1,$2,gen_random_uuid()::text,'notes.txt','text/plain',4,decode(repeat('00',32),'hex')) RETURNING id`,
        [ids.course, parent],
      );
      const id = inserted.rows[0]!.id;
      const kind = column === "post_id" ? "post" : "answer";
      await expect(
        attachments.authorizeUpload(kind, parent, ids.classmate),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        attachments.authorizeUpload(kind, parent, ids.instructor),
      ).resolves.toBeUndefined();
      await expect(
        attachments.download(id, ids.classmate),
      ).rejects.toMatchObject({ status: 404 });
      await expect(attachments.download(id, ids.asker)).resolves.toMatchObject({
        name: "notes.txt",
      });
      await expect(attachments.download(id, ids.ta)).resolves.toMatchObject({
        name: "notes.txt",
      });
    }
  });

  it("rejects attachment deletion when its audience grant is revoked", async () => {
    const group = await unsafe(
      request(app(ids.instructor)).post(
        `/api/v1/courses/${ids.course}/private-groups`,
      ),
    ).send({ name: "Attachment race group", memberIds: [ids.asker] });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;
    const created = await create(ids.asker, {
      private: undefined,
      audience: "group",
      groupId,
    });
    expect(created.status).toBe(201);
    const postId = created.body.data.id as string;
    const attachmentId = randomUUID();
    await pool.query(
      `INSERT INTO content_attachments (id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256)
       VALUES ($1,$2,$3,$4,'group.txt','text/plain',4,decode(repeat('00',32),'hex'))`,
      [attachmentId, ids.course, postId, randomUUID()],
    );
    const attachments = new ContentAttachmentService(
      pool,
      { send: async () => undefined } as unknown as S3Client,
      "bucket",
    );
    const revoker = await pool.connect();
    try {
      await revoker.query("BEGIN");
      await revoker.query(
        "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
        [groupId, ids.asker],
      );
      const deletion = attachments.delete(attachmentId, ids.asker).then(
        () => ({ status: 204 }),
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await revoker.query("COMMIT");
      expect(await deletion).toMatchObject({ status: 404 });
      const stored = await pool.query(
        "SELECT deleted_at FROM content_attachments WHERE id=$1",
        [attachmentId],
      );
      expect(stored.rows[0].deleted_at).toBeNull();
    } finally {
      await revoker.query("ROLLBACK");
      revoker.release();
    }
  });

  it("limits live sessions on a private post to people who can read it", async () => {
    const postId = await privateQuestion();
    const sessions = new CollaborationSessionService(pool, {
      webSocketUrl: "wss://app.example.edu/collaboration",
    });
    await expect(
      sessions.create(ids.course, ids.classmate, {
        postId,
        language: "python",
      }),
    ).rejects.toMatchObject({ status: 422, code: "cross_course_anchor" });
    const session = await sessions.create(ids.course, ids.asker, {
      postId,
      language: "python",
    });
    const sessionId = session.value.id;
    await expect(
      sessions.invite(sessionId, ids.asker, ids.classmate),
    ).rejects.toMatchObject({ status: 422, code: "invitee_cannot_read_post" });
    await expect(
      sessions.invite(sessionId, ids.asker, ids.ta),
    ).resolves.toBeDefined();
    // A classmate added behind the service's back still cannot reach it.
    await pool.query(
      "INSERT INTO collaboration_participants (collaboration_session_id,course_id,user_id,invited_by_user_id,permission) VALUES ($1,$2,$3,$4,'edit')",
      [sessionId, ids.course, ids.classmate, ids.asker],
    );
    await expect(sessions.get(sessionId, ids.classmate)).rejects.toMatchObject({
      status: 404,
    });
    const listed = await sessions.list(ids.course, ids.classmate, {
      limit: 25,
    });
    expect(listed.data.map((item) => item.id)).not.toContain(sessionId);
    const mine = await sessions.listForUser(ids.classmate, { limit: 25 });
    expect(mine.data.map((item) => item.id)).not.toContain(sessionId);
  });

  it("notifies only members who can still read the post", async () => {
    const postId = await privateQuestion();
    await unsafe(
      request(app(ids.ta)).put(`/api/v1/posts/${postId}/follow`),
    ).expect(200);
    // A TA demoted to student loses access along with their notifications.
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.ta],
    );
    try {
      await unsafe(
        request(app(ids.instructor)).post(`/api/v1/posts/${postId}/answers`),
      ).send({ bodyMarkdown: "Answer" });
      const recipients = await pool.query(
        "SELECT user_id FROM notifications WHERE post_id=$1",
        [postId],
      );
      expect(recipients.rows.map((row) => row.user_id)).toEqual([ids.asker]);
      await pool.query(
        "INSERT INTO notifications (id,user_id,course_id,post_id,kind,actor_user_id) VALUES (gen_random_uuid(),$1,$2,$3,'answer_created',$4)",
        [ids.ta, ids.course, postId, ids.instructor],
      );
      const inbox = await get(ids.ta, "/api/v1/users/me/notifications");
      expect(
        inbox.body.data.map((item: { postId: string }) => item.postId),
      ).not.toContain(postId);
      expect(
        (await get(ids.ta, "/api/v1/users/me/notifications/unread-count")).body
          .data.count,
      ).toBe(0);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.ta],
      );
      await pool.query("DELETE FROM notifications");
    }
  });

  it("lets staff make a private post public, keeping anonymity and notifying the author", async () => {
    const postId = await privateQuestion({ anonymous: true });
    const before = await get(ids.ta, `/api/v1/posts/${postId}`);
    const published = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", before.headers.etag)
      .send({ private: false });
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({
      private: false,
      anonymous: true,
      version: before.body.data.version + 1,
    });
    expect(Date.parse(published.body.data.lastActivityAt)).toBeGreaterThan(
      Date.parse(before.body.data.lastActivityAt),
    );
    const seen = await get(ids.classmate, `/api/v1/posts/${postId}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.author.displayName).toBe("Anonymous");
    expect(await feed(ids.classmate)).toContain(postId);
    const inbox = await get(ids.asker, "/api/v1/users/me/notifications");
    expect(inbox.body.data[0]).toMatchObject({
      kind: "post_published",
      postId,
      actor: { displayName: "Teaching Assistant" },
    });

    // It cannot go back, and repeating private:false is harmless.
    const back = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", published.headers.etag)
      .send({ private: true });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe("post_already_public");
    await pool.query("DELETE FROM notifications");
  });

  it("lets the author publish without notifying themselves, and ignores private:true on a private post", async () => {
    const postId = await privateQuestion();
    const kept = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", '"v1"')
      .send({ private: true });
    expect(kept.status).toBe(200);
    expect(kept.body.data.private).toBe(true);
    const published = await unsafe(
      request(app(ids.asker)).patch(`/api/v1/posts/${postId}`),
    )
      .set("If-Match", kept.headers.etag)
      .send({ private: false });
    expect(published.body.data.private).toBe(false);
    const notified = await pool.query(
      "SELECT 1 FROM notifications WHERE post_id=$1",
      [postId],
    );
    expect(notified.rowCount).toBe(0);
  });

  it("never merges a post into a private post", async () => {
    const privateId = await privateQuestion();
    const publicId = (await create(ids.classmate, { private: false })).body.data
      .id;
    const merge = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${publicId}`),
    )
      .set("If-Match", '"v1"')
      .send({ duplicateOfPostId: privateId, duplicateStatus: "confirmed" });
    expect(merge.status).toBe(422);
    expect(merge.body.error.code).toBe("duplicate_target_private");
    const reverse = await unsafe(
      request(app(ids.ta)).patch(`/api/v1/posts/${privateId}`),
    )
      .set("If-Match", '"v1"')
      .send({ duplicateOfPostId: publicId, duplicateStatus: "suggested" });
    expect(reverse.status).toBe(200);
  });
});
