import { describe, expect, it } from "vitest";
import { canReadPost, readablePost } from "./visibility.js";

const author = "author";
const post = (overrides: object = {}) => ({
  private: false,
  author_user_id: author,
  scheduled_for: null,
  ...overrides,
});
describe("post visibility", () => {
  it("lets everyone read public posts", () => {
    for (const role of ["student", "ta", "instructor"])
      expect(canReadPost(post(), "other", role)).toBe(true);
  });

  it("limits private posts to the author and staff", () => {
    const hidden = post({ private: true });
    expect(canReadPost(hidden, author, "student")).toBe(true);
    expect(canReadPost(hidden, "other", "student")).toBe(false);
    expect(canReadPost(hidden, "other", "ta")).toBe(true);
    expect(canReadPost(hidden, "other", "instructor")).toBe(true);
    // A deleted private post keeps no author, so only staff still see it.
    expect(
      canReadPost(
        post({ private: true, author_user_id: null }),
        author,
        "student",
      ),
    ).toBe(false);
  });

  it("limits scheduled announcements to staff, including the author's classmates", () => {
    const scheduled = post({ scheduled_for: new Date("2026-12-01T09:00:00Z") });
    expect(canReadPost(scheduled, "other", "student")).toBe(false);
    expect(canReadPost(scheduled, author, "student")).toBe(false);
    expect(canReadPost(scheduled, "other", "ta")).toBe(true);
    expect(canReadPost(scheduled, "other", "instructor")).toBe(true);
  });

  it("builds the same rule in SQL", () => {
    expect(readablePost("p", "$2", "m.role")).toBe(
      "(m.role IN ('ta','instructor') OR (p.scheduled_for IS NULL AND (NOT p.private OR p.author_user_id = $2)))",
    );
  });
});
