import { expect, it } from "vitest";
import { formatBody, type FormatAction } from "./formatting.js";

it.each([
  ["bold", "**ptr**", 2, 5],
  ["italic", "*ptr*", 1, 4],
  ["code", "`ptr`", 1, 4],
  ["inline-math", "$ptr$", 1, 4],
] as const)(
  "wraps the selected text with %s syntax",
  (action, expected, from, to) => {
    const result = formatBody("ptr", { from: 0, to: 3 }, action);
    expect(result).toEqual({ text: expected, from, to });
    expect(result.text.slice(result.from, result.to)).toBe("ptr");
  },
);

it.each([
  ["bold", "a****b", 3],
  ["italic", "a**b", 2],
  ["code", "a``b", 2],
  ["inline-math", "a$$b", 2],
] as const)(
  "leaves the caret between empty %s delimiters",
  (action, expected, caret) => {
    expect(formatBody("ab", { from: 1, to: 1 }, action)).toEqual({
      text: expected,
      from: caret,
      to: caret,
    });
  },
);

it("places the caret in a selected link's destination", () => {
  expect(formatBody("notes", { from: 0, to: 5 }, "link")).toEqual({
    text: "[notes](url)",
    from: 8,
    to: 11,
  });
  expect(formatBody("", { from: 0, to: 0 }, "link")).toEqual({
    text: "[](url)",
    from: 1,
    to: 1,
  });
});

it.each([
  ["heading", "before\n### one\n### two\nafter"],
  ["bullet-list", "before\n- one\n- two\nafter"],
  ["numbered-list", "before\n1. one\n2. two\nafter"],
] as [FormatAction, string][])(
  "prefixes only selected lines for %s",
  (action, expected) => {
    expect(
      formatBody("before\none\ntwo\nafter", { from: 7, to: 14 }, action).text,
    ).toBe(expected);
  },
);

it("places standalone block math around selected content without swallowing prose", () => {
  const result = formatBody(
    "before\nx^2\nafter",
    { from: 7, to: 10 },
    "block-math",
  );
  expect(result.text).toBe("before\n$$\nx^2\n$$\nafter");
  expect(result.text.slice(result.from, result.to)).toBe("x^2");
  expect(formatBody("abc", { from: 3, to: 3 }, "block-math")).toEqual({
    text: "abc\n$$\n\n$$",
    from: 7,
    to: 7,
  });
});
