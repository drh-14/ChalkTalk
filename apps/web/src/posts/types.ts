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
  /** CSS modifier for the type badge. */
  tone: string;
  /** Course feed filter that lists only this type. */
  options: PostListOptions;
  statuses?: (post: Post) => PostStatus[];
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
  },
  note: {
    label: "Note",
    plural: "Notes",
    tone: "note",
    options: { type: "note" },
  },
};
export const FALLBACK_POST_TYPE: PostTypeConfig = {
  label: "Post",
  plural: "Posts",
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
/** Sidebar filters: all posts, author filters, then each supported post type. */
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
  ...Object.entries(POST_TYPES).map(([key, type]) => ({
    key,
    label: type.plural,
    options: type.options,
    nested: false,
  })),
];
