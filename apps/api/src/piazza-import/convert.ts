import TurndownService from "turndown";

/** Raw Piazza data, as fetched from its internal web API. Only fields we read are typed. */
export type PiazzaHistory = {
  anon?: string;
  uid?: string;
  subject?: string;
  content?: string;
  created: string;
};
export type PiazzaChild = {
  id: string;
  type: string;
  anon?: string;
  uid?: string;
  subject?: string;
  created: string;
  updated?: string;
  no_answer?: number;
  history?: PiazzaHistory[];
  children?: PiazzaChild[];
  tag_endorse?: { id: string; role?: string }[];
  tag_good?: { id: string }[];
};
export type PiazzaPost = {
  id: string;
  nr?: number;
  type: string;
  status?: string;
  created: string;
  folders?: string[];
  history: PiazzaHistory[];
  children?: PiazzaChild[];
  /** Copied from the feed item, which carries the pin flag. */
  pinned?: boolean;
};
export type PiazzaUser = { id: string; name?: string; role?: string };
export type PiazzaExport = {
  network: { id: string; name: string; courseNumber?: string; term?: string };
  /** The Piazza account that fetched the export. */
  selfUid: string | null;
  users: PiazzaUser[];
  posts: PiazzaPost[];
};

/** A Piazza author, or null when Piazza hid an anonymous author from the fetching account. */
export type ImportAuthor = string | null;
export type ImportRole = "student" | "ta" | "instructor";
export type ImportPerson = { uid: string; name: string; role: ImportRole };
export type ImportAnswer = {
  piazzaId: string;
  kind: "student" | "staff";
  bodyMarkdown: string;
  anonymous: boolean;
  /** Oldest author first; the first one created the answer. */
  contributors: ImportAuthor[];
  createdAt: string;
  updatedAt: string;
  endorsedBy: string | null;
  helpfulFrom: string[];
};
export type ImportFollowup = {
  piazzaId: string;
  author: ImportAuthor;
  anonymous: boolean;
  bodyMarkdown: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  goodFrom: string[];
  replies: Omit<ImportFollowup, "replies" | "resolved">[];
};
export type ImportPost = {
  piazzaId: string;
  type: "question" | "note";
  title: string;
  bodyMarkdown: string;
  author: ImportAuthor;
  anonymous: boolean;
  private: boolean;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  answers: ImportAnswer[];
  followups: ImportFollowup[];
};
export type ImportCourse = {
  piazzaId: string;
  name: string;
  selfUid: string | null;
  people: ImportPerson[];
  posts: ImportPost[];
};

const MAX_BODY = 100_000;
const MAX_TITLE = 200;
const STAFF_ROLES = new Set(["professor", "instructor", "ta"]);

export function importRole(role: string | undefined): ImportRole {
  if (role === "professor" || role === "instructor") return "instructor";
  if (role === "ta") return "ta";
  return "student";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
// Piazza math is $$...$$; keep it verbatim and escape any other dollar sign,
// since ChalkTalk renders single dollars as inline math.
const escapeMarkdown = turndown.escape.bind(turndown);
turndown.escape = (text: string) =>
  text
    .split(/(\$\$[\s\S]+?\$\$)/)
    .map((part, index) =>
      index % 2 ? part : escapeMarkdown(part).replace(/\$/g, "\\$"),
    )
    .join("");
// Piazza uploads are site-relative; point them back at Piazza.
const absolute = (url: string) =>
  url.startsWith("/") && !url.startsWith("//")
    ? `https://piazza.com${url}`
    : url;
turndown.addRule("piazzaLinks", {
  filter: (node) => node.nodeName === "A" && Boolean(node.getAttribute("href")),
  replacement: (content, node) => {
    const href = absolute((node as HTMLElement).getAttribute("href")!);
    return `[${content.trim() || href}](${href})`;
  },
});
turndown.addRule("piazzaImages", {
  filter: "img",
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute("src");
    return src
      ? `![${(node as HTMLElement).getAttribute("alt") ?? ""}](${absolute(src)})`
      : "";
  },
});

/** Converts a Piazza body (rich-text HTML, or <md> markdown) into ChalkTalk Markdown. */
export function toMarkdown(content: string | undefined): string {
  const source = (content ?? "").trim();
  const markdown = /^<md>[\s\S]*<\/md>$/i.test(source)
    ? decodeEntities(source.slice(4, -5)).trim()
    : /<[a-z][^>]*>/i.test(source)
      ? turndown.turndown(source).trim()
      : turndown.escape(decodeEntities(source)).trim();
  return (markdown || "(empty)").slice(0, MAX_BODY);
}

const authorOf = (entry: { uid?: string; anon?: string }): ImportAuthor =>
  entry.uid ?? null;
const isAnonymous = (entry: { anon?: string }) =>
  entry.anon !== undefined && entry.anon !== "no";
const latest = (...times: (string | undefined)[]) =>
  times
    .filter((time): time is string => Boolean(time))
    .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
// Piazza lists history newest first.
const oldestFirst = (history: PiazzaHistory[]) =>
  [...history].sort((a, b) => Date.parse(a.created) - Date.parse(b.created));

function convertAnswer(child: PiazzaChild): ImportAnswer {
  const history = oldestFirst(child.history ?? []);
  const newest = history.at(-1);
  const contributors = [...new Set(history.map(authorOf))];
  const staffEndorser = (child.tag_endorse ?? []).find((endorser) =>
    STAFF_ROLES.has(endorser.role ?? ""),
  );
  return {
    piazzaId: child.id,
    kind: child.type === "i_answer" ? "staff" : "student",
    bodyMarkdown: toMarkdown(newest?.content),
    anonymous: child.type === "s_answer" && history.some(isAnonymous),
    contributors: contributors.length ? contributors : [authorOf(child)],
    createdAt: history[0]?.created ?? child.created,
    updatedAt: newest?.created ?? child.created,
    endorsedBy: staffEndorser?.id ?? null,
    helpfulFrom: (child.tag_endorse ?? [])
      .filter((endorser) => !STAFF_ROLES.has(endorser.role ?? ""))
      .map((endorser) => endorser.id),
  };
}

function convertDiscussion(child: PiazzaChild) {
  return {
    piazzaId: child.id,
    author: authorOf(child),
    anonymous: isAnonymous(child),
    bodyMarkdown: toMarkdown(child.subject),
    createdAt: child.created,
    updatedAt: child.updated ?? child.created,
    goodFrom: (child.tag_good ?? []).map((user) => user.id),
  };
}

function convertPost(post: PiazzaPost): ImportPost | null {
  if (post.status !== undefined && !["active", "private"].includes(post.status))
    return null;
  if (!["question", "note", "poll"].includes(post.type)) return null;
  const history = oldestFirst(post.history);
  const first = history[0];
  const newest = history.at(-1);
  if (!first || !newest) return null;
  const children = post.children ?? [];
  const answers = children
    .filter((child) => child.type === "i_answer" || child.type === "s_answer")
    .map(convertAnswer);
  const followups = children
    .filter((child) => child.type === "followup")
    .map((child) => ({
      ...convertDiscussion(child),
      // Piazza marks a followup unresolved with no_answer=1.
      resolved: child.no_answer === 0,
      replies: (child.children ?? [])
        .filter((reply) => reply.type === "feedback")
        .map(convertDiscussion),
    }));
  const title =
    decodeEntities(newest.subject ?? "")
      .trim()
      .slice(0, MAX_TITLE) || `Piazza post @${post.nr ?? post.id}`;
  const body = toMarkdown(newest.content);
  return {
    piazzaId: post.id,
    // ChalkTalk polls need options and votes Piazza does not expose here.
    type: post.type === "question" ? "question" : "note",
    title,
    bodyMarkdown:
      post.type === "poll"
        ? `${body}\n\n_Imported from a Piazza poll; options and votes were not imported._`.slice(
            0,
            MAX_BODY,
          )
        : body,
    author: authorOf(first),
    anonymous: isAnonymous(first),
    private: post.status === "private",
    pinned: post.pinned ?? false,
    tags: [
      ...new Set(
        (post.folders ?? [])
          .map((folder) => folder.trim().toLowerCase().slice(0, 100))
          .filter(Boolean),
      ),
    ],
    createdAt: post.created ?? first.created,
    updatedAt: newest.created,
    lastActivityAt: latest(
      post.created,
      newest.created,
      ...answers.map((answer) => answer.updatedAt),
      ...followups.flatMap((followup) => [
        followup.updatedAt,
        ...followup.replies.map((reply) => reply.updatedAt),
      ]),
    ),
    answers,
    followups,
  };
}

export function convertExport(data: PiazzaExport): ImportCourse {
  const { network } = data;
  return {
    piazzaId: network.id,
    name:
      (network.courseNumber && !network.name.startsWith(network.courseNumber)
        ? `${network.courseNumber} ${network.name}`
        : network.name
      )
        .trim()
        .slice(0, 200) || "Imported Piazza course",
    selfUid: data.selfUid,
    people: data.users.map((user) => ({
      uid: user.id,
      name:
        decodeEntities(user.name ?? "")
          .trim()
          .slice(0, 100) || "Piazza user",
      role: importRole(user.role),
    })),
    posts: data.posts
      .map(convertPost)
      .filter((post): post is ImportPost => post !== null)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  };
}
