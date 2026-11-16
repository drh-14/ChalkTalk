import { describe, expect, it } from "vitest";
import { piazzaFixture } from "./fixture.js";
import { parsePiazzaUpload } from "./upload.js";

describe("CLI Piazza JSON upload boundary", () => {
  it("accepts CLI output and omits private posts and private-only people", () => {
    const source = piazzaFixture();
    source.users.push({
      id: "private-only",
      name: "Private Person",
      role: "student",
    });
    source.users.push({
      id: "ignored-child",
      name: "Ignored Person",
      role: "student",
    });
    source.users.push({ id: "inactive-only", name: "Inactive", role: "student" });
    source.users.push({ id: "empty-only", name: "Empty", role: "student" });
    source.posts[0]!.children!.push({
      id: "ignored-1",
      type: "unknown",
      uid: "ignored-child",
      created: "2026-01-01T00:00:00Z",
    });
    source.posts.find((post) => post.status === "private")!.history[0]!.uid =
      "private-only";
    source.posts.find((post) => post.status === "deleted")!.history[0]!.uid =
      "inactive-only";
    source.posts.push({
      id: "empty-history",
      type: "question",
      status: "active",
      created: "2026-01-01T00:00:00Z",
      history: [],
      children: [
        {
          id: "empty-child",
          type: "followup",
          uid: "empty-only",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const result = parsePiazzaUpload(JSON.stringify(source));
    expect(result.omittedPrivatePosts).toBe(1);
    expect(result.data.posts.some((post) => post.status === "private")).toBe(
      false,
    );
    expect(result.data.users.some((user) => user.id === "private-only")).toBe(
      false,
    );
    expect(result.data.users.some((user) => user.id === "ignored-child")).toBe(
      false,
    );
    expect(result.data.users.some((user) => user.id === "inactive-only")).toBe(
      false,
    );
    expect(result.data.users.some((user) => user.id === "empty-only")).toBe(
      false,
    );
    expect(result.data.posts.some((post) => post.id === "p2")).toBe(true);
    expect(result.data.users.some((user) => user.id === "prof1")).toBe(true);
  });

  it.each(["not JSON", "{}", '{"network":{"id":"x","name":"X"},"posts":{}}'])(
    "rejects malformed or incompatible input: %s",
    (source) => expect(() => parsePiazzaUpload(source)).toThrow(),
  );

  it("rejects an excessive nested child depth before conversion", () => {
    const source = piazzaFixture();
    let children = source.posts[0]!.children!;
    for (let index = 0; index < 12; index++) {
      const child = {
        id: `nested-${index}`,
        type: "feedback",
        created: "2026-01-01T00:00:00Z",
        children: [],
      };
      children.push(child);
      children = child.children;
    }
    expect(() => parsePiazzaUpload(JSON.stringify(source))).toThrow();
  });

  it.each(["i_answer", "followup", "feedback"])(
    "rejects an invalid %s updated timestamp",
    (type) => {
      const source = piazzaFixture();
      const child =
        type === "feedback"
          ? source.posts[1]!.children!.find(
              (item) => item.type === "followup",
            )!.children![0]!
          : source.posts[1]!.children!.find((item) => item.type === type)!;
      child.updated = "not-a-date";
      expect(() => parsePiazzaUpload(JSON.stringify(source))).toThrowError(
        expect.objectContaining({ status: 422 }),
      );
    },
  );

  it("rejects numeric pin flags outside the CLI export contract", () => {
    const source = piazzaFixture() as unknown as {
      posts: Array<Record<string, unknown>>;
    };
    source.posts[0]!.pinned = 1;
    expect(() => parsePiazzaUpload(JSON.stringify(source))).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
  });
});
