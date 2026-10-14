export type FormatAction =
  | "bold"
  | "italic"
  | "code"
  | "inline-math"
  | "heading"
  | "bullet-list"
  | "numbered-list"
  | "link"
  | "block-math";

export type BodySelection = { from: number; to: number };
export type FormatResult = { text: string; from: number; to: number };

/** Keep CodeMirror/Yjs changes scoped to the modified span, not the whole body. */
export function formatBodyChange(
  text: string,
  selection: BodySelection,
  action: FormatAction,
) {
  const result = formatBody(text, selection, action);
  let from = 0;
  while (
    from < text.length &&
    from < result.text.length &&
    text[from] === result.text[from]
  )
    from++;
  let suffix = 0;
  while (
    suffix < text.length - from &&
    suffix < result.text.length - from &&
    text[text.length - 1 - suffix] ===
      result.text[result.text.length - 1 - suffix]
  )
    suffix++;
  return {
    from,
    to: text.length - suffix,
    insert: result.text.slice(from, result.text.length - suffix),
    anchor: result.from,
    head: result.to,
  };
}

export function formatBody(
  text: string,
  selection: BodySelection,
  action: FormatAction,
): FormatResult {
  const { from, to } = selection;
  const selected = text.slice(from, to);
  const replace = (
    insertion: string,
    start: number,
    end: number,
  ): FormatResult => ({
    text: text.slice(0, from) + insertion + text.slice(to),
    from: from + start,
    to: from + end,
  });

  const delimiters: Partial<Record<FormatAction, string>> = {
    bold: "**",
    italic: "*",
    code: "`",
    "inline-math": "$",
  };
  const delimiter = delimiters[action];
  if (delimiter !== undefined) {
    const insertion = `${delimiter}${selected}${delimiter}`;
    return replace(
      insertion,
      delimiter.length,
      delimiter.length + selected.length,
    );
  }
  if (action === "link") {
    const insertion = `[${selected}](url)`;
    return selected
      ? replace(insertion, selected.length + 3, selected.length + 6)
      : replace(insertion, 1, 1);
  }
  if (action === "block-math") {
    const before = from > 0 && text[from - 1] !== "\n" ? "\n" : "";
    const after = to < text.length && text[to] !== "\n" ? "\n" : "";
    const insertion = `${before}$$\n${selected}\n$$${after}`;
    const start = before.length + 3;
    return replace(insertion, start, start + selected.length);
  }

  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lastSelected = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const lineEndIndex = text.indexOf("\n", lastSelected);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const prefixed = lines.map(
    (line, index) =>
      `${action === "heading" ? "### " : action === "bullet-list" ? "- " : `${index + 1}. `}${line}`,
  );
  const inserted = prefixed.join("\n");
  const addedBeforeFrom = prefixed
    .slice(0, text.slice(lineStart, from).split("\n").length)
    .reduce(
      (total, line, index) => total + line.length - lines[index]!.length,
      0,
    );
  const newFrom = from + addedBeforeFrom;
  return {
    text: text.slice(0, lineStart) + inserted + text.slice(lineEnd),
    from: newFrom,
    to:
      to +
      prefixed.reduce(
        (total, line, index) => total + line.length - lines[index]!.length,
        0,
      ),
  };
}
