import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ThreadService } from "./service.js";

const courseId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const createdAt = new Date("2026-01-01T00:00:00.000Z");
const conversation = {
  id: conversationId,
  course_id: courseId,
  board_id: boardId,
  created_by_user_id: userId,
  version: 1,
  created_at: createdAt,
  updated_at: createdAt,
};
const opening = {
  id: "55555555-5555-4555-8555-555555555555",
  course_id: courseId,
  board_id: boardId,
  conversation_id: conversationId,
  ordinal: "1",
  author_user_id: userId,
  author_role_at_posting: "student",
  display_name: "Starter",
  body_markdown: "Looking for teammates",
  version: 1,
  created_at: createdAt,
  updated_at: createdAt,
  deleted_at: null,
};

function service(openingDisappears: boolean) {
  const pool = {
    async query(sql: string) {
      if (sql.includes("SELECT m.role,c.status"))
        return { rows: [{ role: "student", status: "active" }] };
      if (sql.includes("FROM thread_boards WHERE"))
        return { rows: [{ id: boardId }] };
      if (sql.includes("FROM thread_conversations WHERE"))
        return { rows: [conversation] };
      if (sql.includes("FROM thread_conversations c JOIN thread_boards"))
        return { rows: [conversation] };
      if (sql.includes("FROM thread_watches w")) return { rows: [] };
      if (sql.includes("FROM thread_messages m LEFT JOIN users"))
        return { rows: openingDisappears ? [] : [opening] };
      if (sql.includes("FROM thread_attachments WHERE")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
  return new ThreadService(pool);
}

describe("conversation reads during deletion", () => {
  it("omits a conversation removed before its opening message is loaded", async () => {
    const result = await service(true).listConversations(
      courseId,
      boardId,
      userId,
    );
    expect(result).toEqual({
      data: [],
      page: { hasMore: false, nextCursor: null },
    });
  });

  it("returns not found when a detail conversation disappears", async () => {
    await expect(
      service(true).getConversation(courseId, boardId, conversationId, userId),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("still returns an existing conversation on list and detail reads", async () => {
    const threads = service(false);
    const listed = await threads.listConversations(courseId, boardId, userId);
    const detail = await threads.getConversation(
      courseId,
      boardId,
      conversationId,
      userId,
    );
    expect(listed.data).toEqual([detail]);
    expect(detail).toMatchObject({
      id: conversationId,
      canDelete: true,
      openingMessage: { bodyMarkdown: "Looking for teammates" },
    });
  });
});
