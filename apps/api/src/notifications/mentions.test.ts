import { describe, expect, it } from "vitest";
import { MAX_MENTIONS, newMentions, parseMentions } from "./mentions.js";

const id = (n: number) =>
  `01a0e5cc-58ae-7009-9f43-${String(n).padStart(12, "0")}`;
const token = (n: number, name = "Grace Hopper") =>
  `[@${name}](mention:${id(n)})`;

describe("mention parsing", () => {
  it("collects unique mentioned users and @staff", () => {
    expect(
      parseMentions(
        `Hi ${token(1)} and ${token(2, "Ada")}, ${token(1)}! @staff?`,
      ),
    ).toEqual({ userIds: [id(1), id(2)], staff: true });
    expect(parseMentions("No one here")).toEqual({ userIds: [], staff: false });
    expect(parseMentions(null)).toEqual({ userIds: [], staff: false });
  });

  it("ignores mentions in code and look-alikes", () => {
    const body = [
      `Inline \`${token(1)}\` code`,
      "```",
      `${token(2)} @staff`,
      "```",
      "email me@staff.edu or @staffing or `@staff`",
      "[@Ada](https://example.edu)",
    ].join("\n");
    expect(parseMentions(body)).toEqual({ userIds: [], staff: false });
    expect(
      parseMentions(`${token(3)}\n\`\`\`\nunterminated ${token(4)}`),
    ).toEqual({ userIds: [id(3)], staff: false });
  });

  it("limits individual mentions but counts @staff as one", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => token(n + 1)).join(" ");
    expect(parseMentions(`${many(MAX_MENTIONS)} @staff`).userIds).toHaveLength(
      MAX_MENTIONS,
    );
    expect(() => parseMentions(many(MAX_MENTIONS + 1))).toThrow(
      expect.objectContaining({ status: 422, code: "too_many_mentions" }),
    );
  });

  it("finds only the mentions an edit adds", () => {
    expect(
      newMentions(`${token(1)} @staff`, `${token(1)} ${token(2)} @staff`),
    ).toEqual({ userIds: [id(2)], staff: false });
    expect(newMentions(null, "@staff")).toEqual({ userIds: [], staff: true });
  });
});
