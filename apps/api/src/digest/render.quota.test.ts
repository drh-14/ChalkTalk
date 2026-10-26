import { expect, it, vi } from "vitest";

const renderEquation = vi.hoisted(() =>
  vi.fn(async (source: string) =>
    source === "\\a" ? undefined : Buffer.alloc(200 * 1024),
  ),
);
vi.mock("./math.js", () => ({ renderEquation }));

import { renderDigest } from "./render.js";

it("refunds removed equation bytes without refunding render attempts", async () => {
  const result = await renderDigest({
    courseName: "Calculus",
    activityDate: "2026-10-20",
    courseUrl: "https://app.example.edu/course",
    counts: { post: 2, answer: 0, followup: 0 },
    items: [
      {
        title: "First",
        url: "https://app.example.edu/first",
        body: "x".repeat(587) + "$\\a$ $x$",
      },
      {
        title: "Later",
        url: "https://app.example.edu/later",
        body: "$x$ ".repeat(5),
      },
    ],
  });
  expect(renderEquation).toHaveBeenCalledTimes(7);
  expect(result.attachments).toHaveLength(5);
  expect(
    result.attachments.reduce((sum, image) => sum + image.content.length, 0),
  ).toBe(1000 * 1024);
  for (const image of result.attachments)
    expect(result.html).toContain(`cid:${image.cid}`);
  const articles = result.html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g)!;
  expect(articles[1]).not.toContain("View equation</a>");
});
