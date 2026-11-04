export const MAX_TEXT_LENGTH = 500_000;

/**
 * Normalizes extracted text for storage and search: unified newlines, no
 * control characters other than newline and no U+E000/U+E001 (so snippet
 * sentinels and the search stand-ins for < and > never occur in source
 * text), tabs and space runs collapsed to one space, at most one blank
 * line in a row, and at most MAX_TEXT_LENGTH code points.
 */
export function normalizeText(
  raw: string,
  maxLength = MAX_TEXT_LENGTH,
): { text: string; truncated: boolean } {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/(?!\n)[\p{Cc}\uE000\uE001]/gu, " ")
    .replace(/[\t\p{Zs}]+/gu, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let codePoints = 0,
    end = 0;
  for (const character of cleaned) {
    if (codePoints === maxLength)
      return { text: cleaned.slice(0, end).trimEnd(), truncated: true };
    codePoints += 1;
    end += character.length;
  }
  return { text: cleaned, truncated: false };
}
