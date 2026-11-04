import { describe, expect, it } from "vitest";
import { toSnippet } from "./snippet.js";

const mark = (word: string) => `\u0002${word}\u0003`;

describe("toSnippet", () => {
  it("converts sentinels into UTF-16 highlight ranges", () => {
    expect(
      toSnippet(`The ${mark("eigenvalues")} of a 😀 ${mark("matrix")}\n\nend`),
    ).toEqual({
      text: "The eigenvalues of a 😀 matrix end",
      highlights: [
        { start: 4, length: 11 },
        { start: 24, length: 6 },
      ],
    });
  });

  it("keeps markup-like text as plain text, restoring < and > stand-ins", () => {
    expect(toSnippet(`<script>${mark("alert")}(1)</script>`)).toEqual({
      text: "<script>alert(1)</script>",
      highlights: [{ start: 8, length: 5 }],
    });
    expect(
      toSnippet(`\ue000b\ue001${mark("bold")}\ue000/b\ue001 a\ue000b`),
    ).toEqual({
      text: "<b>bold</b> a<b",
      highlights: [{ start: 3, length: 4 }],
    });
  });

  it("returns null when nothing is highlighted", () => {
    expect(toSnippet("no matches here")).toBeNull();
    expect(toSnippet(`${mark("")} empty`)).toBeNull();
  });

  it("cuts long snippets on a word boundary and clips highlights", () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`);
    words[1] = mark("first");
    words[60] = mark("late");
    const snippet = toSnippet(words.join(" "))!;
    expect(snippet.text.length).toBeLessThanOrEqual(300);
    expect(snippet.text.endsWith(" ")).toBe(false);
    expect(snippet.highlights).toEqual([{ start: 6, length: 5 }]);
  });

  const highlightedText = (
    snippet: NonNullable<ReturnType<typeof toSnippet>>,
  ) =>
    snippet.highlights.map(({ start, length }) =>
      snippet.text.slice(start, start + length),
    );

  it("moves the window to keep a highlight that lies past the cut", () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`);
    words[75] = mark("late");
    const snippet = toSnippet(words.join(" "))!;
    expect(snippet.text.length).toBeLessThanOrEqual(300);
    expect(highlightedText(snippet)).toEqual(["late"]);
    expect(words).toContain(snippet.text.split(" ")[0]);
    expect(words.join(" ").replace(mark("late"), "late")).toContain(
      snippet.text,
    );
  });

  it("keeps a late highlight after a token too long to include", () => {
    const snippet = toSnippet(`${"x".repeat(400)} ${mark("match")} tail`)!;
    expect(snippet).toEqual({
      text: "match tail",
      highlights: [{ start: 0, length: 5 }],
    });
  });

  it("clips a highlight longer than the limit instead of dropping it", () => {
    const snippet = toSnippet(`before ${mark("y".repeat(400))} after`)!;
    expect(snippet.text).toBe("y".repeat(300));
    expect(snippet.highlights).toEqual([{ start: 0, length: 300 }]);
  });

  it("shifts later highlights with the window and drops those past its end", () => {
    const words = Array.from({ length: 200 }, (_, index) => `word${index}`);
    words[80] = mark("first");
    words[82] = mark("second");
    words[180] = mark("beyond");
    expect(highlightedText(toSnippet(words.join(" "))!)).toEqual([
      "first",
      "second",
    ]);
  });
});
