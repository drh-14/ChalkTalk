/** Sentinels passed to ts_headline; normalizeText guarantees stored text never contains them. */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_STOP = "\u0003";
export const MAX_SNIPPET_LENGTH = 300;
/** Characters of context kept before a highlight when the window has to move to reach it. */
const SNIPPET_LEAD = 60;
/**
 * PostgreSQL's parser drops anything that looks like an HTML tag, so search
 * indexes and headlines text with < and > swapped one-to-one for these
 * stand-ins, which toSnippet maps back.
 */
export const LESS_THAN_STAND_IN = "\ue000";
export const GREATER_THAN_STAND_IN = "\ue001";

export type Snippet = {
  text: string;
  highlights: { start: number; length: number }[];
};

/**
 * Converts ts_headline output into plain text plus ordered, non-overlapping
 * UTF-16 highlight ranges. Longer text is cut on word boundaries to a window
 * of at most MAX_SNIPPET_LENGTH characters that keeps the first highlight.
 */
export function toSnippet(headline: string): Snippet | null {
  let text = "";
  const highlights: Snippet["highlights"] = [];
  let open: number | undefined;
  for (const character of headline.replace(/\s+/g, " ").trim()) {
    if (character === HIGHLIGHT_START) open ??= text.length;
    else if (character === HIGHLIGHT_STOP) {
      if (open !== undefined && text.length > open)
        highlights.push({ start: open, length: text.length - open });
      open = undefined;
    } else
      text +=
        character === LESS_THAN_STAND_IN
          ? "<"
          : character === GREATER_THAN_STAND_IN
            ? ">"
            : character;
  }
  if (open !== undefined && text.length > open)
    highlights.push({ start: open, length: text.length - open });
  if (!highlights.length) return null;
  if (text.length <= MAX_SNIPPET_LENGTH) return { text, highlights };
  const first = highlights[0]!,
    firstEnd = first.start + first.length;
  let start = 0;
  if (firstEnd > MAX_SNIPPET_LENGTH) {
    const space = text.indexOf(" ", first.start - SNIPPET_LEAD);
    start = space >= 0 && space < first.start ? space + 1 : first.start;
  }
  let end = Math.min(text.length, start + MAX_SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space >= firstEnd) end = space;
    else if (/[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
  }
  const excerpt = text.slice(start, end).trimEnd();
  return {
    text: excerpt,
    highlights: highlights
      .filter((range) => range.start - start < excerpt.length)
      .map((range) => ({
        start: range.start - start,
        length: Math.min(range.length, excerpt.length - (range.start - start)),
      })),
  };
}
