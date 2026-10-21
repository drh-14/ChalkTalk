import type { SessionLanguage } from "./client.js";

const FENCE_LANGUAGES: Record<SessionLanguage, string> = {
  plaintext: "",
  python: "python",
  java: "java",
  c: "c",
  cpp: "cpp",
  javascript: "javascript",
  typescript: "typescript",
  sql: "sql",
};

/** A fenced Markdown block the code itself cannot close. */
export function codeBlock(code: string, language: SessionLanguage): string {
  const longest = Math.max(
    0,
    ...[...code.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  const body = code.endsWith("\n") ? code : `${code}\n`;
  return `${fence}${FENCE_LANGUAGES[language]}\n${body}${fence}`;
}

/** A trimmed note, then the content, separated by a blank line. */
export function postBody(note: string, content: string): string {
  const trimmed = note.trim();
  return trimmed ? `${trimmed}\n\n${content}` : content;
}
