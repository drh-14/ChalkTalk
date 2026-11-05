/** Reflows prose without changing the stored OCR text or its block/column order. */
export function readableExtractedText(raw: string): string {
  const blocks = raw
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const structured = (block: string) => {
    const lines = block.split("\n");
    return (
      lines.some(
        (line) =>
          /^\s*(?:[-*•]\s|\d+[.)]\s)/u.test(line) ||
          /\|.*\||[<>]/u.test(line) ||
          ((line.match(/(?:^|\s)[+-]?\d+(?:[.,]\d+)?%?(?=\s|$)/g)?.length ??
            0) >= 2 &&
            (line.match(/(?:^|\s)[+-]?\d+(?:[.,]\d+)?%?(?=\s|$)/g)?.length ??
              0) /
              line.trim().split(/\s+/).length >=
              0.35),
      ) ||
      (/[A-Z]/.test(block) && !/[a-z]/.test(block))
    );
  };
  const prose = (block: string) =>
    !structured(block) && block.split(/\s+/).length >= 12;
  const output: { text: string; prose: boolean }[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const isStructured = structured(block);
    const text = isStructured
      ? block.trim()
      : block
          .trim()
          .replace(/-\s*\n\s*(?=\p{Ll})/gu, "-")
          .replace(/\s*\n\s*/g, " ");
    const previous = output.at(-1);
    if (
      previous?.prose &&
      !isStructured &&
      /^\p{Ll}/u.test(text) &&
      !/[.!?:;…][\])'”’"]?$/u.test(previous.text)
    ) {
      previous.text += previous.text.endsWith("-") ? text : ` ${text}`;
    } else output.push({ text, prose: prose(block) });
  }
  return output.map((block) => block.text).join("\n\n");
}

export function extractedTextFilename(name: string): string {
  const stem = name
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
    .replace(/[. ]+$/u, "")
    .trim()
    .slice(0, 160);
  return `${stem || "extracted-text"}.txt`;
}
