import { describe, expect, it } from "vitest";
import { canReadPost, readablePost } from "./visibility.js";

const author = "author";
describe("post visibility", () => {
  it("lets everyone read public posts", () => {
    for (const role of ["student", "ta", "instructor"])
      expect(
        canReadPost({ private: false, author_user_id: author }, "other", role),
      ).toBe(true);
  });

  it("limits private posts to the author and staff", () => {
    const post = { private: true, author_user_id: author };
    expect(canReadPost(post, author, "student")).toBe(true);
    expect(canReadPost(post, "other", "student")).toBe(false);
    expect(canReadPost(post, "other", "ta")).toBe(true);
    expect(canReadPost(post, "other", "instructor")).toBe(true);
    // A deleted private post keeps no author, so only staff still see it.
    expect(
      canReadPost({ private: true, author_user_id: null }, author, "student"),
    ).toBe(false);
  });

  it("builds the same rule in SQL", () => {
    expect(readablePost("p", "$2", "m.role")).toBe(
      "(NOT p.private OR p.author_user_id = $2 OR m.role IN ('ta','instructor'))",
    );
  });
});
