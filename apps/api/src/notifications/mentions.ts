import { AuthError } from "../auth/errors.js";

/** The most individual people one write may mention. */
export const MAX_MENTIONS = 20;

export type Mentions = { userIds: string[]; staff: boolean };

const TOKEN =
  /\[@[^\]\n]{1,200}\]\(mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
const STAFF = /(^|[^\w@])@staff\b/i;

/** Removes fenced code blocks and inline code, where mentions are literal text. */
function withoutCode(markdown: string): string {
  return markdown
    .replace(
      /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm,
      "",
    )
    .replace(/(`+)[^`]*?\1/g, "");
}

/** Who a Markdown body mentions; throws when it names too many people. */
export function parseMentions(markdown: string | null | undefined): Mentions {
  if (!markdown) return { userIds: [], staff: false };
  const text = withoutCode(markdown);
  const userIds = [
    ...new Set(
      [...text.matchAll(TOKEN)].map((match) => match[1]!.toLowerCase()),
    ),
  ];
  if (userIds.length > MAX_MENTIONS)
    throw new AuthError(
      422,
      "too_many_mentions",
      `Mention at most ${MAX_MENTIONS} people at once`,
    );
  return { userIds, staff: STAFF.test(text) };
}

/** Mentions in the new body that the previous body did not already make. */
export function newMentions(
  previous: string | null | undefined,
  next: string | null | undefined,
): Mentions {
  const before = parseMentions(previous);
  const after = parseMentions(next);
  return {
    userIds: after.userIds.filter((id) => !before.userIds.includes(id)),
    staff: after.staff && !before.staff,
  };
}
