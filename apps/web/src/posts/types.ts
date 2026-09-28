import type { Post, PostListOptions } from "./client.js";

export type PostStatus = {
  label: string;
  tone: "positive" | "attention" | "neutral";
  /** Shown as an icon, with the label kept for screen readers and hover. */
  icon?: "pin";
};
export type PostTypeConfig = {
  label: string;
  plural: string;
  icon: string;
  /** CSS modifier for the type badge. */
  tone: string;
  /** Course feed filter that lists only this type. */
  options: PostListOptions;
  statuses?: (post: Post) => PostStatus[];
  /** Filters that only make sense for this type, listed under it in the sidebar. */
  filters?: {
    key: string;
    label: string;
    /** Spoken name when the visible label repeats under another type. */
    ariaLabel?: string;
    options: PostListOptions;
  }[];
  /** Short type-specific summary for the card footer, such as a vote count. */
  extras?: (post: Post) => string | undefined;
};

/**
 * Every post type the frontend knows. Adding a type here gives it a card badge,
 * statuses, and a sidebar filter. Register a type only once the API accepts it
 * as a list filter; until then its posts render with the fallback below.
 */
export const POST_TYPES: Record<string, PostTypeConfig> = {
  question: {
    label: "Question",
    plural: "Questions",
    icon: "?",
    tone: "question",
    options: { type: "question" },
    statuses: (post) =>
      post.answered === undefined
        ? []
        : [
            post.answered
              ? { label: "Answered", tone: "positive" }
              : { label: "Unanswered", tone: "attention" },
          ],
    filters: [
      { key: "answered", label: "Answered", options: { answered: true } },
      { key: "unanswered", label: "Unanswered", options: { answered: false } },
      {
        key: "pinned",
        label: "Pinned",
        ariaLabel: "Pinned questions",
        options: { type: "question", pinned: true },
      },
    ],
  },
  note: {
    label: "Note",
    plural: "Notes",
    icon: "#",
    tone: "note",
    options: { type: "note" },
    filters: [
      {
        key: "pinned",
        label: "Pinned",
        ariaLabel: "Pinned notes",
        options: { type: "note", pinned: true },
      },
    ],
  },
};
export const FALLBACK_POST_TYPE: PostTypeConfig = {
  label: "Post",
  plural: "Posts",
  icon: "•",
  tone: "other",
  options: {},
};
export const postTypeOf = (type: string): PostTypeConfig =>
  POST_TYPES[type] ?? FALLBACK_POST_TYPE;

/** A post's own type statuses followed by statuses every type shares. */
export function postStatuses(post: Post): PostStatus[] {
  return [
    ...(postTypeOf(post.type).statuses?.(post) ?? []),
    ...(post.pinned
      ? [{ label: "Pinned", tone: "neutral" as const, icon: "pin" as const }]
      : []),
  ];
}

export type FeedFilter = {
  key: string;
  label: string;
  ariaLabel?: string;
  options: PostListOptions;
  nested: boolean;
};
/** Sidebar filters: everything and its author filters, then each post type with its own filters. */
export const feedFilters = (userId?: string): FeedFilter[] => [
  { key: "all", label: "All posts", options: {}, nested: false },
  ...(userId
    ? [
        {
          key: "mine",
          label: "My posts",
          options: { authorId: userId },
          nested: true,
        },
      ]
    : []),
  {
    key: "instructors",
    label: "Instructor posts",
    options: { authorRole: "instructor" },
    nested: true,
  },
  {
    key: "tas",
    label: "TA posts",
    options: { authorRole: "ta" },
    nested: true,
  },
  ...Object.entries(POST_TYPES).flatMap(([key, type]) => [
    { key, label: type.plural, options: type.options, nested: false },
    ...(type.filters ?? []).map((filter) => ({
      key: `${key}:${filter.key}`,
      label: filter.label,
      ariaLabel: filter.ariaLabel,
      options: filter.options,
      nested: true,
    })),
  ]),
];
