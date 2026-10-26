import { describe, expect, it, vi } from "vitest";

vi.mock("node:worker_threads", () => ({
  Worker: class {
    constructor() {
      throw new Error("worker creation refused");
    }
  },
}));

import { renderDigest } from "./render.js";

describe("digest equation worker startup", () => {
  it("links an unrenderable equation without aborting the digest", async () => {
    const result = await renderDigest({
      courseName: "Calculus",
      activityDate: "2026-10-20",
      courseUrl: "https://example.edu/course",
      counts: { post: 1, answer: 0, followup: 0 },
      items: [
        {
          title: "Question",
          url: "https://example.edu/post",
          body: "Before $x^2$ after",
        },
      ],
    });
    expect(result.html).toContain(
      'href="https://example.edu/post">View equation</a>',
    );
    expect(result.html).toContain("after");
    expect(result.attachments).toHaveLength(0);
    expect(result.text).toContain("x^2");
  });
});
