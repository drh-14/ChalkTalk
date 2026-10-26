import { describe, expect, it } from "vitest";
import {
  convertExport,
  decodeEntities,
  importRole,
  toMarkdown,
} from "./convert.js";
import { piazzaFixture } from "./fixture.js";

describe("Piazza conversion", () => {
  const course = convertExport(piazzaFixture());
  const post = (id: string) => course.posts.find((p) => p.piazzaId === id)!;

  it("names the course and maps roles", () => {
    expect(course.name).toBe("CSE 416 Software Engineering");
    expect(course.people.map((p) => p.role)).toEqual([
      "instructor",
      "ta",
      "student",
      "student",
    ]);
    expect(importRole(undefined)).toBe("student");
    expect(importRole("")).toBe("student");
  });

  it("skips deleted posts and orders the rest by creation", () => {
    expect(course.posts.map((p) => p.piazzaId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("converts HTML to Markdown, keeps Piazza math, and escapes other dollars", () => {
    expect(post("p1").title).toBe("Welcome & syllabus");
    expect(post("p1").bodyMarkdown).toBe(
      "Read the [syllabus](https://piazza.com/class_profile/get_resource/net1/x). It costs \\$5.",
    );
    expect(post("p2").bodyMarkdown).toBe(
      "Edited: why is it **quadratic** for $$n_1$$?",
    );
    expect(post("p4").bodyMarkdown).toBe("**My** grade");
    expect(toMarkdown("")).toBe("(empty)");
    expect(decodeEntities("&#39;a&#x27;&lt;")).toBe("'a'<");
  });

  it("uses the newest version for content and the oldest for the author", () => {
    const question = post("p2");
    expect(question.title).toBe("How does $$O(n^2)$$ arise?");
    expect(question.author).toBeNull();
    expect(question.anonymous).toBe(true);
    expect(question.createdAt).toBe("2026-09-02T10:00:00Z");
    expect(question.updatedAt).toBe("2026-09-02T11:00:00Z");
    expect(question.lastActivityAt).toBe("2026-09-04T09:00:00Z");
    expect(question.tags).toEqual(["hw1", "exam"]);
  });

  it("maps answers, endorsements and helpful marks", () => {
    const [student, staff] = post("p2").answers;
    expect(student).toMatchObject({
      kind: "student",
      contributors: ["stu1"],
      endorsedBy: "prof1",
      helpfulFrom: ["me1"],
    });
    expect(staff).toMatchObject({
      kind: "staff",
      contributors: ["ta1", "prof1"],
      bodyMarkdown: "Two loops over n, edited.",
      endorsedBy: null,
    });
  });

  it("maps followups, replies and resolution", () => {
    const [resolved, open] = post("p2").followups;
    expect(resolved).toMatchObject({
      author: "me1",
      resolved: true,
      goodFrom: ["stu1"],
    });
    expect(resolved!.replies).toMatchObject([
      { author: "ta1", bodyMarkdown: "Cubic." },
    ]);
    expect(open).toMatchObject({
      author: null,
      anonymous: true,
      resolved: false,
    });
  });

  it("imports polls as notes and private posts as private", () => {
    expect(post("p3").type).toBe("note");
    expect(post("p3").bodyMarkdown).toContain("Imported from a Piazza poll");
    expect(post("p4").private).toBe(true);
  });
});
