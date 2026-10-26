import { expect, it } from "vitest";
import type { Post } from "./client.js";
import { postTypeOf } from "./types.js";

it.each([
  ["multiple", 0, "0 ballots"],
  ["multiple", 1, "1 ballot"],
  ["multiple", 2, "2 ballots"],
  ["single", 0, "0 votes"],
  ["single", 1, "1 vote"],
  ["single", 2, "2 votes"],
] as const)(
  "labels %s poll totals of %i as %s",
  (selectionMode, totalVotes, expected) => {
    const post = { type: "poll", selectionMode, totalVotes } as Post;
    expect(postTypeOf(post.type).extras?.(post)).toBe(expected);
  },
);

it("omits the feed total when poll results are hidden", () => {
  const post = { type: "poll", selectionMode: "multiple" } as Post;
  expect(postTypeOf(post.type).extras?.(post)).toBeUndefined();
});
